const { createFileAggregateStore, normalizeProjectPath, toProjectPath } = require("./store.cjs");

function buildPathIndexAggregate(context) {
  return context.getMatchedPathIndex();
}

function createFileIndex(options = {}) {
  const store = createFileAggregateStore(options);

  return {
    covers(projectPath) {
      return store.coversPath(projectPath);
    },
    getAggregate(name) {
      if (name === "pathIndex") {
        return store.getMatchedPathIndex();
      }

      return store.getAggregate(name);
    },
    getMatchedPathIndex() {
      return store.getMatchedPathIndex();
    },
    getMatchedPaths() {
      return store.getMatchedPaths();
    },
    getSnapshot() {
      return store.getMatchedPathIndex();
    },
    has(projectPath) {
      return store.hasPath(projectPath);
    },
    refresh() {
      return store.refresh();
    },
    registerAggregate(name, buildAggregate) {
      store.registerAggregate(name, buildAggregate);
      return this;
    },
    start() {
      return store.start();
    },
    stop() {
      return store.stop();
    }
  };
}

module.exports = {
  buildPathIndexAggregate,
  createFileIndex,
  normalizeProjectPath,
  toProjectPath
};
