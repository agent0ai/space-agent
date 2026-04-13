import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAgentServer, createServerBootstrap } from "./app.js";
import { applyProcessTitle, buildServeProcessTitle } from "./lib/utils/process_title.js";
import { resolveProjectVersion } from "./lib/utils/project_version.js";
import { normalizeWorkerCount, startClusteredServer } from "./runtime/cluster.js";

async function startServer(overrides = {}) {
  const serverBootstrap = overrides.serverBootstrap || (await createServerBootstrap(overrides));
  const workerCount = normalizeWorkerCount(serverBootstrap.runtimeParams);

  if (workerCount > 1) {
    applyProcessTitle(buildServeProcessTitle({ clusterPrimary: true }));
    return startClusteredServer({
      ...overrides,
      serverBootstrap
    });
  }

  applyProcessTitle(buildServeProcessTitle());
  const app = await createAgentServer({
    ...overrides,
    serverBootstrap
  });
  await app.listen();
  return app;
}

function logServerStartup(server, projectRoot) {
  console.log(`space server version ${resolveProjectVersion(projectRoot)}`);
  console.log(`space server listening at ${server.browserUrl}`);
}

async function runServeCli(overrides = {}) {
  const app = await startServer(overrides);
  logServerStartup(app, overrides.projectRoot);
  return app;
}

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  runServeCli().catch((error) => {
    console.error("Failed to start space server.");
    console.error(error);
    process.exit(1);
  });
}

export { logServerStartup, runServeCli, startServer };
