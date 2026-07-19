import {
  buildGroupIndexSnapshot,
  hydrateGroupIndexSnapshot,
  serializeGroupIndexSnapshot
} from "../../customware/group_index.js";
import { WatchdogHandler } from "../watchdog.js";

export default class GroupIndexHandler extends WatchdogHandler {
  createInitialState() {
    return buildGroupIndexSnapshot({
      filePaths: [],
      projectRoot: this.projectRoot,
      runtimeParams: this.runtimeParams
    });
  }

  rebuild(context) {
    this.state = buildGroupIndexSnapshot({
      filePaths: context.getCurrentPaths(),
      projectRoot: this.projectRoot,
      runtimeParams: this.runtimeParams
    });
  }

  async onStart(context) {
    this.rebuild(context);
  }

  async onChanges(context) {
    this.rebuild(context);
  }

  restoreState(state) {
    this.state = hydrateGroupIndexSnapshot(state);
  }

  serializeState(state) {
    return serializeGroupIndexSnapshot(state);
  }
}
