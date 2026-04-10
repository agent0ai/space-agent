import path from "node:path";

import { startServeChild } from "./child_process.js";
import {
  ensureReleaseForRevision,
  readRemoteBranchRevision,
  sanitizeRemoteUrl,
  shortRevision
} from "./git_releases.js";
import { createSupervisorProxy } from "./http_proxy.js";

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class SpaceSupervisor {
  constructor(options) {
    this.activeChild = null;
    this.activeTarget = null;
    this.autoUpdateIntervalMs = Number(options.autoUpdateIntervalMs) || 0;
    this.branchName = options.branchName;
    this.childEnv = options.childEnv;
    this.drainIdleMs = options.drainIdleMs;
    this.drainTimeoutMs = options.drainTimeoutMs;
    this.drainingChildren = [];
    this.isCheckingUpdate = false;
    this.isRestarting = false;
    this.isStopping = false;
    this.projectRoot = options.projectRoot;
    this.proxy = null;
    this.publicHost = options.publicHost;
    this.publicPort = options.publicPort;
    this.releasesDir = options.releasesDir;
    this.remoteUrl = options.remoteUrl;
    this.restartBackoffMs = options.restartBackoffMs;
    this.serveArgs = options.serveArgs;
    this.sourceRevision = options.sourceRevision;
    this.startupTimeoutMs = options.startupTimeoutMs;
    this.stopResolve = null;
    this.stopPromise = new Promise((resolve) => {
      this.stopResolve = resolve;
    });
    this.updateTimer = null;
  }

  buildSourceTarget() {
    const revision = this.sourceRevision;

    return {
      label: `source-${shortRevision(revision)}`,
      revision,
      rootDir: this.projectRoot
    };
  }

  getActiveChild() {
    return this.activeChild && this.activeChild.isRunning ? this.activeChild : null;
  }

  attachChildExitHandler(child, target) {
    child.childProcess.once("exit", (code, signal) => {
      if (this.isStopping || child.stopping || child !== this.activeChild) {
        return;
      }

      const exitLabel = signal ? `signal ${signal}` : `code ${code}`;
      console.error(`[supervise] Active serve child ${child.label} exited unexpectedly with ${exitLabel}.`);
      this.activeChild = null;
      this.tryFallbackToDrainingChild();

      if (!this.activeChild) {
        this.scheduleCrashRestart(target);
      }
    });
  }

  async startTarget(target) {
    console.log(`[supervise] Starting ${target.label} from ${path.relative(process.cwd(), target.rootDir) || "."}.`);
    const child = await startServeChild({
      env: this.childEnv,
      label: target.label,
      rootDir: target.rootDir,
      serveArgs: this.serveArgs,
      startupTimeoutMs: this.startupTimeoutMs
    });

    this.attachChildExitHandler(child, target);
    return child;
  }

  tryFallbackToDrainingChild() {
    const fallbackIndex = this.drainingChildren.findLastIndex((entry) => entry.child.isRunning);

    if (fallbackIndex < 0) {
      return false;
    }

    const [fallback] = this.drainingChildren.splice(fallbackIndex, 1);
    this.activeChild = fallback.child;
    this.activeTarget = fallback.target;
    console.error(`[supervise] Reverted proxy to still-running ${fallback.child.label}.`);
    return true;
  }

  scheduleDrain(child, target) {
    const record = {
      child,
      target
    };

    this.drainingChildren.push(record);
    this.drainChild(record).catch((error) => {
      console.error(`[supervise] Failed while draining child ${child.label}.`);
      console.error(error);
    });
  }

  async drainChild(record) {
    const { child } = record;
    const reason = await child.waitForProxyQuiet({
      idleMs: this.drainIdleMs,
      maxMs: this.drainTimeoutMs
    });

    if (!this.drainingChildren.includes(record)) {
      return;
    }

    this.drainingChildren = this.drainingChildren.filter((entry) => entry !== record);
    console.log(`[supervise] Stopping old child ${child.label} after drain ${reason}.`);
    await child.stop({
      graceMs: this.drainIdleMs
    });
  }

  promoteChild(child, target) {
    const previousChild = this.activeChild;
    const previousTarget = this.activeTarget;

    this.activeChild = child;
    this.activeTarget = target;
    console.log(`[supervise] Switched active server to ${child.label} on ${child.url}.`);

    if (previousChild && previousChild.isRunning) {
      this.scheduleDrain(previousChild, previousTarget);
    }
  }

  isAutoUpdateEnabled() {
    return this.autoUpdateIntervalMs > 0;
  }

  scheduleUpdateCheck(delayMs = this.autoUpdateIntervalMs) {
    if (this.isStopping || !this.isAutoUpdateEnabled()) {
      return;
    }

    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      this.checkForUpdates().catch((error) => {
        console.error("[supervise] Update check failed.");
        console.error(error);
      }).finally(() => {
        this.scheduleUpdateCheck();
      });
    }, delayMs);
  }

  async checkForUpdates() {
    if (this.isStopping || this.isCheckingUpdate || !this.isAutoUpdateEnabled()) {
      return;
    }

    this.isCheckingUpdate = true;

    try {
      const remoteRevision = await readRemoteBranchRevision({
        branchName: this.branchName,
        projectRoot: this.projectRoot,
        remoteUrl: this.remoteUrl
      });

      if (this.activeTarget?.revision === remoteRevision) {
        return;
      }

      console.log(
        `[supervise] Found update ${shortRevision(remoteRevision)} on ${sanitizeRemoteUrl(this.remoteUrl)} ${this.branchName}.`
      );

      const target = await ensureReleaseForRevision({
        branchName: this.branchName,
        env: this.childEnv,
        releasesDir: this.releasesDir,
        remoteUrl: this.remoteUrl,
        revision: remoteRevision
      });
      let child;

      try {
        child = await this.startTarget(target);
      } catch (error) {
        console.error(`[supervise] Replacement ${target.label} did not become healthy; keeping ${this.activeChild?.label || "current child"}.`);
        throw error;
      }

      this.promoteChild(child, target);
    } finally {
      this.isCheckingUpdate = false;
    }
  }

  scheduleCrashRestart(target) {
    if (this.isStopping || this.isRestarting) {
      return;
    }

    this.isRestarting = true;
    this.restartFromTarget(target).finally(() => {
      this.isRestarting = false;
    });
  }

  async restartFromTarget(target) {
    let attempt = 0;

    while (!this.isStopping && !this.activeChild) {
      const backoffMs = Math.min(this.restartBackoffMs * 2 ** attempt, 30_000);

      if (attempt > 0) {
        console.error(`[supervise] Waiting ${backoffMs}ms before restarting ${target.label}.`);
        await delay(backoffMs);
      }

      try {
        const child = await this.startTarget(target);

        if (!this.activeChild) {
          this.activeChild = child;
          this.activeTarget = target;
          console.log(`[supervise] Restarted active server as ${child.label} on ${child.url}.`);
          return;
        }

        await child.stop({
          graceMs: this.drainTimeoutMs
        });
        return;
      } catch (error) {
        console.error(`[supervise] Failed to restart ${target.label}.`);
        console.error(error);
        attempt += 1;
      }
    }
  }

  async start() {
    this.activeTarget = this.buildSourceTarget();
    this.activeChild = await this.startTarget(this.activeTarget);
    this.proxy = createSupervisorProxy({
      getActiveChild: () => this.getActiveChild(),
      host: this.publicHost,
      port: this.publicPort
    });

    const listener = await this.proxy.listen();
    console.log(`[supervise] Public proxy listening at ${listener.browserUrl}.`);
    if (this.isAutoUpdateEnabled()) {
      console.log(`[supervise] Checking ${sanitizeRemoteUrl(this.remoteUrl)} ${this.branchName} every ${this.autoUpdateIntervalMs / 1000}s.`);
      this.scheduleUpdateCheck();
      return;
    }

    console.log("[supervise] Auto-update interval <= 0; supervising crash restarts only.");
  }

  async stop() {
    if (this.isStopping) {
      return;
    }

    this.isStopping = true;
    clearTimeout(this.updateTimer);

    const children = [
      this.activeChild,
      ...this.drainingChildren.map((entry) => entry.child)
    ].filter(Boolean);

    this.drainingChildren = [];

    await Promise.all(
      children.map((child) =>
        child.stop({
          graceMs: this.drainTimeoutMs
        }).catch((error) => {
          console.error(`[supervise] Failed to stop child ${child.label}.`);
          console.error(error);
        })
      )
    );

    if (this.proxy) {
      await this.proxy.close().catch((error) => {
        console.error("[supervise] Failed to close public proxy.");
        console.error(error);
      });
    }

    this.stopResolve(0);
  }

  waitForStop() {
    return this.stopPromise;
  }
}

export { SpaceSupervisor };
