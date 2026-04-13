const LINUX_PROCESS_TITLE_LIMIT = 15;

function clampProcessTitle(value) {
  return String(value || "").trim().slice(0, LINUX_PROCESS_TITLE_LIMIT);
}

function buildSupervisorProcessTitle() {
  return clampProcessTitle("space-supervise");
}

function buildServeProcessTitle(options = {}) {
  const workerNumber = Math.floor(Number(options.workerNumber) || 0);

  if (workerNumber > 0) {
    return clampProcessTitle(`space-serve-w${workerNumber}`);
  }

  if (options.clusterPrimary) {
    return clampProcessTitle("space-serve-p");
  }

  return clampProcessTitle("space-serve");
}

function applyProcessTitle(title) {
  const normalizedTitle = clampProcessTitle(title);

  if (!normalizedTitle) {
    return "";
  }

  process.title = normalizedTitle;
  return normalizedTitle;
}

export {
  applyProcessTitle,
  buildServeProcessTitle,
  buildSupervisorProcessTitle,
  clampProcessTitle
};
