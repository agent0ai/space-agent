import http from "node:http";

import {
  API_DIR,
  APP_DIR,
  ASSET_DIR,
  FILE_WATCH_CONFIG_PATH,
  JOBS_DIR,
  PAGES_DIR,
  PROJECT_ROOT,
  SERVER_TMP_DIR
} from "./config.js";
import { loadApiRegistry } from "./lib/api/registry.js";
import { createAuthService } from "./lib/auth/service.js";
import { flushGitHistoryCommits } from "./lib/customware/git_history.js";
import { ensureCustomwareDirectories } from "./lib/customware/layout.js";
import { createWatchdog } from "./lib/file_watch/watchdog.js";
import { createTmpWatch, ensureServerTmpDir } from "./lib/tmp/tmp_watch.js";
import { loadProjectEnvFiles } from "./lib/utils/env_files.js";
import { createRuntimeParams } from "./lib/utils/runtime_params.js";
import { JobRunner } from "./jobs/job_runner.js";
import { createLocalMutationSync } from "./runtime/request_mutations.js";
import { sendJson } from "./router/responses.js";
import { createRequestHandler } from "./router/router.js";

function resolveBrowserHost(host) {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "127.0.0.1";
  }

  return host;
}

function buildBrowserUrl(browserHost, port) {
  return `http://${browserHost}:${port}`;
}

function resolveListeningPort(server, fallbackPort) {
  const address = server.address();

  if (address && typeof address === "object" && Number.isFinite(address.port)) {
    return address.port;
  }

  return fallbackPort;
}

async function createServerBootstrap(overrides = {}) {
  const apiDir = overrides.apiDir || API_DIR;
  const appDir = overrides.appDir || APP_DIR;
  const assetDir = overrides.assetDir || ASSET_DIR;
  const pagesDir = overrides.pagesDir || PAGES_DIR;
  const projectRoot = overrides.projectRoot || PROJECT_ROOT;
  const tmpDir = overrides.tmpDir || SERVER_TMP_DIR;
  const runtimeParamEnv = overrides.runtimeParamEnv || { ...process.env };
  const legacyRuntimeParamOverrides = {};

  if (overrides.host !== undefined) {
    legacyRuntimeParamOverrides.HOST = String(overrides.host);
  }

  if (overrides.port !== undefined) {
    legacyRuntimeParamOverrides.PORT = String(overrides.port);
  }

  const runtimeParamOverrides = {
    ...legacyRuntimeParamOverrides,
    ...(overrides.runtimeParamOverrides || {})
  };

  loadProjectEnvFiles(projectRoot);

  const runtimeParams =
    overrides.runtimeParams ||
    await createRuntimeParams(projectRoot, {
      env: runtimeParamEnv,
      overrides: runtimeParamOverrides
    });
  const host = runtimeParams.get("HOST", "0.0.0.0");
  const browserHost = overrides.browserHost || resolveBrowserHost(host);
  const configuredPort = Number(runtimeParams.get("PORT", 3000));
  let activePort = configuredPort;

  ensureCustomwareDirectories(projectRoot, runtimeParams);
  ensureServerTmpDir(tmpDir);

  return {
    apiDir,
    appDir,
    assetDir,
    browserHost,
    configuredPort,
    host,
    pagesDir,
    projectRoot,
    runtimeParams,
    tmpDir
  };
}

async function createAgentServer(overrides = {}) {
  const bootstrap = overrides.serverBootstrap || (await createServerBootstrap(overrides));
  const {
    apiDir,
    appDir,
    assetDir,
    browserHost,
    configuredPort,
    host,
    pagesDir,
    projectRoot,
    runtimeParams,
    tmpDir
  } = bootstrap;
  let activePort = configuredPort;
  const normalizedWorkerNumber = Number.isFinite(Math.floor(Number(overrides.workerNumber)))
    ? Math.floor(Number(overrides.workerNumber))
    : 0;

  const watchdog =
    overrides.watchdog ||
    createWatchdog({
      configPath: overrides.fileWatchConfigPath || FILE_WATCH_CONFIG_PATH,
      projectRoot,
      runtimeParams
    });
  const tmpWatch =
    overrides.tmpWatch ||
    createTmpWatch({
      tmpDir
    });
  const mutationSync = overrides.mutationSync || createLocalMutationSync(watchdog);
  const stateSync =
    overrides.stateSync ||
    (watchdog && typeof watchdog.waitForVersion === "function"
      ? {
          getVersion() {
            return Number(watchdog.getVersion?.() || 0);
          },
          waitForVersion(minVersion, options = {}) {
            return watchdog.waitForVersion(minVersion, options);
          }
        }
      : null);
  const stateSystem =
    overrides.stateSystem ||
    (watchdog && typeof watchdog.getStateSystem === "function" ? watchdog.getStateSystem() : null);
  const resolvedAuth =
    overrides.auth ||
    createAuthService({
      projectRoot,
      runtimeParams,
      stateSystem,
      watchdog
    });
  const jobRunner =
    overrides.jobRunner ||
    new JobRunner({
      auth: resolvedAuth,
      jobDir: JOBS_DIR,
      mutationSync,
      projectRoot,
      runtimeParams,
      stateSystem,
      watchdog
    });

  const apiRegistry = await loadApiRegistry(apiDir);
  const requestHandler = createRequestHandler({
    apiDir,
    apiRegistry,
    appDir,
    auth: resolvedAuth,
    assetDir,
    mutationSync,
    pagesDir,
    runtimeParams,
    stateSystem,
    stateSync,
    workerNumber: normalizedWorkerNumber,
    watchdog,
    host,
    port: configuredPort,
    projectRoot
  });
  const server = http.createServer((req, res) => {
    Promise.resolve(requestHandler(req, res)).catch((error) => {
      console.error("Request handling failed.");
      console.error(error);

      if (res.headersSent) {
        res.destroy(error);
        return;
      }

      sendJson(res, 500, {
        error: "Internal server error"
      });
    });
  });

  const runtime = {
    apiDir,
    apiRegistry,
    appDir,
    browserHost,
    host,
    port: activePort,
    assetDir,
    pagesDir,
    auth: resolvedAuth,
    tmpDir,
    tmpWatch,
    watchdog,
    workerNumber: normalizedWorkerNumber,
    stateSync,
    stateSystem,
    runtimeParams,
    server,
    jobRunner,
    browserUrl: buildBrowserUrl(browserHost, activePort),
    async listen() {
      tmpWatch.start();

      try {
        await watchdog.start();
        if (resolvedAuth && typeof resolvedAuth.initialize === "function") {
          await resolvedAuth.initialize();
        }
        await jobRunner.start();

        return await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(configuredPort, host, () => {
            server.removeListener("error", reject);
            activePort = resolveListeningPort(server, configuredPort);
            runtime.port = activePort;
            runtime.browserUrl = buildBrowserUrl(browserHost, activePort);
            resolve(runtime);
          });
        });
      } catch (error) {
        jobRunner.stop();
        tmpWatch.stop();
        watchdog.stop();
        throw error;
      }
    },
    async close() {
      jobRunner.stop();
      await flushGitHistoryCommits();
      tmpWatch.stop();
      watchdog.stop();

      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };

  return runtime;
}

export { createAgentServer, createServerBootstrap };
