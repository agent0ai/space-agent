import { deleteGuestUser } from "../lib/auth/user_manage.js";
import { areGuestUsersAllowed } from "../lib/utils/runtime_params.js";
import { JobBase } from "./job_base.js";
import { collectGuestFileStats, listGuestUsernames } from "./guest_collect.js";

const INACTIVE_CUTOFF_MS = 72 * 60 * 60 * 1_000;
const JOB_INTERVAL_MS = 60 * 60 * 1_000;
const JOB_LOCK_TTL_MS = 30 * 60 * 1_000;

export default class GuestCleanupInactiveJob extends JobBase {
  isEnabled(context = {}) {
    return areGuestUsersAllowed(context.runtimeParams);
  }

  getSchedule() {
    return {
      everyMs: JOB_INTERVAL_MS,
      lockTtlMs: JOB_LOCK_TTL_MS
    };
  }

  async run(context = {}) {
    const cutoffMs = Date.now() - INACTIVE_CUTOFF_MS;
    const deletedUsers = [];

    for (const username of listGuestUsernames(context.watchdog)) {
      const stats = collectGuestFileStats(context.watchdog, username);

      if (stats.latestChangeMs > cutoffMs) {
        continue;
      }

      const deleted = await context.runTrackedMutation(() =>
        deleteGuestUser(context.projectRoot, username, {
          runtimeParams: context.runtimeParams
        })
      );

      if (deleted) {
        deletedUsers.push(username);
      }
    }

    return {
      cutoffMs,
      deletedUsers
    };
  }
}
