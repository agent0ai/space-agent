export class JobBase {
  constructor(options = {}) {
    this.jobId = String(options.jobId || "").trim();

    if (!this.jobId) {
      throw new Error("JobBase requires a non-empty jobId.");
    }
  }

  getJobId() {
    return this.jobId;
  }

  isEnabled(_context) {
    return true;
  }

  getSchedule() {
    throw new Error(`${this.constructor.name} must implement getSchedule().`);
  }

  async run(_context) {
    throw new Error(`${this.constructor.name} must implement run().`);
  }
}
