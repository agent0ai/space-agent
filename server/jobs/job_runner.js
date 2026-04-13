import { runTrackedMutation } from "../runtime/request_mutations.js";
import { loadJobRegistry } from "./job_registry.js";

const JOB_LOCK_AREA = "job_run";
const MIN_DELAY_MS = 10;

function normalizeDelayMs(value, fallbackMs) {
  const normalizedValue = Math.floor(Number(value));
  return Number.isFinite(normalizedValue) && normalizedValue >= 0 ? normalizedValue : fallbackMs;
}

function normalizeSchedule(rawSchedule = {}) {
  const everyMs = Math.max(1, Math.floor(Number(rawSchedule.everyMs)));

  if (!Number.isFinite(everyMs)) {
    throw new Error("Job schedules must define a positive everyMs interval.");
  }

  return {
    everyMs,
    initialDelayMs: normalizeDelayMs(rawSchedule.initialDelayMs, everyMs),
    lockTtlMs: Math.max(everyMs, normalizeDelayMs(rawSchedule.lockTtlMs, everyMs))
  };
}

function createInitialJobState(job, schedule) {
  return {
    failureCount: 0,
    job,
    lastError: null,
    lastFinishedAt: 0,
    lastStartedAt: 0,
    lastSucceededAt: 0,
    nextDueAt: Date.now() + schedule.initialDelayMs,
    running: false,
    schedule,
    timerId: null
  };
}

function createJobContext(runner, jobId) {
  return {
    auth: runner.auth,
    jobId,
    projectRoot: runner.projectRoot,
    runTrackedMutation: (callback) =>
      runTrackedMutation(
        {
          mutationSync: runner.mutationSync,
          watchdog: runner.watchdog
        },
        callback
      ),
    runtimeParams: runner.runtimeParams,
    stateSystem: runner.stateSystem,
    watchdog: runner.watchdog
  };
}

export class JobRunner {
  constructor(options = {}) {
    this.auth = options.auth || null;
    this.jobDir = String(options.jobDir || "");
    this.jobs = options.jobs || null;
    this.jobStates = new Map();
    this.mutationSync = options.mutationSync || null;
    this.projectRoot = String(options.projectRoot || "");
    this.runtimeParams = options.runtimeParams || null;
    this.started = false;
    this.stateSystem = options.stateSystem || null;
    this.watchdog = options.watchdog || null;
  }

  async loadJobs() {
    if (this.jobs instanceof Map) {
      return this.jobs;
    }

    if (!this.jobDir) {
      throw new Error("JobRunner requires a jobDir or preloaded jobs.");
    }

    this.jobs = await loadJobRegistry(this.jobDir);
    return this.jobs;
  }

  async start() {
    if (this.started) {
      return this;
    }

    const jobs = await this.loadJobs();
    this.started = true;

    for (const job of jobs.values()) {
      const jobId = job.getJobId();
      const jobContext = createJobContext(this, jobId);

      if (typeof job.isEnabled === "function" && !job.isEnabled(jobContext)) {
        continue;
      }

      const schedule = normalizeSchedule(job.getSchedule());
      const jobState = createInitialJobState(job, schedule);
      this.jobStates.set(jobId, jobState);
      this.scheduleJob(jobState);
    }

    return this;
  }

  stop() {
    if (!this.started) {
      return;
    }

    this.started = false;

    for (const jobState of this.jobStates.values()) {
      if (jobState.timerId) {
        clearTimeout(jobState.timerId);
        jobState.timerId = null;
      }
    }
  }

  scheduleJob(jobState) {
    if (!this.started) {
      return;
    }

    if (jobState.timerId) {
      clearTimeout(jobState.timerId);
    }

    const delayMs = Math.max(MIN_DELAY_MS, Number(jobState.nextDueAt) - Date.now());
    jobState.timerId = setTimeout(() => {
      void this.runJob(jobState);
    }, delayMs);
    jobState.timerId.unref?.();
  }

  async runJob(jobState) {
    if (!this.started || jobState.running) {
      return;
    }

    const startedAt = Date.now();
    const jobId = jobState.job.getJobId();
    let lockRecord = null;

    jobState.running = true;
    jobState.lastStartedAt = startedAt;
    jobState.lastError = null;

    try {
      const jobContext = createJobContext(this, jobId);

      if (typeof jobState.job.isEnabled === "function" && !jobState.job.isEnabled(jobContext)) {
        return;
      }

      if (this.stateSystem && typeof this.stateSystem.acquireLock === "function") {
        lockRecord = await this.stateSystem.acquireLock(JOB_LOCK_AREA, jobId, {
          ttlMs: jobState.schedule.lockTtlMs,
          waitMs: 0
        });

        if (!lockRecord?.acquired) {
          return;
        }
      }

      await jobState.job.run(jobContext);

      jobState.failureCount = 0;
      jobState.lastSucceededAt = Date.now();
    } catch (error) {
      jobState.failureCount += 1;
      jobState.lastError =
        error instanceof Error ? error : new Error(String(error || "Unknown job failure."));
      console.error(`Job "${jobId}" failed.`);
      console.error(jobState.lastError);
    } finally {
      if (
        lockRecord?.acquired &&
        lockRecord.lockToken &&
        this.stateSystem &&
        typeof this.stateSystem.releaseLock === "function"
      ) {
        this.stateSystem.releaseLock(JOB_LOCK_AREA, jobId, lockRecord.lockToken);
      }

      jobState.running = false;
      jobState.lastFinishedAt = Date.now();
      jobState.nextDueAt = Math.max(jobState.lastStartedAt + jobState.schedule.everyMs, Date.now());

      if (this.started) {
        this.scheduleJob(jobState);
      }
    }
  }
}
