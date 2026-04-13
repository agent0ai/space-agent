import path from "node:path";

import { loadSupervisorAuthEnv } from "./lib/supervisor/auth_keys.js";
import { resolveUpdateSource, sanitizeRemoteUrl, shortRevision } from "./lib/supervisor/git_releases.js";
import { SpaceSupervisor } from "./lib/supervisor/supervisor.js";
import { applyProcessTitle, buildSupervisorProcessTitle } from "../server/lib/utils/process_title.js";

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

function readOptionValue(args, index, optionName) {
  const value = args[index + 1];

  if (value === undefined || String(value).startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }

  return value;
}

function parseRuntimeAssignment(rawValue) {
  const match = String(rawValue || "").match(PARAM_ASSIGNMENT_PATTERN);

  if (!match) {
    return null;
  }

  return {
    name: match[1],
    value: match[2]
  };
}

function findLastAssignmentValue(args, paramName) {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const assignment = parseRuntimeAssignment(args[index]);

    if (assignment && assignment.name === paramName) {
      return assignment.value;
    }
  }

  return "";
}

function parseSuperviseArgs(args) {
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
  const serveArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

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

    serveArgs.push(arg);
  }

  return {
    options,
    serveArgs
  };
}

function resolveProjectPath(projectRoot, value) {
  return path.resolve(projectRoot, String(value || ""));
}

function resolveConfiguredValue(options = {}) {
  const preferredValue = String(options.preferredValue || "").trim();

  if (preferredValue) {
    return preferredValue;
  }

  const assignmentValue = String(options.assignmentValue || "").trim();

  if (assignmentValue) {
    return assignmentValue;
  }

  const envValue = String(options.envValue || "").trim();

  if (envValue) {
    return envValue;
  }

  return String(options.defaultValue || "").trim();
}

function resolveRequiredCustomwarePath(projectRoot, serveArgs, env = process.env) {
  const configuredPath = resolveConfiguredValue({
    assignmentValue: findLastAssignmentValue(serveArgs, "CUSTOMWARE_PATH"),
    envValue: env.CUSTOMWARE_PATH
  });

  if (!configuredPath) {
    throw new Error(
      "Supervise requires CUSTOMWARE_PATH. Set it with CUSTOMWARE_PATH=<path> or node space set CUSTOMWARE_PATH=<path>."
    );
  }

  return resolveProjectPath(projectRoot, configuredPath);
}

function resolveDefaultStateDir(projectRoot) {
  return path.join(projectRoot, "supervisor");
}

function buildServeArgs(serveArgs, customwarePath) {
  const args = [];
  let wroteCustomwarePath = false;

  for (const arg of serveArgs) {
    const assignment = parseRuntimeAssignment(arg);

    if (!assignment) {
      args.push(arg);
      continue;
    }

    if (assignment.name === "HOST" || assignment.name === "PORT") {
      continue;
    }

    if (assignment.name === "CUSTOMWARE_PATH") {
      if (!wroteCustomwarePath) {
        args.push(`CUSTOMWARE_PATH=${customwarePath}`);
        wroteCustomwarePath = true;
      }
      continue;
    }

    args.push(arg);
  }

  if (!wroteCustomwarePath) {
    args.push(`CUSTOMWARE_PATH=${customwarePath}`);
  }

  args.push(`HOST=${CHILD_HOST}`, `PORT=${CHILD_PORT}`);
  return args;
}

function resolvePublicHost(options, serveArgs, env = process.env) {
  return resolveConfiguredValue({
    assignmentValue: findLastAssignmentValue(serveArgs, "HOST"),
    envValue: env.HOST,
    defaultValue: "0.0.0.0"
  });
}

function resolvePublicPort(options, serveArgs, env = process.env) {
  const rawPort = resolveConfiguredValue({
    assignmentValue: findLastAssignmentValue(serveArgs, "PORT"),
    envValue: env.PORT,
    defaultValue: "3000"
  });
  const publicPort = Number(rawPort);

  if (!Number.isFinite(publicPort) || publicPort < 0) {
    throw new Error(`Invalid supervise port: ${rawPort}`);
  }

  return publicPort;
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
    remoteUrl: options.remoteUrl,
    runtimeArgs: options.runtimeArgs || []
  });
}

export const help = {
  name: "supervise",
  summary: "Run Space Agent behind a production-ready zero-downtime auto-update supervisor.",
  usage: [
    "node space supervise CUSTOMWARE_PATH=/srv/space/customware",
    "node space supervise HOST=0.0.0.0 PORT=3000 CUSTOMWARE_PATH=/srv/space/customware",
    "node space supervise --branch main --auto-update-interval 300 CUSTOMWARE_PATH=/srv/space/customware",
    "node space supervise --auto-update-interval 0 CUSTOMWARE_PATH=/srv/space/customware"
  ],
  description:
    "Starts a production-ready public reverse-proxy supervisor, runs real space serve children on private loopback ports, periodically stages source updates in release directories when the auto-update interval is greater than zero, and switches to a healthy replacement child. The supervisor only owns its own flags plus the public bind host and port; every other CLI argument is forwarded to space serve unchanged except that child HOST and PORT are forced to loopback and CUSTOMWARE_PATH is normalized to an absolute shared-state path.",
  options: [
    {
      flag: "--branch <branch>",
      description: "Git branch to watch for source updates; defaults to the current or remembered checkout branch."
    },
    {
      flag: "--remote-url <url>",
      description: "Git remote URL to watch; overrides GIT_URL, which otherwise overrides the local origin remote URL."
    },
    {
      flag: "--state-dir <path>",
      description: "Supervisor state directory; defaults to <projectRoot>/supervisor."
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
    "node space set CUSTOMWARE_PATH=/srv/space/customware",
    "node space supervise HOST=0.0.0.0 PORT=3000",
    "node space supervise SINGLE_USER_APP=true --branch main",
    "node space supervise --auto-update-interval 0"
  ]
};

export async function execute(context) {
  applyProcessTitle(buildSupervisorProcessTitle());

  const { options, serveArgs: rawServeArgs } = parseSuperviseArgs(context.args);
  const customwarePath = resolveRequiredCustomwarePath(context.projectRoot, rawServeArgs, process.env);
  const stateDir = options.stateDir
    ? resolveProjectPath(context.projectRoot, options.stateDir)
    : resolveDefaultStateDir(context.projectRoot);
  const releasesDir = path.join(stateDir, "releases");
  const auth = await loadSupervisorAuthEnv({
    env: process.env,
    stateDir
  });
  const updateSource = await resolveSupervisorSource(
    {
      ...options,
      runtimeArgs: rawServeArgs
    },
    context.projectRoot
  );
  const serveArgs = buildServeArgs(rawServeArgs, customwarePath);
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
    publicHost: resolvePublicHost(options, rawServeArgs, process.env),
    publicPort: resolvePublicPort(options, rawServeArgs, process.env),
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

export const __test = {
  buildServeArgs,
  findLastAssignmentValue,
  parseRuntimeAssignment,
  parseSuperviseArgs,
  resolveDefaultStateDir,
  resolvePublicHost,
  resolvePublicPort,
  resolveRequiredCustomwarePath
};
