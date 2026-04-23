const inFlightRefreshes = new Map();

export async function runSingleWriterRefresh(refreshToken, worker) {
  const key = typeof refreshToken === "string" ? refreshToken : "";

  if (!key) {
    return worker();
  }

  const existing = inFlightRefreshes.get(key);

  if (existing) {
    // Coalesce concurrent refreshes for the same refresh token so we never
    // post the same single-use token twice at the same moment; that would
    // consume it twice and leave one caller with invalid_grant.
    return existing;
  }

  const pending = (async () => {
    try {
      return await worker();
    } finally {
      inFlightRefreshes.delete(key);
    }
  })();

  inFlightRefreshes.set(key, pending);
  return pending;
}
