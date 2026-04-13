import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

const PROJECT_ROOT = path.join(CURRENT_DIR, "..");
const APP_ROOT_DIR = path.join(CURRENT_DIR, "..", "app");
const L0_DIR = path.join(APP_ROOT_DIR, "L0");
const L1_DIR = path.join(APP_ROOT_DIR, "L1");
const L2_DIR = path.join(APP_ROOT_DIR, "L2");
const APP_DIR = L0_DIR;
const ASSET_DIR = path.join(L0_DIR, "assets");
const API_DIR = path.join(CURRENT_DIR, "api");
const JOBS_DIR = path.join(CURRENT_DIR, "jobs");
const PAGES_DIR = path.join(CURRENT_DIR, "pages");
const FILE_WATCH_CONFIG_PATH = path.join(CURRENT_DIR, "lib", "file_watch", "config.yaml");
const SERVER_TMP_DIR = path.join(CURRENT_DIR, "tmp");

export {
  API_DIR,
  APP_ROOT_DIR,
  ASSET_DIR,
  APP_DIR,
  FILE_WATCH_CONFIG_PATH,
  JOBS_DIR,
  L0_DIR,
  L1_DIR,
  L2_DIR,
  PAGES_DIR,
  PROJECT_ROOT,
  SERVER_TMP_DIR
};
