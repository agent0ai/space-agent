import cluster from "node:cluster";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAgentServer, createServerBootstrap } from "../app.js";
import { FILE_WATCH_CONFIG_PATH, JOBS_DIR } from "../config.js";
import { JobRunner } from "../jobs/job_runner.js";
import { createAuthService } from "../lib/auth/service.js";
import {
  flushGitHistoryCommits,
  scheduleGitHistoryCommitsForProjectPaths
} from "../lib/customware/git_history.js";
import {
  clearUserFolderSizeCache,
  invalidateUserFolderSizeCacheForProjectPaths
} from "../lib/customware/user_quota.js";
import { createWatchdog } from "../lib/file_watch/watchdog.js";
import { createTmpWatch } from "../lib/tmp/tmp_watch.js";
import { applyProcessTitle, buildServeProcessTitle } from "../lib/utils/process_title.js";
import { hydrateRuntimeParams, serializeRuntimeParams } from "../lib/utils/runtime_params.js";
import { setRuntimeAppPathMutationHandler } from "./app_path_mutations.js";
import { IPC_MESSAGE_TYPES, createIpcRequestId } from "./ipc.js";
import { FILE_INDEX_AREA } from "./state_areas.js";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKER_BOOTSTRAP_ENV_NAME = "SPACE_CLUSTER_BOOTSTRAP";
const WORKER_NUMBER_ENV_NAME = "SPACE_CLUSTER_WORKER_NUMBER";
const WORKER_SENTINEL_ENV_NAME = "SPACE_CLUSTER_WORKER";
const WORKER_BOOTSTRAP_TIMEOUT_MS = 30_000;

function buildBrowserUrl(browserHost, port) {
  return `http://${browserHost}:${port}`;
}

function normalizeWorkerCount(runtimeParams) {
  const count = Math.floor(Number(runtimeParams?.get("WORKERS", 1)) || 1);
  return Number.isFinite(count) && count > 1 ? count : 1;
}

function createNoopTmpWatch(tmpDir = "") {
  return {
    maxAgeMs: 0,
    start() {},
    stop() {},
    sweepIntervalMs: 0,
    sweepNow() {
      return {
        removedEntries: [],
        tmpDir
      };
    },
    tmpDir
  };
}

function createRemoteError(error = {}) {
  const remoteError = new Error(error.message || "Remote operation failed.");
  remoteError.statusCode = Number(error.statusCode) || 500;
  return remoteError;
}

function serializeWorkerBootstrap(bootstrap, fileWatchConfigPath) {
  return JSON.stringify({
    apiDir: bootstrap.apiDir,
    appDir: bootstrap.appDir,
    assetDir: bootstrap.assetDir,
    browserHost: bootstrap.browserHost,
    fileWatchConfigPath,
    host: bootstrap.host,
    pagesDir: bootstrap.pagesDir,
    projectRoot: bootstrap.projectRoot,
    runtimeEntries: serializeRuntimeParams(bootstrap.runtimeParams),
    tmpDir: bootstrap.tmpDir
  });
}

function parseWorkerBootstrapEnv() {
  const sourceText = process.env[WORKER_BOOTSTRAP_ENV_NAME];

  if (!sourceText) {
    throw new Error(`Missing ${WORKER_BOOTSTRAP_ENV_NAME} for cluster worker.`);
  }

  const parsed = JSON.parse(sourceText);

  return {
    apiDir: String(parsed.apiDir || ""),
    appDir: String(parsed.appDir || ""),
    assetDir: String(parsed.assetDir || ""),
    browserHost: String(parsed.browserHost || ""),
    fileWatchConfigPath: String(parsed.fileWatchConfigPath || FILE_WATCH_CONFIG_PATH),
    host: String(parsed.host || "0.0.0.0"),
    pagesDir: String(parsed.pagesDir || ""),
    projectRoot: String(parsed.projectRoot || ""),
    runtimeEntries: Array.isArray(parsed.runtimeEntries) ? parsed.runtimeEntries : [],
    tmpDir: String(parsed.tmpDir || "")
  };
}

function parseWorkerNumberEnv() {
  const normalizedValue = Math.floor(Number(process.env[WORKER_NUMBER_ENV_NAME]));
  return Number.isFinite(normalizedValue) && normalizedValue > 0 ? normalizedValue : 0;
}

function sendProcessMessage(target, message) {
  if (!target || typeof target.send !== "function") {
    return;
  }

  try {
    target.send(message);
  } catch (error) {
    if (
      error?.code === "EPIPE" ||
      error?.code === "ERR_IPC_CHANNEL_CLOSED" ||
      error?.code === "ERR_IPC_DISCONNECTED"
    ) {
      return;
    }

    throw error;
  }
}

function createRemoteStateClient(callPrimaryState, applySyncPayload = null) {
  async function maybeApplySyncPayload(payload) {
    if (!applySyncPayload || (!payload?.delta && !payload?.snapshot)) {
      return payload;
    }

    await applySyncPayload(payload);
    return payload;
  }

  return {
    acquireLock(area, id, options = {}) {
      return callPrimaryState("acquireLock", {
        area,
        id,
        options
      });
    },
    async deleteEntry(area, id) {
      const payload = await callPrimaryState("deleteEntry", {
        area,
        id
      });
      return maybeApplySyncPayload(payload);
    },
    getDeltaSince(fromVersion) {
      return callPrimaryState("getDeltaSince", {
        fromVersion
      });
    },
    getEntry(area, id) {
      return callPrimaryState("getEntry", {
        area,
        id
      });
    },
    getSnapshot() {
      return callPrimaryState("getSnapshot");
    },
    releaseLock(area, id, lockToken) {
      return callPrimaryState("releaseLock", {
        area,
        id,
        lockToken
      });
    },
    async setEntry(area, id, value, options = {}) {
      const payload = await callPrimaryState("setEntry", {
        area,
        id,
        options,
        value
      });
      return maybeApplySyncPayload(payload);
    },
    takeEntry(area, id) {
      return callPrimaryState("takeEntry", {
        area,
        id
      });
    }
  };
}

function createLocalStateSync(watchdog) {
  return {
    getVersion() {
      return Number(watchdog?.getVersion?.() || 0);
    },
    waitForVersion(minVersion, options = {}) {
      if (!watchdog || typeof watchdog.waitForVersion !== "function") {
        return Promise.resolve({
          satisfied: true,
          timedOut: false,
          version: Number(minVersion) || 0
        });
      }

      return watchdog.waitForVersion(minVersion, options);
    }
  };
}

function invalidateQuotaCache(projectRoot, runtimeParams, projectPaths = []) {
  if (!Array.isArray(projectPaths) || projectPaths.length === 0) {
    return;
  }

  invalidateUserFolderSizeCacheForProjectPaths(
    {
      projectRoot,
      runtimeParams
    },
    projectPaths
  );
}

function collectProjectPathsFromStateDelta(delta = {}) {
  const projectPaths = new Set();

  (Array.isArray(delta?.changes) ? delta.changes : []).forEach((change) => {
    if (String(change?.area || "") !== FILE_INDEX_AREA) {
      return;
    }

    const shardId = String(change?.id || "").trim();

    if (!shardId.startsWith("L2/")) {
      return;
    }

    projectPaths.add(`/app/${shardId}/`);
  });

  return [...projectPaths];
}

function createPrimaryStateHost(stateSystem, publishDelta) {
  function emitDelta(delta) {
    if (!delta || typeof publishDelta !== "function") {
      return;
    }

    publishDelta(delta);
  }

  return {
    ...stateSystem,
    commitEntries(changes = []) {
      const result = stateSystem.commitEntries(changes);
      emitDelta(result?.delta);
      return result;
    },
    deleteEntry(area, id) {
      const result = stateSystem.deleteEntry(area, id);
      emitDelta(result?.delta);
      return result;
    },
    setEntry(area, id, value, options = {}) {
      const result = stateSystem.setEntry(area, id, value, options);
      emitDelta(result?.delta);
      return result;
    }
  };
}

async function startClusterWorker() {
  if (!cluster.isWorker) {
    throw new Error("startClusterWorker() must run inside a cluster worker.");
  }

  const bootstrap = parseWorkerBootstrapEnv();
  const workerNumber = parseWorkerNumberEnv();
  applyProcessTitle(buildServeProcessTitle({ workerNumber }));
  const runtimeParams = hydrateRuntimeParams(bootstrap.runtimeEntries);
  const pendingStateRequests = new Map();
  let app = null;
  let bootstrapResolver = null;
  let bootstrapRejector = null;
  let primaryState = null;
  let shuttingDown = false;
  let watchdog = null;

  function sendMessage(message) {
    sendProcessMessage(process, message);
  }

  function createPrimaryRequest(method, payload = {}, requestPrefix = "state") {
    const requestId = createIpcRequestId(requestPrefix);

    return new Promise((resolve, reject) => {
      pendingStateRequests.set(requestId, {
        reject,
        resolve
      });

      sendMessage({
        method,
        payload,
        requestId,
        type: IPC_MESSAGE_TYPES.STATE_REQUEST
      });
    });
  }

  async function syncWatchdogFromPrimary() {
    if (!watchdog) {
      return null;
    }

    const deltaPayload = await primaryState.getDeltaSince(watchdog.getVersion());

    if (deltaPayload?.delta) {
      await watchdog.applyStateDelta(deltaPayload.delta, {
        emit: false
      });
      return {
        mode: "delta",
        version: watchdog.getVersion()
      };
    }

    const snapshot = await primaryState.getSnapshot();
    clearUserFolderSizeCache();
    await watchdog.applySnapshot(snapshot, {
      emit: false
    });
    return {
      mode: "snapshot",
      version: watchdog.getVersion()
    };
  }

  async function applyPrimarySyncPayload(payload = {}) {
    if (!watchdog) {
      return;
    }

    const quotaProjectPaths =
      Array.isArray(payload.projectPaths) && payload.projectPaths.length > 0
        ? payload.projectPaths
        : collectProjectPathsFromStateDelta(payload.delta);

    invalidateQuotaCache(bootstrap.projectRoot, runtimeParams, quotaProjectPaths);

    try {
      if (payload.snapshot) {
        clearUserFolderSizeCache();
        await watchdog.applySnapshot(payload.snapshot, {
          emit: false
        });
        return;
      }

      if (payload.delta) {
        await watchdog.applyStateDelta(payload.delta, {
          emit: false
        });
      }
    } catch (error) {
      if (error?.code !== "STATE_VERSION_GAP") {
        throw error;
      }

      await syncWatchdogFromPrimary();
    }
  }

  const stateSync = {
    getVersion() {
      return watchdog?.getVersion?.() || 0;
    },
    async waitForVersion(minVersion, options = {}) {
      if (!watchdog || typeof watchdog.waitForVersion !== "function") {
        return {
          satisfied: true,
          timedOut: false,
          version: Number(minVersion) || 0
        };
      }

      const timeoutMs = Math.max(0, Math.floor(Number(options.timeoutMs) || 0));
      let waitResult = await watchdog.waitForVersion(minVersion, {
        timeoutMs
      });

      if (waitResult?.satisfied || timeoutMs <= 0) {
        return waitResult;
      }

      await syncWatchdogFromPrimary();

      waitResult = await watchdog.waitForVersion(minVersion, {
        timeoutMs: Math.max(0, Math.floor(timeoutMs / 2))
      });

      return waitResult;
    }
  };

  primaryState = createRemoteStateClient(createPrimaryRequest, applyPrimarySyncPayload);

  async function shutdown(exitCode = 0) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    try {
      clearUserFolderSizeCache();
      setRuntimeAppPathMutationHandler(null);

      if (app) {
        try {
          await app.close();
        } catch (error) {
          if (error?.code !== "ERR_SERVER_NOT_RUNNING") {
            throw error;
          }
        }
      }

      process.exit(exitCode);
    } catch (error) {
      console.error("Cluster worker shutdown failed.");
      console.error(error);
      process.exit(1);
    }
  }

  async function handlePrimaryMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    switch (message.type) {
      case IPC_MESSAGE_TYPES.STATE_SNAPSHOT:
        if (!watchdog) {
          if (bootstrapResolver) {
            bootstrapResolver(message.snapshot);
            bootstrapResolver = null;
            bootstrapRejector = null;
          }
          return;
        }

        clearUserFolderSizeCache();
        await watchdog.applySnapshot(message.snapshot, {
          emit: false
        });
        return;

      case IPC_MESSAGE_TYPES.STATE_DELTA:
        if (!watchdog || !message.delta) {
          return;
        }

        await applyPrimarySyncPayload({
          delta: message.delta,
          projectPaths: message.projectPaths
        });
        return;

      case IPC_MESSAGE_TYPES.STATE_RESPONSE: {
        const pendingRequest = pendingStateRequests.get(message.requestId);

        if (!pendingRequest) {
          return;
        }

        pendingStateRequests.delete(message.requestId);

        if (message.error) {
          pendingRequest.reject(createRemoteError(message.error));
          return;
        }

        pendingRequest.resolve(message.payload);
        return;
      }

      default:
        return;
    }
  }

  process.on("message", (message) => {
    void handlePrimaryMessage(message).catch((error) => {
      console.error("Cluster worker message handling failed.");
      console.error(error);
    });
  });

  process.on("disconnect", () => {
    void shutdown(0);
  });
  process.on("SIGTERM", () => {
    void shutdown(0);
  });
  process.on("SIGINT", () => {
    void shutdown(0);
  });

  const initialSnapshotPromise = new Promise((resolve, reject) => {
    bootstrapResolver = resolve;
    bootstrapRejector = reject;

    const timeoutId = setTimeout(() => {
      if (bootstrapRejector) {
        bootstrapRejector(new Error("Cluster worker bootstrap timed out."));
        bootstrapResolver = null;
        bootstrapRejector = null;
      }
    }, WORKER_BOOTSTRAP_TIMEOUT_MS);

    timeoutId.unref?.();
  });

  sendMessage({
    type: IPC_MESSAGE_TYPES.WORKER_READY
  });

  const initialSnapshot = await initialSnapshotPromise;

  watchdog = createWatchdog({
    configPath: bootstrap.fileWatchConfigPath,
    initialSnapshot,
    projectRoot: bootstrap.projectRoot,
    replica: true,
    runtimeParams
  });
  await syncWatchdogFromPrimary();

  setRuntimeAppPathMutationHandler(() => true);

  const mutationSync = {
    async commitProjectPaths(projectPaths = []) {
      const response = await createPrimaryRequest(
        "commitProjectPaths",
        {
          projectPaths
        },
        "mutation"
      );

      await applyPrimarySyncPayload(response);

      return {
        projectPaths: Array.isArray(response?.projectPaths) ? response.projectPaths : [],
        version: Number(response?.version) || watchdog.getVersion()
      };
    }
  };

  const auth = createAuthService({
    enableInitialization: false,
    projectRoot: bootstrap.projectRoot,
    runtimeParams,
    stateSystem: primaryState,
    watchdog
  });

  app = await createAgentServer({
    apiDir: bootstrap.apiDir,
    appDir: bootstrap.appDir,
    assetDir: bootstrap.assetDir,
    browserHost: bootstrap.browserHost,
    host: bootstrap.host,
    mutationSync,
    pagesDir: bootstrap.pagesDir,
    projectRoot: bootstrap.projectRoot,
    runtimeParams,
    stateSync,
    tmpDir: bootstrap.tmpDir,
    tmpWatch: createNoopTmpWatch(bootstrap.tmpDir),
    watchdog,
    workerNumber,
    auth
  });

  await app.listen();

  sendMessage({
    port: app.port,
    type: IPC_MESSAGE_TYPES.WORKER_LISTENING
  });

  return app;
}

async function startClusteredServer(overrides = {}) {
  if (!cluster.isPrimary) {
    throw new Error("startClusteredServer() must run inside the cluster primary process.");
  }

  applyProcessTitle(buildServeProcessTitle({ clusterPrimary: true }));
  const bootstrap = overrides.serverBootstrap || (await createServerBootstrap(overrides));
  const fileWatchConfigPath = path.resolve(overrides.fileWatchConfigPath || FILE_WATCH_CONFIG_PATH);
  const workerCount = normalizeWorkerCount(bootstrap.runtimeParams);
  const workerBootstrap = serializeWorkerBootstrap(bootstrap, fileWatchConfigPath);
  const watchdog =
    overrides.watchdog ||
    createWatchdog({
      configPath: fileWatchConfigPath,
      projectRoot: bootstrap.projectRoot,
      runtimeParams: bootstrap.runtimeParams
    });
  const stateSystem = overrides.stateSystem || watchdog.getStateSystem();
  const tmpWatch =
    overrides.tmpWatch ||
    createTmpWatch({
      tmpDir: bootstrap.tmpDir
    });
  let closing = false;
  let listeningPort = Number(bootstrap.runtimeParams.get("PORT", 0)) || 0;
  let startupResolved = false;
  let resolveStartup = null;
  let rejectStartup = null;
  let runtime = null;
  let exitHandler = null;
  let jobRunner = null;
  const workerNumbers = new Map();

  function sendWorkerMessage(worker, message) {
    sendProcessMessage(worker, message);
  }

  function broadcastMessage(message) {
    Object.values(cluster.workers || {}).forEach((worker) => {
      if (worker) {
        sendWorkerMessage(worker, message);
      }
    });
  }

  const primaryStateSystem = createPrimaryStateHost(stateSystem, (delta) => {
    broadcastMessage({
      delta,
      type: IPC_MESSAGE_TYPES.STATE_DELTA
    });
  });
  const auth =
    overrides.auth ||
    createAuthService({
      projectRoot: bootstrap.projectRoot,
      runtimeParams: bootstrap.runtimeParams,
      stateSystem: primaryStateSystem,
      watchdog
    });
  jobRunner =
    overrides.jobRunner ||
    new JobRunner({
      auth,
      jobDir: JOBS_DIR,
      projectRoot: bootstrap.projectRoot,
      runtimeParams: bootstrap.runtimeParams,
      stateSystem: primaryStateSystem,
      watchdog
    });

  async function handleWorkerMessage(worker, message) {
    if (!message || typeof message !== "object") {
      return;
    }

    switch (message.type) {
      case IPC_MESSAGE_TYPES.WORKER_READY:
        sendWorkerMessage(worker, {
          snapshot: watchdog.getSnapshot(),
          type: IPC_MESSAGE_TYPES.STATE_SNAPSHOT
        });
        return;

      case IPC_MESSAGE_TYPES.WORKER_LISTENING:
        if (!startupResolved && Number.isFinite(message.port)) {
          listeningPort = Number(message.port);
          startupResolved = true;

          if (runtime) {
            runtime.browserUrl = buildBrowserUrl(bootstrap.browserHost, listeningPort);
            runtime.port = listeningPort;
          }

          resolveStartup?.();
        }
        return;

      case IPC_MESSAGE_TYPES.STATE_REQUEST: {
        try {
          const method = String(message.method || "");
          let payload;

          switch (method) {
            case "acquireLock":
              payload = await primaryStateSystem.acquireLock(
                message.payload?.area,
                message.payload?.id,
                message.payload?.options || {}
              );
              break;

            case "commitProjectPaths": {
              const projectPaths = Array.isArray(message.payload?.projectPaths)
                ? message.payload.projectPaths
                : [];
              const result = await watchdog.applyProjectPathChanges(projectPaths, {
                emit: false
              });

              if (projectPaths.length > 0) {
                scheduleGitHistoryCommitsForProjectPaths(
                  {
                    projectRoot: bootstrap.projectRoot,
                    runtimeParams: bootstrap.runtimeParams
                  },
                  result.projectPaths || projectPaths
                );
              }

              payload = {
                delta: result.delta || null,
                projectPaths: result.projectPaths || [],
                snapshot: result.snapshot || null,
                version: result.version
              };

              if (payload.snapshot) {
                broadcastMessage({
                  snapshot: payload.snapshot,
                  type: IPC_MESSAGE_TYPES.STATE_SNAPSHOT
                });
              } else if (payload.delta) {
                broadcastMessage({
                  delta: payload.delta,
                  projectPaths: payload.projectPaths,
                  type: IPC_MESSAGE_TYPES.STATE_DELTA
                });
              }
              break;
            }

            case "deleteEntry":
              payload = primaryStateSystem.deleteEntry(message.payload?.area, message.payload?.id);
              break;

            case "getDeltaSince":
              payload = {
                delta: primaryStateSystem.getDeltaSince(message.payload?.fromVersion)
              };
              break;

            case "getEntry":
              payload = primaryStateSystem.getEntry(message.payload?.area, message.payload?.id);
              break;

            case "getSnapshot":
              payload = watchdog.getSnapshot();
              break;

            case "releaseLock":
              payload = primaryStateSystem.releaseLock(
                message.payload?.area,
                message.payload?.id,
                message.payload?.lockToken
              );
              break;

            case "setEntry":
              payload = primaryStateSystem.setEntry(
                message.payload?.area,
                message.payload?.id,
                message.payload?.value,
                message.payload?.options || {}
              );
              break;

            case "takeEntry":
              payload = primaryStateSystem.takeEntry(message.payload?.area, message.payload?.id);
              break;

            default:
              throw new Error(`Unsupported state RPC method: ${method}`);
          }

          sendWorkerMessage(worker, {
            payload,
            requestId: message.requestId,
            type: IPC_MESSAGE_TYPES.STATE_RESPONSE
          });
        } catch (error) {
          sendWorkerMessage(worker, {
            error: {
              message: error.message || "State request failed.",
              statusCode: Number(error.statusCode) || 500
            },
            requestId: message.requestId,
            type: IPC_MESSAGE_TYPES.STATE_RESPONSE
          });
        }
        return;
      }

      default:
        return;
    }
  }

  function forkWorker(workerNumber) {
    const worker = cluster.fork({
      ...process.env,
      [WORKER_BOOTSTRAP_ENV_NAME]: workerBootstrap,
      [WORKER_NUMBER_ENV_NAME]: String(workerNumber),
      [WORKER_SENTINEL_ENV_NAME]: "1"
    });
    workerNumbers.set(worker.id, workerNumber);

    worker.on("message", (message) => {
      void handleWorkerMessage(worker, message).catch((error) => {
        console.error("Cluster primary message handling failed.");
        console.error(error);
      });
    });

    return worker;
  }

  const startupPromise = new Promise((resolve, reject) => {
    resolveStartup = resolve;
    rejectStartup = reject;
  });

  tmpWatch.start();

  try {
    await watchdog.start();
    await auth.initialize();
    await jobRunner.start();

    const unsubscribe = watchdog.subscribe((event) => {
      if (closing) {
        return;
      }

      if (event.type === "delta" && event.delta) {
        broadcastMessage({
          delta: event.delta,
          projectPaths: event.projectPaths,
          type: IPC_MESSAGE_TYPES.STATE_DELTA
        });
        return;
      }

      if (event.type === "snapshot" && event.snapshot) {
        broadcastMessage({
          snapshot: event.snapshot,
          type: IPC_MESSAGE_TYPES.STATE_SNAPSHOT
        });
      }
    });

    cluster.setupPrimary({
      exec: path.join(CURRENT_DIR, "worker_entry.js"),
      serialization: "advanced"
    });

    exitHandler = (worker) => {
      const workerNumber = workerNumbers.get(worker.id) || 0;
      workerNumbers.delete(worker.id);

      if (closing) {
        return;
      }

      forkWorker(workerNumber);
    };

    cluster.on("exit", exitHandler);

    for (let index = 0; index < workerCount; index += 1) {
      forkWorker(index + 1);
    }

    runtime = {
      auth,
      browserUrl: buildBrowserUrl(bootstrap.browserHost, listeningPort),
      host: bootstrap.host,
      port: listeningPort,
      runtimeParams: bootstrap.runtimeParams,
      stateSync: createLocalStateSync(watchdog),
      stateSystem: primaryStateSystem,
      jobRunner,
      tmpWatch,
      watchdog,
      async close() {
        if (closing) {
          return;
        }

        closing = true;
        unsubscribe();

        if (exitHandler) {
          cluster.off("exit", exitHandler);
        }

        await new Promise((resolve) => {
          cluster.disconnect(() => {
            resolve();
          });
        });

        jobRunner.stop();
        await flushGitHistoryCommits();
        tmpWatch.stop();
        watchdog.stop();
      }
    };

    await startupPromise;
    runtime.browserUrl = buildBrowserUrl(bootstrap.browserHost, listeningPort);
    runtime.port = listeningPort;
    return runtime;
  } catch (error) {
    closing = true;
    rejectStartup?.(error);
    jobRunner?.stop();
    tmpWatch.stop();
    watchdog.stop();
    throw error;
  }
}

export {
  WORKER_SENTINEL_ENV_NAME,
  normalizeWorkerCount,
  startClusteredServer,
  startClusterWorker
};
