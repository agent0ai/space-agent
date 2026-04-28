# Graph Report - space-agent  (2026-04-28)

## Corpus Check
- 344 files · ~1,047,933 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4529 nodes · 10184 edges · 54 communities detected
- Extraction: 82% EXTRACTED · 18% INFERRED · 0% AMBIGUOUS · INFERRED: 1793 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]

## God Nodes (most connected - your core abstractions)
1. `get()` - 125 edges
2. `parse()` - 86 edges
3. `has()` - 70 edges
4. `__awaiter()` - 56 edges
5. `log()` - 46 edges
6. `LLMChatPipeline` - 43 edges
7. `HuggingFaceManager` - 43 edges
8. `add()` - 38 edges
9. `call()` - 35 edges
10. `BrowserHarnessController` - 35 edges

## Surprising Connections (you probably didn't know these)
- `fetchDesktopUpdateMetadataText()` --calls--> `text()`  [INFERRED]
  packaging/desktop/main.js → app/L0/_all/mod/_core/framework/js/marked.esm.js
- `defineBrowserElement()` --calls--> `get()`  [INFERRED]
  app/L0/_all/mod/_core/web_browsing/browser-element.js → server/api/cloud_share_info.js
- `send()` --calls--> `sendProcessMessage()`  [INFERRED]
  app/L0/_all/mod/_core/web_browsing/browser-frame-bridge.js → server/runtime/cluster.js
- `parse()` --calls--> `readJsonObject()`  [INFERRED]
  app/L0/_all/mod/_core/framework/js/marked.esm.js → server/lib/auth/user_index.js
- `parse()` --calls--> `parseDotEnvValue()`  [INFERRED]
  app/L0/_all/mod/_core/framework/js/marked.esm.js → server/lib/utils/env_files.js

## Hyperedges (group relationships)
- **Architecture governance loop** — Browser-first runtime, Thin server infrastructure, Layered customware model, Documentation-first contract [INFERRED 0.82]
- **Agent capability loop** — Module extension system, Text-based agent skills, Prompt context system, Browser surface runtime [INFERRED 0.80]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.01
Nodes (120): areArraysEqual(), areChatOptionsEqual(), areChatOptionsListEqual(), areObjectsEqual(), __asyncGenerator(), asyncLoadTokenizer(), AttentionSinkSizeError, __await() (+112 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (179): get(), sendEnvelope(), appendDesktopUpdaterPersistentLog(), applyDesktopBrowserViewVisibility(), applyPackagedDesktopStorageOverrides(), applyPackagedDesktopUserDataOverride(), blockDesktopMainWindowNavigation(), buildDesktopFrameInjectionSource() (+171 more)

### Community 2 - "Community 2"
Cohesion: 0.03
Nodes (189): get(), handleRead(), hasBatchRead(), post(), readEncoding(), readPath(), readPayload(), get() (+181 more)

### Community 3 - "Community 3"
Cohesion: 0.02
Nodes (151): createHttpError(), createNormalizePattern(), post(), readPayload(), readRequestedGroups(), readRequestedPatterns(), post(), readPayload() (+143 more)

### Community 4 - "Community 4"
Cohesion: 0.02
Nodes (150): combineCleanupFunctions(), createElement(), createEmptyCanvasState(), createLoadingCanvasState(), getOnscreenAgentStore(), startChatExampleButtonStatusSync(), startEmptyCanvasAnimations(), startEmptyCanvasSequenceAnimation() (+142 more)

### Community 5 - "Community 5"
Cohesion: 0.02
Nodes (139): buildAssistantMessageRepeatLog(), inspectAssistantMessageRepeat(), normalizeAssistantEvaluationLogEntry(), normalizeAssistantMessageContent(), toOrdinal(), createAsyncRunner(), createExecutionContext(), createExecutionError() (+131 more)

### Community 6 - "Community 6"
Cohesion: 0.02
Nodes (127): buildPromptLongMessagePlaceholder(), buildPromptOverflowTrimPlan(), buildPromptOverflowTrimPlanCore(), clampPromptBudgetNumber(), deletePromptItem(), estimatePromptCharsForTokenRemoval(), listPromptItems(), mergePromptItemMaps() (+119 more)

### Community 7 - "Community 7"
Cohesion: 0.04
Nodes (136): normalizeExampleEntry(), normalizeSpaceEntry(), normalizeWidgetPreviewNames(), getSpaceDisplayIcon(), getSpaceDisplayIconColor(), getSpaceDisplayTitle(), normalizeLineEndings(), normalizeSpaceAgentInstructions() (+128 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (79): BrowserHarnessController, createDeferred(), createNamedError(), delay(), formatValue(), isHashOnlyNavigation(), log(), looksLikeLocalHost() (+71 more)

### Community 9 - "Community 9"
Cohesion: 0.04
Nodes (124): buildSessionSignaturePayload(), createChallengeToken(), createPersistedSessionRecord(), createSessionCookieHeader(), createSessionId(), createSessionSignature(), createSessionToken(), createSessionVerifier() (+116 more)

### Community 10 - "Community 10"
Cohesion: 0.02
Nodes (88): buildUserIndexSnapshot(), createEmptyUserIndex(), createEmptyUserRecord(), ensureUser(), hydrateUserIndexSnapshot(), readJsonObject(), serializeUserIndexSnapshot(), buildGroupIndexSnapshot() (+80 more)

### Community 11 - "Community 11"
Cohesion: 0.02
Nodes (101): loadApiRegistry(), createAuthService(), createStateBackedLoginChallengeStore(), openRouterAdminRequestHook(), openRouterOnscreenRequestHook(), clonePathIndex(), cloneWatchConfig(), collectFullScanRoots() (+93 more)

### Community 12 - "Community 12"
Cohesion: 0.03
Nodes (105): createHttpError(), post(), buildUploadMeta(), post(), createHttpError(), get(), post(), createHttpError() (+97 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (119): dispatchEnvelopeToMainWorld(), dispatchWheelToElement(), activateElement(), buildActionEffectResult(), buildActionResult(), buildHelperBackedActionResult(), capture(), captureActionEffectSnapshot() (+111 more)

### Community 14 - "Community 14"
Cohesion: 0.03
Nodes (100): installBrowserDomHelper(), compareDesktopDebugReleaseVersions(), createDesktopDebugReleaseProvider(), escapeDesktopDebugRegExp(), findDesktopWindowsReleaseFile(), getDesktopDebugReleaseBlockMapFiles(), getDesktopWindowsReleaseFiles(), normalizeDesktopDebugGitHubHost() (+92 more)

### Community 15 - "Community 15"
Cohesion: 0.03
Nodes (88): get(), createClearedSessionCookieHeader(), execute(), JobBase, loadJobRegistry(), createInitialJobState(), createJobContext(), JobRunner (+80 more)

### Community 16 - "Community 16"
Cohesion: 0.04
Nodes (57): addMediaChangeListener(), createSpaceBackdropRuntime(), destroySpaceBackdrop(), asFiniteNumber(), buildChatMessages(), buildHuggingFaceFallbackPrompt(), createSavedModelEntry(), describeModelSelection() (+49 more)

### Community 17 - "Community 17"
Cohesion: 0.03
Nodes (95): buildIsomorphicPatch(), buildUnifiedDiffBody(), buildUnifiedDiffOperations(), createHistoryRepoOptions(), createIgnoredPathsCacheKey(), createIsomorphicCommitListEntry(), createIsomorphicGitClient(), createIsomorphicGitCloneClient() (+87 more)

### Community 18 - "Community 18"
Cohesion: 0.04
Nodes (97): buildCaseErrorResult(), buildRepeatedCaseResult(), collectCommonFailures(), compareHistoricalPrompt(), delay(), evaluateResponse(), extractMessageContent(), findBestPerModel() (+89 more)

### Community 19 - "Community 19"
Cohesion: 0.03
Nodes (78): loginHooksInitializerEnd(), closeDialog(), openDialog(), callJsonApi(), findRuntimeContextElement(), getAttributeValues(), getContents(), getContexts() (+70 more)

### Community 20 - "Community 20"
Cohesion: 0.03
Nodes (65): installPromptItemAccess(), ensureChatRuntime(), buildAttachmentListBlock(), buildAttachmentListLines(), buildAttachmentRuntimeAccessBlock(), buildMessageContentForApi(), buildMessagePromptParts(), createAttachmentId() (+57 more)

### Community 21 - "Community 21"
Cohesion: 0.04
Nodes (95): resolveChatRequestUrl(), ensureIsomorphicRepository(), createApiClient(), createApiError(), createFileDeleteRequest(), createFileInfoRequest(), createFileListRequest(), createFileReadEntryKey() (+87 more)

### Community 22 - "Community 22"
Cohesion: 0.04
Nodes (72): createAdminEmptyState(), installSpaceBackdrop(), installSpaceBackdrop(), buildDefaultEmptyState(), collectFrameEntries(), ensureFrameName(), installDocumentObserver(), installFrameRegistrySync() (+64 more)

### Community 23 - "Community 23"
Cohesion: 0.04
Nodes (64): buildAdminAgentPromptMessages(), buildFetchRequestInit(), createCompletionResponseMeta(), createRequestBody(), extractNonStreamingMessage(), extractStreamingDelta(), extractTextContent(), finalizeCompletionResponseMeta() (+56 more)

### Community 24 - "Community 24"
Cohesion: 0.06
Nodes (75): buildUserCryptoPayload(), createHttpError(), post(), readPayload(), get(), buildAuthDataDir(), createAuthKeysPayload(), decodeBase64Url() (+67 more)

### Community 25 - "Community 25"
Cohesion: 0.05
Nodes (62): buildFetchRequestInit(), createApiRequestBody(), createCompletionResponseMeta(), createOnscreenAgentLlmClient(), extractNonStreamingMessage(), extractStreamingDelta(), extractTextContent(), finalizeCompletionResponseMeta() (+54 more)

### Community 26 - "Community 26"
Cohesion: 0.05
Nodes (56): createBigBangSpaceOnFirstLogin(), clampNumber(), formatIconOptionLabel(), normalizeSelectorOptions(), normalizeIconHexColor(), normalizeMaterialSymbolName(), createHrefForRoutePath(), createPanelHref() (+48 more)

### Community 27 - "Community 27"
Cohesion: 0.05
Nodes (47): main(), createMissingPackagingDependencyError(), isMissingPackagingDependency(), loadPackagingDependency(), resolvePackagingDependency(), buildServeCommand(), delay(), readHealth() (+39 more)

### Community 28 - "Community 28"
Cohesion: 0.07
Nodes (52): emitAgentFunctionBlockNotice(), getAgentFunctionBlockResult(), guardAgentFunction(), normalizeRuntimeContext(), readRuntimeContextFromDesktopBridge(), readRuntimeContextFromDocument(), resolveAgentFunctionRuntimeContext(), buildPersistedBrowserWindowSnapshot() (+44 more)

### Community 29 - "Community 29"
Cohesion: 0.06
Nodes (46): createToastRecord(), ensureToastContainer(), getToastIconName(), getToastRuntime(), normalizeToastTone(), removeToastRecord(), showToast(), buildDashboardPrefsPayload() (+38 more)

### Community 30 - "Community 30"
Cohesion: 0.07
Nodes (53): addArchName(), applyAppleCredentialAliases(), applyPlatformPublishConfig(), cloneBuildConfig(), createBuildConfig(), createTargets(), defaultArchName(), isFlag() (+45 more)

### Community 31 - "Community 31"
Cohesion: 0.09
Nodes (44): captureDomHelperDocument(), clickReference(), cloneValue(), coerceSelectorList(), collectDomSnapshot(), collectNavigationState(), collectReferenceDetail(), collectSemanticContent() (+36 more)

### Community 32 - "Community 32"
Cohesion: 0.07
Nodes (40): appendUserSelfInfoExample(), buildUserSelfInfoExecutionResultMessage(), formatUserSelfInfoResult(), hasWidgetDiscoveryHelper(), hasWidgetMutationHelper(), validateSpacesWidgetTurnStaging(), coerceExecutionPlanError(), collectExecutionPlanErrors() (+32 more)

### Community 33 - "Community 33"
Cohesion: 0.08
Nodes (41): loadAdminSkill(), buildAutoLoadedSkillsPromptSection(), buildAutoLoadedSkillsTransientSections(), buildPromptSkillIdentity(), buildPromptSkillList(), buildRuntimeLoadedSkillsPromptSection(), buildRuntimeLoadedSkillsTransientSections(), buildSkillCatalogPromptSection() (+33 more)

### Community 34 - "Community 34"
Cohesion: 0.09
Nodes (42): onError(), blobToDataUrl(), buildDefaultHtml2CanvasOptions(), canvasToBlob(), downloadBlob(), ensureHtml2Canvas(), isElement(), isPageTarget() (+34 more)

### Community 35 - "Community 35"
Cohesion: 0.17
Nodes (29): clampProgress(), clearLoadProgressTrackerTimer(), createLoadProgressTracker(), createWorkerError(), disposeLoadProgressTracker(), ensureRuntimeModule(), extractFirstSequenceLength(), flushLoadProgressTracker() (+21 more)

### Community 36 - "Community 36"
Cohesion: 0.1
Nodes (21): post(), readPayload(), resolveMessages(), resolveModel(), buildCodexPrompt(), normalizeMessages(), buildCodexArgs(), createCodexChatStream() (+13 more)

### Community 37 - "Community 37"
Cohesion: 0.14
Nodes (23): buildAdminPromptContext(), buildAdminPromptInput(), buildAdminPromptMessages(), buildAdminPromptOptions(), buildRuntimeAdminSystemPrompt(), createAdminPromptInstance(), extractCustomAdminSystemPrompt(), fetchAdminHistoryCompactPrompt() (+15 more)

### Community 38 - "Community 38"
Cohesion: 0.12
Nodes (12): buildChildPath(), createPathStateMap(), formatDownloadErrorMessage(), getParentPath(), getPathName(), getPathSegments(), isNotFoundError(), isPermissionError() (+4 more)

### Community 39 - "Community 39"
Cohesion: 0.2
Nodes (22): buildIndent(), buildMoreChildrenLines(), buildUserHomeFileTreeLines(), buildUserHomeFileTreeTransientSection(), buildUserHomeFileTreeTransientSectionFromRuntime(), buildUserHomeTree(), countSummaryLines(), createTreeNode() (+14 more)

### Community 40 - "Community 40"
Cohesion: 0.14
Nodes (11): describeTimeTravelActionError(), extractRevertConflictPath(), getFileName(), getRepositoryPathName(), normalizeCommitFile(), normalizeFileAction(), normalizeRepositoryEntry(), normalizeRepositoryPath() (+3 more)

### Community 41 - "Community 41"
Cohesion: 0.21
Nodes (18): get(), handleList(), post(), readFileFilter(), readLimit(), readOffset(), readPath(), readPayload() (+10 more)

### Community 42 - "Community 42"
Cohesion: 0.22
Nodes (18): buildSnapshot(), clearHardKillTimer(), clearRestartDebounceTimer(), collectSnapshotEntries(), describeSnapshotChange(), flushScheduledRestart(), formatPendingRestartReason(), main() (+10 more)

### Community 43 - "Community 43"
Cohesion: 0.22
Nodes (16): asFiniteNumber(), buildChatMessages(), buildFamilySummary(), compareModelRecords(), deriveModelIdFromUrl(), describeModelSelection(), estimateModelSize(), filterPrebuiltModels() (+8 more)

### Community 44 - "Community 44"
Cohesion: 0.21
Nodes (11): buildAttachmentListLines(), buildMessageContentForApi(), createAttachmentId(), formatAttachmentSize(), isAttachmentLive(), normalizeAttachmentLastModified(), normalizeAttachmentName(), normalizeAttachmentSize() (+3 more)

### Community 45 - "Community 45"
Cohesion: 0.23
Nodes (12): buildFileIndexShards(), buildFileIndexShardValue(), buildGroupIndexShardChanges(), buildUserIndexShardChanges(), cloneValue(), collectFileIndexShardIds(), collectFileIndexShardIdsFromProjectPaths(), createEmptyRecordMap() (+4 more)

### Community 46 - "Community 46"
Cohesion: 0.29
Nodes (14): buildOnboardingExampleWidgetMetadata(), getOnscreenAgentRuntime(), getRuntime(), getSpaceRuntime(), getSpacesRuntime(), installOnboardingExampleWidget(), installOnboardingExampleWidgets(), loadOnboardingExampleWidgetSource() (+6 more)

### Community 47 - "Community 47"
Cohesion: 0.6
Nodes (4): createCustomwareRuntimeParams(), createStaticRuntimeParams(), wait(), waitFor()

### Community 49 - "Community 49"
Cohesion: 0.67
Nodes (2): createStaticRuntimeParams(), createWriteOptions()

### Community 52 - "Community 52"
Cohesion: 0.67
Nodes (2): createStoreRuntime(), loadWebBrowsingStoreModule()

### Community 53 - "Community 53"
Cohesion: 0.83
Nodes (3): applySetArgs(), execute(), parseSetArgs()

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (2): clamp(), positionPopover()

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (2): createHttpError(), get()

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (2): buildCurrentPageTarget(), redirectToEnter()

## Knowledge Gaps
- **Thin community `Community 49`** (4 nodes): `createStaticRuntimeParams()`, `createWriteOptions()`, `file_write_operations_test.mjs`, `readUserFile()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (4 nodes): `createBrowserWindowState()`, `createStoreRuntime()`, `loadWebBrowsingStoreModule()`, `browser_runtime_navigation_wait_test.mjs`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (3 nodes): `popover.js`, `clamp()`, `positionPopover()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (3 nodes): `createHttpError()`, `get()`, `user_crypto_session_key.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (3 nodes): `buildCurrentPageTarget()`, `redirectToEnter()`, `enter-guard.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `get()` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 13`, `Community 14`, `Community 15`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 21`, `Community 22`, `Community 23`, `Community 25`, `Community 29`, `Community 31`, `Community 32`, `Community 34`, `Community 35`, `Community 37`, `Community 39`, `Community 43`?**
  _High betweenness centrality (0.350) - this node is a cross-community bridge._
- **Why does `parse()` connect `Community 14` to `Community 0`, `Community 1`, `Community 4`, `Community 7`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 12`, `Community 15`, `Community 16`, `Community 18`, `Community 19`, `Community 21`, `Community 22`, `Community 23`, `Community 24`, `Community 25`, `Community 26`, `Community 27`, `Community 28`, `Community 29`, `Community 30`, `Community 33`, `Community 36`, `Community 45`?**
  _High betweenness centrality (0.220) - this node is a cross-community bridge._
- **Why does `has()` connect `Community 5` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 9`, `Community 10`, `Community 12`, `Community 13`, `Community 15`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 21`, `Community 22`, `Community 28`, `Community 30`, `Community 31`, `Community 32`, `Community 33`, `Community 37`, `Community 39`, `Community 42`?**
  _High betweenness centrality (0.108) - this node is a cross-community bridge._
- **Are the 123 inferred relationships involving `get()` (e.g. with `normalizeCommandName()` and `dispatchBrowserEnvelope()`) actually correct?**
  _`get()` has 123 INFERRED edges - model-reasoned connections that need verification._
- **Are the 72 inferred relationships involving `parse()` (e.g. with `cleanupDesktopUpdaterArtifacts()` and `normalizeDesktopReleaseAssetVersion()`) actually correct?**
  _`parse()` has 72 INFERRED edges - model-reasoned connections that need verification._
- **Are the 67 inferred relationships involving `has()` (e.g. with `onEnvelope()` and `scheduleRaiseDesktopBrowserView()`) actually correct?**
  _`has()` has 67 INFERRED edges - model-reasoned connections that need verification._
- **Are the 38 inferred relationships involving `log()` (e.g. with `applyPackagedDesktopUserDataOverride()` and `runCli()`) actually correct?**
  _`log()` has 38 INFERRED edges - model-reasoned connections that need verification._