import { deleteGuestUser } from "../lib/auth/user_manage.js";
import { areGuestUsersAllowed } from "../lib/utils/runtime_params.js";
import { JobBase } from "./job_base.js";
import { collectGuestFileStats, listGuestUsernames } from "./guest_collect.js";

const FILE_COUNT_LIMIT = 1_000;
const TOTAL_SIZE_LIMIT_BYTES = 1_000_000_000;
const JOB_INTERVAL_MS = 5 * 60 * 1_000;
const JOB_LOCK_TTL_MS = 10 * 60 * 1_000;

export default class GuestCleanupOversizedJob extends JobBase {
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
    const deletedUsers = [];

    for (const username of listGuestUsernames(context.watchdog)) {
      const stats = collectGuestFileStats(context.watchdog, username);

      if (
        stats.fileCount <= FILE_COUNT_LIMIT &&
        stats.totalSizeBytes <= TOTAL_SIZE_LIMIT_BYTES
      ) {
        continue;
      }

      const deleted = await context.runTrackedMutation(() =>
        deleteGuestUser(context.projectRoot, username, {
          runtimeParams: context.runtimeParams
        })
      );

      if (deleted) {
        deletedUsers.push({
          fileCount: stats.fileCount,
          totalSizeBytes: stats.totalSizeBytes,
          username
        });
      }
    }

    return {
      deletedUsers,
      fileCountLimit: FILE_COUNT_LIMIT,
      totalSizeLimitBytes: TOTAL_SIZE_LIMIT_BYTES
    };
  }
}
