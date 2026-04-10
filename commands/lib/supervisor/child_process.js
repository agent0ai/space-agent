import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";

import { attachPrefixedLineLog } from "./process_log.js";

const LISTENING_LINE_PATTERN = /space server listening at (https?:\/\/[^\s]+)/u;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readHealth(url) {
  const healthUrl = new URL("/api/health", url);

  return new Promise((resolve) => {
    const request = http.get(healthUrl, (response) => {
      response.resume();
      response.once("end", () => {
        resolve(response.statusCode >= 200 && response.statusCode < 300);
      });
    });

    request.setTimeout(2_000, () => {
      request.destroy();
      resolve(false);
    });

    request.once("error", () => {
      resolve(false);
    });
  });
}

async function waitForHealthy(url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await readHealth(url)) {
      return;
    }

    await delay(250);
  }

  throw new Error(`Serve child did not become healthy at ${url} within ${timeoutMs}ms.`);
}

class ServeChild {
  constructor({ childProcess, label, rootDir, url }) {
    const parsedUrl = new URL(url);

    this.activeProxyStreams = 0;
    this.childProcess = childProcess;
    this.host = parsedUrl.hostname;
    this.label = label;
    this.lastProxyActivityAt = Date.now();
    this.port = Number(parsedUrl.port);
    this.rootDir = rootDir;
    this.stopping = false;
    this.url = url;
  }

  get pid() {
    return this.childProcess.pid;
  }

  get isRunning() {
    return this.childProcess.exitCode === null && this.childProcess.signalCode === null;
  }

  markProxyActivity() {
    this.lastProxyActivityAt = Date.now();
  }

  beginProxyStream() {
    this.activeProxyStreams += 1;
    this.markProxyActivity();

    let ended = false;

    return {
      end: () => {
        if (ended) {
          return;
        }

        ended = true;
        this.activeProxyStreams = Math.max(0, this.activeProxyStreams - 1);
        this.markProxyActivity();
      },
      markActivity: () => {
        this.markProxyActivity();
      }
    };
  }

  async waitForProxyQuiet({ idleMs = 1_000, maxMs = 30_000 } = {}) {
    const startedAt = Date.now();

    while (this.isRunning) {
      if (this.activeProxyStreams === 0) {
        return "idle";
      }

      if (Date.now() - this.lastProxyActivityAt >= idleMs) {
        return "quiet";
      }

      if (Date.now() - startedAt >= maxMs) {
        return "timeout";
      }

      await delay(Math.min(idleMs, 500));
    }

    return "exited";
  }

  async stop({ graceMs = 5_000 } = {}) {
    if (!this.isRunning) {
      return;
    }

    this.stopping = true;

    await new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        if (this.isRunning) {
          this.childProcess.kill("SIGKILL");
          return;
        }

        finish();
      }, graceMs);

      this.childProcess.once("exit", finish);

      if (!this.isRunning) {
        finish();
        return;
      }

      this.childProcess.kill("SIGTERM");
    });
  }
}

function buildServeCommand(rootDir, serveArgs) {
  return {
    args: [path.join(rootDir, "space"), "serve", ...serveArgs],
    command: process.execPath
  };
}

function startServeChild(options) {
  const {
    env,
    label,
    rootDir,
    serveArgs,
    startupTimeoutMs = 30_000
  } = options;
  const command = buildServeCommand(rootDir, serveArgs);
  let resolvedUrl = "";
  let settled = false;

  return new Promise((resolve, reject) => {
    const childProcess = spawn(command.command, command.args, {
      cwd: rootDir,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const prefix = `[serve:${label}]`;
    let stdoutReader = null;
    let stderrReader = null;

    function cleanup() {
      if (stdoutReader) {
        stdoutReader.close();
      }

      if (stderrReader) {
        stderrReader.close();
      }
    }

    function rejectOnce(error) {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    const startupTimer = setTimeout(() => {
      rejectOnce(new Error(`Serve child ${label} did not print a listening URL within ${startupTimeoutMs}ms.`));
      childProcess.kill("SIGTERM");
    }, startupTimeoutMs);

    childProcess.once("error", (error) => {
      clearTimeout(startupTimer);
      rejectOnce(error);
    });

    childProcess.once("exit", (code, signal) => {
      clearTimeout(startupTimer);

      if (!settled) {
        rejectOnce(
          new Error(`Serve child ${label} exited before readiness with ${signal ? `signal ${signal}` : `code ${code}`}.`)
        );
      }
    });

    stdoutReader = attachPrefixedLineLog(childProcess.stdout, prefix, (line) => {
      const match = String(line || "").match(LISTENING_LINE_PATTERN);
      if (!match || settled) {
        return;
      }

      resolvedUrl = match[1];
      settled = true;
      clearTimeout(startupTimer);

      waitForHealthy(resolvedUrl, startupTimeoutMs)
        .then(() => {
          resolve(
            new ServeChild({
              childProcess,
              label,
              rootDir,
              url: resolvedUrl
            })
          );
        })
        .catch((error) => {
          cleanup();
          childProcess.kill("SIGTERM");
          reject(error);
        });
    });
    stderrReader = attachPrefixedLineLog(childProcess.stderr, prefix);
  });
}

export { ServeChild, startServeChild };
