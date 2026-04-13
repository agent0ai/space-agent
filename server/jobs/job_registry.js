import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { JobBase } from "./job_base.js";

const RESERVED_FILENAMES = new Set([
  "AGENTS.md",
  "guest_collect.js",
  "job_base.js",
  "job_registry.js",
  "job_runner.js"
]);

export async function loadJobRegistry(jobDir) {
  const registry = new Map();
  const entries = fs
    .readdirSync(jobDir, { withFileTypes: true })
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js") || RESERVED_FILENAMES.has(entry.name)) {
      continue;
    }

    const jobId = entry.name.replace(/\.js$/u, "");
    const jobModule = await import(pathToFileURL(path.join(jobDir, entry.name)).href);
    const JobClass = jobModule.default;

    if (typeof JobClass !== "function") {
      throw new Error(`Job module "${entry.name}" must export a default job class.`);
    }

    const instance = new JobClass({
      jobId
    });

    if (!(instance instanceof JobBase)) {
      throw new Error(
        `Job module "${entry.name}" must export a default class extending JobBase.`
      );
    }

    registry.set(jobId, instance);
  }

  return registry;
}
