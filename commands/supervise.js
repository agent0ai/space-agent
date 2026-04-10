import path from "node:path";

import { loadSupervisorAuthEnv } from "./lib/supervisor/auth_keys.js";
import { resolveUpdateSource, sanitizeRemoteUrl, shortRevision } from "./lib/supervisor/git_releases.js";
import { SpaceSupervisor } from "./lib/supervisor/supervisor.js";
import {
  createRuntimeParams,
  findParamSpec,
  serializeRuntimeValue,
  validateConfigValue
} from "../server/lib/utils/runtime_params.js";

const CHILD_HOST = "127.0.0.1";
const CHILD_PORT = "0";
const DEFAULT_AUTO_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_DRAIN_IDLE_MS = 1_000;
const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
const DEFAULT_RESTART_BACKOFF_MS = 1_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const PARAM_ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u;

function parsePositiveMilliseconds(rawValue, optionName) {
  const value = Number(String(rawValue ?? "").trim());

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${optionName} requires a positive number of seconds.`);
  }

  return Math.round(value * 1000);
}

function parseIntervalMilliseconds(rawValue, optionName) {
  const value = Number(String(rawValue ?? "").trim());

  if (!Number.isFinite(value)) {
    throw new Error(`${optionName} requires a number of seconds.`);
  }

  return Math.round(value * 1000);
}

async function setRuntimeParamOverride(projectRoot, overrides, rawName, rawValue) {
  const spec = await findParamSpec(projectRoot, rawName);
  overrides[spec.name] = validateConfigValue(spec, rawValue);
}

function readOptionValue(args, index, optionName) {
  const value = args[index + 1];

  if (value === undefined || String(value).startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
}

async function parseSuperviseArgs(args, projectRoot) {
  const options = {
    autoUpdateIntervalMs: DEFAULT_AUTO_UPDATE_INTERVAL_MS,
    branchName: "",
    drainIdleMs: DEFAULT_DRAIN_IDLE_MS,
    drainTimeoutMs: DEFAULT_DRAIN_TIMEOUT_MS,
    remoteUrl: "",
    restartBackoffMs: DEFAULT_RESTART_BACKOFF_MS,
    startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
    stateDir: ""
  };
  const runtimeParamOverrides = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--host") {
      await setRuntimeParamOverride(projectRoot, runtimeParamOverrides, "HOST", readOptionValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--port") {
      await setRuntimeParamOverride(projectRoot, runtimeParamOverrides, "PORT", readOptionValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--branch") {
      options.branchName = String(readOptionValue(args, index, arg)).trim();
      index += 1;
      continue;
    }

    if (String(arg).startsWith("--branch=")) {
      options.branchName = String(arg).slice("--branch=".length).trim();
      continue;
    }

    if (arg === "--remote-url") {
      options.remoteUrl = String(readOptionValue(args, index, arg)).trim();
      index += 1;
      continue;
    }

    if (String(arg).startsWith("--remote-url=")) {
      options.remoteUrl = String(arg).slice("--remote-url=".length).trim();
      continue;
    }

    if (arg === "--state-dir") {
      options.stateDir = String(readOptionValue(args, index, arg)).trim();
      index += 1;
      continue;
    }

    if (String(arg).startsWith("--state-dir=")) {
      options.stateDir = String(arg).slice("--state-dir=".length).trim();
      continue;
    }

    if (arg === "--auto-update-interval") {
      options.autoUpdateIntervalMs = parseIntervalMilliseconds(readOptionValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (String(arg).startsWith("--auto-update-interval=")) {
      options.autoUpdateIntervalMs = parseIntervalMilliseconds(
        String(arg).slice("--auto-update-interval=".length),
        "--auto-update-interval"
      );
      continue;
    }

    if (arg === "--startup-timeout") {
      options.startupTimeoutMs = parsePositiveMilliseconds(readOptionValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (String(arg).startsWith("--startup-timeout=")) {
      options.startupTimeoutMs = parsePositiveMilliseconds(String(arg).slice("--startup-timeout=".length), "--startup-timeout");
      continue;
    }

    if (arg === "--drain-idle") {
      options.drainIdleMs = parsePositiveMilliseconds(readOptionValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (String(arg).startsWith("--drain-idle=")) {
      options.drainIdleMs = parsePositiveMilliseconds(String(arg).slice("--drain-idle=".length), "--drain-idle");
      continue;
    }

    if (arg === "--drain-timeout") {
      options.drainTimeoutMs = parsePositiveMilliseconds(readOptionValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (String(arg).startsWith("--drain-timeout=")) {
      options.drainTimeoutMs = parsePositiveMilliseconds(String(arg).slice("--drain-timeout=".length), "--drain-timeout");
      continue;
    }

    if (arg === "--restart-backoff") {
      options.restartBackoffMs = parsePositiveMilliseconds(readOptionValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (String(arg).startsWith("--restart-backoff=")) {
      options.restartBackoffMs = parsePositiveMilliseconds(String(arg).slice("--restart-backoff=".length), "--restart-backoff");
      continue;
    }

    const assignmentMatch = String(arg || "").match(PARAM_ASSIGNMENT_PATTERN);
    if (assignmentMatch) {
      await setRuntimeParamOverride(
        projectRoot,
        runtimeParamOverrides,
        assignmentMatch[1],
        assignmentMatch[2]
      );
      continue;
    }

    throw new Error(`Unknown supervise argument: ${arg}`);
  }

  return {
    options,
    runtimeParamOverrides
  };
}

function resolveProjectPath(projectRoot, value) {
  return path.resolve(projectRoot, String(value || ""));
}

function resolveRequiredCustomwarePath(projectRoot, runtimeParams) {
  const configuredPath = String(runtimeParams.get("CUSTOMWARE_PATH", "") || "").trim();

  if (!configuredPath) {
    throw new Error(
      "Supervise requires CUSTOMWARE_PATH. Set it with CUSTOMWARE_PATH=<path> or node space set CUSTOMWARE_PATH <path>."
    );
  }

  return resolveProjectPath(projectRoot, configuredPath);
}

function buildServeArgs(runtimeParams, customwarePath) {
  const args = [];

  for (const entry of runtimeParams.list()) {
    if (entry.value === undefined || entry.name === "HOST" || entry.name === "PORT") {
      continue;
    }

    const value = entry.name === "CUSTOMWARE_PATH"
      ? customwarePath
      : serializeRuntimeValue(entry, entry.value);

    args.push(`${entry.name}=${value}`);
  }

  args.push(`HOST=${CHILD_HOST}`, `PORT=${CHILD_PORT}`);
  return args;
}

function attachShutdownHandlers(supervisor) {
  let isStopping = false;

  async function stop() {
    if (isStopping) {
      return;
    }

    isStopping = true;
    await supervisor.stop();
  }

  process.once("SIGINT", () => {
    stop().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
  process.once("SIGTERM", () => {
    stop().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}

async function resolveSupervisorSource(options, projectRoot) {
  if (options.autoUpdateIntervalMs <= 0) {
    return {
      branchName: options.branchName || "local",
      currentRevision: "local",
      remoteUrl: options.remoteUrl || ""
    };
  }

  return resolveUpdateSource({
    branchName: options.branchName,
    projectRoot,
    remoteUrl: options.remoteUrl
  });
}

export const help = {
  name: "supervise",
  summary: "Run Space Agent behind a production-ready zero-downtime auto-update supervisor.",
  usage: [
    "node space supervise CUSTOMWARE_PATH=/srv/space/customware",
    "node space supervise --host 0.0.0.0 --port 3000 CUSTOMWARE_PATH=/srv/space/customware",
    "node space supervise --branch main --auto-update-interval 300 CUSTOMWARE_PATH=/srv/space/customware",
    "node space supervise --auto-update-interval 0 CUSTOMWARE_PATH=/srv/space/customware"
  ],
  description:
    "Starts a production-ready public reverse-proxy supervisor, runs real space serve children on private loopback ports, periodically stages source updates in release directories when the auto-update interval is greater than zero, switches to a healthy replacement child, drains old streams, and restarts the active child if it crashes. CUSTOMWARE_PATH is required and is passed to children as an absolute path so every release shares the same writable L1/L2 state.",
  options: [
    {
      flag: "--host <host>",
      description: "Public supervisor bind host; alias for HOST=<host>."
    },
    {
      flag: "--port <port>",
      description: "Public supervisor bind port; alias for PORT=<port>."
    },
    {
      flag: "--branch <branch>",
      description: "Git branch to watch for source updates; defaults to the current or remembered checkout branch."
    },
    {
      flag: "--remote-url <url>",
      description: "Git remote URL to watch; defaults to origin, then the canonical update remote."
    },
    {
      flag: "--state-dir <path>",
      description: "Supervisor state directory; defaults to CUSTOMWARE_PATH/.space-supervisor."
    },
    {
      flag: "--auto-update-interval <seconds>",
      description: "Seconds between zero-downtime source update checks. Defaults to 300; values <= 0 disable update checks."
    },
    {
      flag: "--startup-timeout <seconds>",
      description: "Seconds to wait for a child serve process to become healthy. Defaults to 30."
    },
    {
      flag: "--drain-idle <seconds>",
      description: "Seconds of no proxied traffic before an old child is cut off. Defaults to 1."
    },
    {
      flag: "--drain-timeout <seconds>",
      description: "Maximum seconds to keep an old child during drain. Defaults to 30."
    },
    {
      flag: "--restart-backoff <seconds>",
      description: "Initial crash-restart backoff. Defaults to 1 and caps at 30."
    }
  ],
  examples: [
    "node space set CUSTOMWARE_PATH /srv/space/customware",
    "node space supervise --host 0.0.0.0 --port 3000",
    "node space supervise SINGLE_USER_APP=true --branch main",
    "node space supervise --auto-update-interval 0"
  ]
};

export async function execute(context) {
  const { options, runtimeParamOverrides } = await parseSuperviseArgs(context.args, context.projectRoot);
  const runtimeParams = await createRuntimeParams(context.projectRoot, {
    env: context.originalEnv,
    overrides: runtimeParamOverrides
  });
  const customwarePath = resolveRequiredCustomwarePath(context.projectRoot, runtimeParams);
  const stateDir = options.stateDir
    ? resolveProjectPath(context.projectRoot, options.stateDir)
    : path.join(customwarePath, ".space-supervisor");
  const releasesDir = path.join(stateDir, "releases");
  const auth = await loadSupervisorAuthEnv({
    env: process.env,
    stateDir
  });
  const updateSource = await resolveSupervisorSource(options, context.projectRoot);
  const serveArgs = buildServeArgs(runtimeParams, customwarePath);
  const supervisor = new SpaceSupervisor({
    autoUpdateIntervalMs: options.autoUpdateIntervalMs,
    branchName: updateSource.branchName,
    childEnv: {
      ...process.env,
      ...auth.env
    },
    drainIdleMs: options.drainIdleMs,
    drainTimeoutMs: options.drainTimeoutMs,
    projectRoot: context.projectRoot,
    publicHost: runtimeParams.get("HOST", "0.0.0.0"),
    publicPort: Number(runtimeParams.get("PORT", 3000)),
    releasesDir,
    remoteUrl: updateSource.remoteUrl,
    restartBackoffMs: options.restartBackoffMs,
    serveArgs,
    sourceRevision: updateSource.currentRevision,
    startupTimeoutMs: options.startupTimeoutMs
  });

  console.log(`[supervise] Using shared customware at ${customwarePath}.`);
  console.log(`[supervise] Using supervisor state at ${stateDir}.`);
  console.log(`[supervise] Using auth keys from ${auth.source}.`);
  if (options.autoUpdateIntervalMs > 0) {
    console.log(
      `[supervise] Initial source revision ${shortRevision(updateSource.currentRevision)}; update source ${sanitizeRemoteUrl(updateSource.remoteUrl)} ${updateSource.branchName}.`
    );
  } else {
    console.log("[supervise] Initial source revision local; update source disabled.");
  }
  console.log(
    options.autoUpdateIntervalMs > 0
      ? `[supervise] Auto-update interval is ${options.autoUpdateIntervalMs / 1000}s.`
      : "[supervise] Auto-update interval is disabled."
  );

  attachShutdownHandlers(supervisor);
  await supervisor.start();
  return supervisor.waitForStop();
}
