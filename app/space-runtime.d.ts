type SpaceExtend = typeof import("./L0/_all/mod/_core/framework/js/extensions.js").extend;
type SpaceCreateStore = typeof import("./L0/_all/mod/_core/framework/js/AlpineStore.js").createStore;
type SpaceYamlParse = typeof import("./L0/_all/mod/_core/framework/js/yaml-lite.js").parseSimpleYaml;
type SpaceYamlStringify = typeof import("./L0/_all/mod/_core/framework/js/yaml-lite.js").serializeSimpleYaml;
type SpaceMarkdownParseDocument = typeof import("./L0/_all/mod/_core/framework/js/markdown-frontmatter.js").parseMarkdownDocument;
type SpaceMarkdownRender = typeof import("./L0/_all/mod/_core/framework/js/markdown-frontmatter.js").renderMarkdown;

type SpaceApiQueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean>;

type SpaceApiCallOptions = {
  method?: string;
  query?: Record<string, SpaceApiQueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

type SpaceFileApiResult = {
  access?: "read" | "write" | string;
  bytesWritten?: number;
  content?: string;
  encoding?: string;
  endpoint?: string;
  gitRepositories?: boolean;
  isDirectory?: boolean;
  modifiedAt?: string;
  path: string;
  paths?: string[];
  recursive?: boolean;
  size?: number;
};

type SpaceFileListOptions = {
  access?: "read" | "write" | string;
  gitRepositories?: boolean;
  path?: string;
  recursive?: boolean;
  writableOnly?: boolean;
};

type SpaceFileBatchApiResult = {
  bytesWritten?: number;
  count: number;
  files: SpaceFileApiResult[];
};

type SpacePathBatchApiResult = {
  count: number;
  paths: string[];
};

type SpaceFileReadInput =
  | string
  | {
      encoding?: string;
      path: string;
    };

type SpaceFileReadBatchOptions = {
  encoding?: string;
  files: SpaceFileReadInput[];
};

type SpaceFileWriteInput = {
  content?: string;
  encoding?: string;
  path: string;
};

type SpaceFileWriteBatchOptions = {
  encoding?: string;
  files: SpaceFileWriteInput[];
};

type SpaceFileDeleteInput =
  | string
  | {
      path: string;
    };

type SpaceFileDeleteBatchOptions = {
  paths: SpaceFileDeleteInput[];
};

type SpaceFileTransferInput =
  | string
  | {
      fromPath: string;
      toPath: string;
    };

type SpaceFileTransferBatchOptions = {
  entries: SpaceFileTransferInput[];
};

type SpaceHealthResult = {
  ok: boolean;
  name: string;
  browserAppUrl: string;
  responsibilities: string[];
};

type SpaceUserSelfInfo = {
  fullName: string;
  groups: string[];
  managedGroups: string[];
  username: string;
};

type SpaceBundleActionInfo = {
  bundleId?: string;
  capability?: string;
  description?: string;
  id: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  title: string;
};

type SpaceBundleInfo = {
  actions: SpaceBundleActionInfo[];
  capabilities: string[];
  compatibility: Record<string, unknown>;
  configDefaults: Record<string, unknown>;
  description: string;
  errors: string[];
  extensionPoints: string[];
  id: string;
  manifestPath: string;
  module?: Record<string, unknown>;
  name: string;
  source: Record<string, unknown>;
  valid: boolean;
  version: string;
};

type SpaceBundleListOptions = {
  area?: string;
  ownerId?: string;
  search?: string;
  username?: string;
};

type SpaceBundleInfoOptions = {
  maxLayer?: number;
  modulePath?: string;
  ownerId?: string;
  path?: string;
  username?: string;
};

type SpaceBundleInfoResult = {
  bundle: SpaceBundleInfo | null;
  installed: boolean;
  module: Record<string, unknown>;
};

type SpaceGitHistoryFile = {
  action?: "added" | "modified" | "deleted" | string;
  oldPath?: string;
  path: string;
  status?: string;
};

type SpaceGitHistoryCommit = {
  changedFiles: string[];
  files?: SpaceGitHistoryFile[];
  hash: string;
  message: string;
  shortHash: string;
  timestamp: string;
};

type SpaceGitHistoryListOptions = {
  fileFilter?: string;
  filter?: string;
  limit?: number;
  offset?: number;
  path?: string;
};

type SpaceGitHistoryListResult = {
  backend: string;
  commits: SpaceGitHistoryCommit[];
  currentHash?: string;
  enabled: boolean;
  hasMore?: boolean;
  limit?: number;
  offset?: number;
  path: string;
  total?: number | null;
};

type SpaceGitHistoryCommitOptions = {
  commit?: string;
  commitHash?: string;
  hash?: string;
  path?: string;
};

type SpaceGitHistoryDiffOptions = SpaceGitHistoryCommitOptions & {
  file?: string;
  filePath?: string;
  pathWithinCommit?: string;
};

type SpaceGitHistoryPreviewOptions = SpaceGitHistoryDiffOptions & {
  operation?: "travel" | "revert" | string;
};

type SpaceGitHistoryMutationResult = {
  backend: string;
  hash: string;
  path: string;
  revertedHash?: string;
  shortHash: string;
};

type SpaceGitHistoryDiffResult = {
  backend: string;
  file: SpaceGitHistoryFile;
  hash: string;
  patch: string;
  path: string;
  shortHash: string;
};

type SpaceGitHistoryPreviewResult = {
  backend: string;
  changedFiles?: string[];
  currentHash?: string;
  file?: SpaceGitHistoryFile | null;
  files?: SpaceGitHistoryFile[];
  hash: string;
  operation?: string;
  patch?: string;
  path: string;
  shortHash: string;
};

type SpaceApi = {
  bundleInfo(pathOrOptions: string | SpaceBundleInfoOptions): Promise<SpaceBundleInfoResult>;
  bundleList(options?: SpaceBundleListOptions): Promise<SpaceBundleInfo[]>;
  call<T = unknown>(endpointName: string, callOptions?: SpaceApiCallOptions): Promise<T>;
  fileCopy(path: string, toPath: string): Promise<SpaceFileApiResult>;
  fileCopy(entry: SpaceFileTransferInput): Promise<SpaceFileApiResult>;
  fileCopy(entries: SpaceFileTransferInput[]): Promise<SpaceFileBatchApiResult>;
  fileCopy(options: SpaceFileTransferBatchOptions): Promise<SpaceFileBatchApiResult>;
  fileDelete(path: string): Promise<SpaceFileApiResult>;
  fileDelete(path: SpaceFileDeleteInput): Promise<SpaceFileApiResult>;
  fileDelete(paths: SpaceFileDeleteInput[]): Promise<SpacePathBatchApiResult>;
  fileDelete(options: SpaceFileDeleteBatchOptions): Promise<SpacePathBatchApiResult>;
  fileList(pathOrOptions: string | SpaceFileListOptions, recursive?: boolean): Promise<SpaceFileApiResult>;
  fileRead(path: string, encoding?: string): Promise<SpaceFileApiResult>;
  fileRead(file: SpaceFileReadInput): Promise<SpaceFileApiResult>;
  fileRead(files: SpaceFileReadInput[], encoding?: string): Promise<SpaceFileBatchApiResult>;
  fileRead(options: SpaceFileReadBatchOptions): Promise<SpaceFileBatchApiResult>;
  fileWrite(path: string, content?: string, encoding?: string): Promise<SpaceFileApiResult>;
  fileWrite(file: SpaceFileWriteInput): Promise<SpaceFileApiResult>;
  fileWrite(files: SpaceFileWriteInput[], encoding?: string): Promise<SpaceFileBatchApiResult>;
  fileWrite(options: SpaceFileWriteBatchOptions): Promise<SpaceFileBatchApiResult>;
  gitHistoryDiff(pathOrOptions: string | SpaceGitHistoryDiffOptions, commitHash?: string, filePath?: string): Promise<SpaceGitHistoryDiffResult>;
  gitHistoryList(pathOrOptions?: string | SpaceGitHistoryListOptions, limit?: number): Promise<SpaceGitHistoryListResult>;
  gitHistoryPreview(pathOrOptions?: string | SpaceGitHistoryPreviewOptions, commitHash?: string, operation?: string, filePath?: string): Promise<SpaceGitHistoryPreviewResult>;
  gitHistoryRollback(pathOrOptions?: string | SpaceGitHistoryCommitOptions, commitHash?: string): Promise<SpaceGitHistoryMutationResult>;
  gitHistoryRevert(pathOrOptions?: string | SpaceGitHistoryCommitOptions, commitHash?: string): Promise<SpaceGitHistoryMutationResult>;
  health(): Promise<SpaceHealthResult>;
  userSelfInfo(): Promise<SpaceUserSelfInfo>;
};

type SpaceFw = {
  createStore: SpaceCreateStore;
};

type SpaceYamlUtils = {
  parse: SpaceYamlParse;
  stringify: SpaceYamlStringify;
};

type SpaceMarkdownUtils = {
  render: SpaceMarkdownRender;
  parseDocument: SpaceMarkdownParseDocument;
};

type SpaceChatAttachment = {
  arrayBuffer(): Promise<ArrayBuffer>;
  dataUrl(): Promise<string>;
  file: File | null;
  id: string;
  json(): Promise<any>;
  lastModified: number;
  messageId: string;
  name: string;
  size: number;
  text(): Promise<string>;
  type: string;
};

type SpaceChatAttachments = {
  current(): SpaceChatAttachment[];
  forMessage(messageId: string): SpaceChatAttachment[];
  get(attachmentId: string): SpaceChatAttachment | null;
};

type SpaceChatTransientSection = {
  content: string;
  heading: string;
  key: string;
  order: number;
};

type SpaceChatTransient = {
  clear(): void;
  delete(key: string): boolean;
  get(key: string): SpaceChatTransientSection | null;
  list(): SpaceChatTransientSection[];
  set(
    keyOrSection:
      | string
      | {
          content?: string;
          heading?: string;
          key?: string;
          label?: string;
          order?: number;
          title?: string;
        },
    nextSection?: {
      content?: string;
      heading?: string;
      key?: string;
      label?: string;
      order?: number;
      title?: string;
    }
  ): SpaceChatTransientSection | null;
  upsert(
    keyOrSection:
      | string
      | {
          content?: string;
          heading?: string;
          key?: string;
          label?: string;
          order?: number;
          title?: string;
        },
    nextSection?: {
      content?: string;
      heading?: string;
      key?: string;
      label?: string;
      order?: number;
      title?: string;
    }
  ): SpaceChatTransientSection | null;
};

type SpaceChatMessage = {
  attachments: any[];
  content: string;
  id: string;
  kind: string;
  role: "assistant" | "user";
  streaming: boolean;
};

type SpaceChatPromptItem = {
  blockType: string;
  content: string;
  heading: string;
  id: number;
  key: string;
  messageId: string;
  order: number;
  part: string;
  removedChars: number;
  role: string;
  source: string;
  sourcePath: string;
  tokens: number;
  trimmed: boolean;
};

type SpaceChatReadLongMessageOptions = {
  from?: number;
  id: number;
  to?: number;
};

type SpaceChat = {
  attachments: SpaceChatAttachments;
  messages: SpaceChatMessage[];
  promptItems: SpaceChatPromptItem[];
  readLongMessage(options: SpaceChatReadLongMessageOptions): string;
  transient: SpaceChatTransient;
};

type SpaceBundleActionRegistration = SpaceBundleActionInfo & {
  name?: string;
  run(payload?: unknown, context?: Record<string, unknown>): unknown | Promise<unknown>;
};

type SpaceBundlesNamespace = {
  actions: {
    get(id: string): SpaceBundleActionInfo | null;
    list(): SpaceBundleActionInfo[];
    register(action: SpaceBundleActionRegistration): () => boolean;
    run(id: string, payload?: unknown, context?: Record<string, unknown>): Promise<unknown>;
    unregister(id: string): boolean;
  };
  bridge: {
    registerSync(
      id: string,
      handler: (payload?: unknown, context?: Record<string, unknown>) => unknown | Promise<unknown>
    ): () => boolean;
    syncState(id: string, payload?: unknown, context?: Record<string, unknown>): Promise<unknown>;
    unregisterSync(id: string): boolean;
  };
  info(pathOrOptions: string | SpaceBundleInfoOptions): Promise<SpaceBundleInfoResult>;
  list(options?: SpaceBundleListOptions): Promise<SpaceBundleInfo[]>;
};

type SpaceUtils = {
  markdown?: SpaceMarkdownUtils;
  yaml?: SpaceYamlUtils;
  [key: string]: any;
};

type SpaceWidgetSize =
  | string
  | [number, number]
  | {
      cols?: number;
      rows?: number;
    };

type SpaceWidgetPosition = {
  col: number;
  row: number;
};

type SpaceWidgetLayoutInput = {
  col?: number;
  cols?: number;
  id?: string;
  position?: Partial<SpaceWidgetPosition>;
  row?: number;
  rows?: number;
  size?: SpaceWidgetSize;
  widgetId?: string;
};

type SpaceWidgetRemovalResult = {
  space: SpaceSpaceRecord;
  widgetIds: string[];
};

// Renderer-only edit against the zero-based numbered renderer lines shown in a
// readWidget() response or the post-write TRANSIENT Current Widget envelope's
// source↓ block.
// Metadata fields are updated through explicit patchWidget inputs, and multi-edit
// patches are applied from the highest original line toward the lowest.
type SpaceWidgetTextEdit = {
  content?: string;
  from: number;
  to?: number;
};

type SpaceWidgetRenderCheck = {
  checked: boolean;
  message: string;
  needsRepair: boolean;
  ok: boolean | null;
  phase: string;
  status: "ok" | "error" | "not_checked";
  widgetId: string;
};

type SpaceSpaceRecord = {
  agentInstructions: string;
  createdAt: string;
  id: string;
  icon: string;
  iconColor: string;
  minimizedWidgetIds: string[];
  path: string;
  specialInstructions: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  title: string;
  updatedAt: string;
  widgetIds: string[];
  widgetPositions: Record<string, SpaceWidgetPosition>;
  widgetSizes: Record<string, { cols: number; rows: number }>;
  widgetTitles: Record<string, string>;
};

type SpaceSpaceListEntry = SpaceSpaceRecord & {
  displayIcon: string;
  displayIconColor: string;
  displayTitle: string;
  hiddenWidgetCount: number;
  updatedAtLabel: string;
  widgetCount: number;
  widgetCountLabel: string;
  widgetNames: string[];
  widgetPreviewNames: string[];
};

type SpaceWidgetWriteResult = {
  space: SpaceSpaceRecord;
  widgetId: string;
  widgetPath: string;
  widgetText: string;
};

type SpaceSpaceReloadOptions = {
  animateEntering?: boolean;
  captureThumbnail?: boolean;
  preserveCamera?: boolean;
  resetCamera?: boolean;
  widgetId?: string;
};

type SpaceCurrentNamespace = {
  agentInstructions: string;
  byId: Record<string, any>;
  icon: string;
  iconColor: string;
  id: string;
  // Returns a compact plain-text catalog: `widgets (id|name|description):` plus one row per widget.
  listWidgets(): string;
  patchWidget(
    widgetId: string,
    options?: {
      col?: number;
      cols?: number;
      edits?: SpaceWidgetTextEdit[];
      lineEdits?: SpaceWidgetTextEdit[];
      name?: string;
      position?: Partial<SpaceWidgetPosition>;
      row?: number;
      rows?: number;
      size?: SpaceWidgetSize;
      title?: string;
    }
  ): Promise<string>;
  path: string;
  // Returns the metadata-first numbered widget readback directly in the response.
  readWidget(widgetName: string): Promise<string>;
  // Returns the current mounted widget instance inner HTML. `full=false` strips JS/CSS-heavy attributes and tags.
  seeWidget(widgetName: string, full?: boolean): Promise<string>;
  reloadWidget(widgetId: string): Promise<string>;
  specialInstructions: string;
  title: string;
  updatedAt: string;
  widgets: any[];
  [key: string]: any;
};

type SpaceSpacesNamespace = {
  createSpace(options?: {
    agentInstructions?: string;
    id?: string;
    icon?: string;
    iconColor?: string;
    instructions?: string;
    open?: boolean;
    replace?: boolean;
    specialInstructions?: string;
    title?: string;
  }): Promise<SpaceSpaceRecord>;
  createWidgetSource(options?: {
    html?: string;
    size?: SpaceWidgetSize;
    title?: string;
  }): string;
  defineWidget(definition: any): any;
  duplicateSpace(spaceIdOrOptions?: string | { id?: string; newId?: string; spaceId?: string }): Promise<SpaceSpaceRecord>;
  getCurrentSpace(): SpaceSpaceRecord | null;
  installExampleSpace(options?: {
    agentInstructions?: string;
    fromPath?: string;
    id?: string;
    icon?: string;
    iconColor?: string;
    instructions?: string;
    open?: boolean;
    replace?: boolean;
    sourcePath?: string;
    specialInstructions?: string;
    title?: string;
  }): Promise<SpaceSpaceRecord>;
  listSpaces(): Promise<SpaceSpaceListEntry[]>;
  openSpace(spaceId: string, options?: { replace?: boolean }): Promise<void>;
  patchWidget(options: {
    col?: number;
    cols?: number;
    edits?: SpaceWidgetTextEdit[];
    id?: string;
    lineEdits?: SpaceWidgetTextEdit[];
    name?: string;
    position?: Partial<SpaceWidgetPosition>;
    row?: number;
    rows?: number;
    size?: SpaceWidgetSize;
    spaceId?: string;
    title?: string;
    widgetId: string;
  }): Promise<string>;
  readSpace(spaceId: string): Promise<SpaceSpaceRecord>;
  rearrangeWidgets(options: { spaceId?: string; widgetLayouts?: SpaceWidgetLayoutInput[]; widgets: SpaceWidgetLayoutInput[] }): Promise<SpaceSpaceRecord>;
  reloadCurrentSpace(options?: SpaceSpaceReloadOptions): Promise<SpaceSpaceRecord>;
  reloadWidget(widgetIdOrOptions: string | { spaceId?: string; widgetId: string }): Promise<string>;
  removeWidget(options: { spaceId?: string; widgetId: string }): Promise<{ space: SpaceSpaceRecord; widgetId: string }>;
  removeWidgets(options: { spaceId?: string; widgetIds: string[] }): Promise<SpaceWidgetRemovalResult>;
  removeAllWidgets(spaceIdOrOptions?: string | { id?: string; spaceId?: string }): Promise<SpaceWidgetRemovalResult>;
  resolveAppUrl(path: string): string;
  saveSpaceLayout(options: {
    id: string;
    minimizedWidgetIds?: string[];
    widgetIds?: string[];
    widgetPositions?: Record<string, Partial<SpaceWidgetPosition>>;
    widgetSizes?: Record<string, SpaceWidgetSize>;
  }): Promise<SpaceSpaceRecord>;
  saveSpaceMeta(options: {
    agentInstructions?: string;
    id: string;
    icon?: string;
    iconColor?: string;
    instructions?: string;
    specialInstructions?: string;
    title?: string;
  }): Promise<SpaceSpaceRecord>;
  sizeToToken(size: SpaceWidgetSize): string;
  toggleWidgets(options: { spaceId?: string; widgetIds: string[] }): Promise<SpaceSpaceRecord>;
  upsertWidget(options: {
    col?: number;
    cols?: number;
    html?: string;
    metadata?: Record<string, any>;
    name?: string;
    position?: Partial<SpaceWidgetPosition>;
    refresh?: boolean;
    renderer?: string;
    resetCamera?: boolean;
    row?: number;
    rows?: number;
    size?: SpaceWidgetSize;
    source?: string;
    spaceId?: string;
    title?: string | null;
    widgetId?: string;
  }): Promise<string>;
  upsertWidgets(options: {
    refresh?: boolean;
    resetCamera?: boolean;
    spaceId?: string;
    widgets: Array<{
      col?: number;
      cols?: number;
      html?: string;
      id?: string;
      metadata?: Record<string, any>;
      name?: string;
      position?: Partial<SpaceWidgetPosition>;
      renderer?: string;
      row?: number;
      rows?: number;
      size?: SpaceWidgetSize;
      source?: string;
      title?: string | null;
      widgetId?: string;
    }>;
  }): Promise<{ space: SpaceSpaceRecord; widgetIds: string[]; widgetResults: SpaceWidgetWriteResult[] }>;
  current: SpaceCurrentNamespace | null;
  currentId: string;
  widgetApiVersion: number;
  [key: string]: any;
};

type SpaceBrowserWindowState = {
  addressValue?: string;
  bridgeHandlersReady?: boolean;
  bridgeReady?: boolean;
  bridgeStateReady?: boolean;
  bridgeTransportReady?: boolean;
  browserId?: number;
  browserInternalId?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  coreReady?: boolean;
  currentUrl?: string;
  frameSrc?: string;
  id?: number;
  instanceKey?: number;
  isMinimized?: boolean;
  loading?: boolean;
  position?: {
    x?: number;
    y?: number;
  };
  preloadReady?: boolean;
  size?: {
    height?: number;
    width?: number;
  };
  title?: string;
  zIndex?: number;
  [key: string]: any;
};

type SpaceBrowserContentOptions = {
  includeLabelQuotes?: boolean;
  includeLinkUrls?: boolean;
  includeListIndentation?: boolean;
  includeListMarkers?: boolean;
  includeSemanticTags?: boolean;
  includeStateTags?: boolean;
  selectors?: string[];
  [key: string]: any;
};

type SpaceBrowserCaptureResult = {
  captureId?: number;
  capturedAt?: number;
  document?: string;
  [key: string]: any;
};

type SpaceBrowserReferenceState = {
  blocked?: boolean;
  busy?: boolean;
  checked?: boolean;
  current?: boolean;
  cursor?: string;
  descriptorTags?: string[];
  disabled?: boolean;
  expanded?: boolean;
  invalid?: boolean;
  opacity?: number;
  pointerEventsNone?: boolean;
  pressed?: boolean;
  readonly?: boolean;
  required?: boolean;
  selected?: boolean;
  semanticTags?: string[];
  semanticTone?: string;
  stateTags?: string[];
  visible?: boolean;
  zeroRect?: boolean;
  [key: string]: any;
};

type SpaceBrowserDetailResult = {
  captureId?: number;
  capturedAt?: number;
  connected?: boolean;
  descriptorTags?: string[];
  dom?: string;
  frameChain?: string[];
  frameId?: string;
  nodeId?: string;
  referenceId?: number | string;
  semanticTags?: string[];
  state?: SpaceBrowserReferenceState;
  summary?: string;
  tagName?: string;
  [key: string]: any;
};

type SpaceBrowserActionStatus = {
  alertTextAdded?: boolean;
  checkedChanged?: boolean;
  descriptorChanged?: boolean;
  domChanged?: boolean;
  expandedChanged?: boolean;
  focusChanged?: boolean;
  historyChanged?: boolean;
  navigated?: boolean;
  nearbyTextChanged?: boolean;
  noObservedEffect?: boolean;
  pressedChanged?: boolean;
  reacted?: boolean;
  selectedChanged?: boolean;
  targetChanged?: boolean;
  targetDomChanged?: boolean;
  titleChanged?: boolean;
  urlChanged?: boolean;
  validationTextAdded?: boolean;
  valueChanged?: boolean;
  [key: string]: boolean | undefined;
};

type SpaceBrowserActionEffect = {
  mutationAttributes?: string[];
  mutationCount?: number;
  newText?: string[];
  semanticHints?: string[];
  validationText?: string[];
  [key: string]: any;
};

type SpaceBrowserActionResult = {
  captureId?: number;
  descriptorTags?: string[];
  effect?: SpaceBrowserActionEffect;
  frameChain?: string[];
  frameId?: string;
  nodeId?: string;
  referenceId?: number | string;
  semanticTags?: string[];
  state?: SpaceBrowserReferenceState;
  status?: SpaceBrowserActionStatus;
  summary?: string;
  tagName?: string;
  value?: string;
  [key: string]: any;
};

type SpaceBrowserInteractionResult = {
  action: SpaceBrowserActionResult;
  state: SpaceBrowserWindowState;
};

type SpaceBrowserNamespace = {
  back(id: number | string): Promise<SpaceBrowserWindowState>;
  click(id: number | string, ref: number | string): Promise<SpaceBrowserInteractionResult>;
  close(id: number | string): any;
  closeAll(): any;
  content(id: number | string, payload?: SpaceBrowserContentOptions | null, options?: Record<string, any>): Promise<SpaceBrowserCaptureResult>;
  count(): number;
  create(options?: string | { url?: string; [key: string]: any }): Promise<SpaceBrowserWindowState>;
  detail(id: number | string, ref: number | string, options?: Record<string, any>): Promise<SpaceBrowserDetailResult>;
  dom(id: number | string, payload?: SpaceBrowserContentOptions | null, options?: Record<string, any>): Promise<SpaceBrowserCaptureResult>;
  focus(id: number | string, options?: Record<string, any>): Promise<SpaceBrowserWindowState>;
  forward(id: number | string): Promise<SpaceBrowserWindowState>;
  has(id: number | string): boolean;
  ids(): number[];
  list(): SpaceBrowserWindowState[];
  navigate(id: number | string, url: string): Promise<SpaceBrowserWindowState>;
  open(options?: string | { url?: string; [key: string]: any }): Promise<SpaceBrowserWindowState>;
  reload(id: number | string): Promise<SpaceBrowserWindowState>;
  scroll(id: number | string, ref: number | string): Promise<SpaceBrowserInteractionResult>;
  send(id: number | string, type: string, payload?: any, options?: Record<string, any>): Promise<any>;
  setLogLevel(level: "debug" | "info" | "warn" | "error" | "silent" | string): string;
  state(id: number | string): Promise<SpaceBrowserWindowState>;
  submit(id: number | string, ref: number | string): Promise<SpaceBrowserInteractionResult>;
  type(id: number | string, ref: number | string, value?: string): Promise<SpaceBrowserInteractionResult>;
  typeSubmit(id: number | string, ref: number | string, value?: string): Promise<SpaceBrowserInteractionResult>;
};

type SpaceRuntime = {
  api?: SpaceApi;
  browser?: SpaceBrowserNamespace;
  bundles?: SpaceBundlesNamespace;
  chat?: SpaceChat;
  current?: SpaceCurrentNamespace | null;
  extend: SpaceExtend;
  fw?: SpaceFw;
  spaces?: SpaceSpacesNamespace;
  utils?: SpaceUtils;
  [key: string]: any;
};

declare global {
  var space: SpaceRuntime;

  interface Window {
    space: SpaceRuntime;
  }
}

export {};
