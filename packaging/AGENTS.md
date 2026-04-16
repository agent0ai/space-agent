# AGENTS

## Purpose

`packaging/` contains native app hosts and the packaging surface around them.

Keep this file scoped to native hosting and packaging behavior. Repo-wide packaging surface and install commands still belong in `/AGENTS.md`.

This is one of the five core docs. It owns the packaging subtree contract. If platform-specific packaging areas later grow their own `AGENTS.md` files, those local docs should own the detailed implementation guidance while this file stays focused on packaging-wide structure and principles.

Documentation is top priority for this area. After any change under `packaging/` or any packaging contract change owned here, update this file and the matching supplemental docs under `app/L0/_all/mod/_core/documentation/docs/` in the same session before finishing.

## Documentation Hierarchy

`/packaging/AGENTS.md` stays the packaging-wide doc until a host surface, platform subtree, or packaging helper area grows its own `AGENTS.md`.

If that happens:

- this file should keep packaging-wide structure, shared principles, and cross-platform rules
- the child doc should own the exact host, platform, bridge, or build-helper contract
- update both docs when a packaging-wide rule and a local implementation contract change together

## How To Document Packaging Child Docs

Future packaging docs should keep the same section spine:

- `Purpose`
- `Ownership`
- `Host Or Build Contract`
- `Platform Or Bridge Contract` when that distinction exists
- `Development Guidance`

Required coverage:

- the startup lifecycle between the native host and the local server runtime
- any preload or native bridge APIs exposed to browser code and who may call them
- packaging scripts, assets, metadata, and platform-specific files owned by that subtree
- what must stay thin host glue versus what must remain in `app/` or `server/`
- platform-specific divergence only where it is real; shared behavior should stay documented here

## Current State

`packaging/desktop/` holds the current Electron desktop host.

`packaging/desktop/preload.js` exposes the desktop bridge as `spaceDesktop`, including packaged-runtime info, background update-check hooks, and explicit download or install actions used by `/enter`.

`packaging/desktop/server_storage_paths.js` is the canonical packaged-desktop helper for locating writable server temp and auth fallback storage outside the installed bundle.

`packaging/package.json` holds packaging-only dependencies so the root install can stay lean, and packaging scripts must treat that file as the authoritative Electron version and distribution source for native builds.

Runtime dependencies required by `packaging/desktop/main.js`, such as the Electron updater client, must live in the root `package.json` `dependencies` block so `electron-builder` copies them into the packaged app under `Contents/Resources/app/node_modules`.

The root `package.json` `build` block owns the Electron app entry, copied files, and `directories.app` selection. That config must keep the app directory pinned to the repo root because `app/package.json` exists only to mark the browser tree as an ES module package boundary, not to redefine the desktop host's app root. Because packaged desktop apps always relocate writable customware into `<userData>/customware`, that same build file set must exclude repo-local `app/L1/` and `app/L2/` content from the bundled app.

Linux packaging metadata that is target-specific should live in the root `package.json` `build.linux` block, such as the explicit maintainer string used by Linux package formats, rather than forcing unrelated global `author` changes.

That same root build config disables `npmRebuild` for desktop packaging. `nodegit` is optional in this repo, so packaged desktop builds rely on the existing Git backend fallback order instead of requiring Electron-time native rebuilds of every optional module.

`packaging/scripts/` holds packaging entrypoints and shared build helpers. Multiword operation entrypoints use object-first hyphen naming such as `host-package.js`, `linux-package.js`, and `desktop-dev-run.js`. `desktop-builder.js` is the canonical wrapper around `electron-builder`, `release-version.js` is the canonical release-version helper for local and CI desktop builds, `release-metadata.js` owns shared updater-metadata parsing and serialization, `release-metadata-merge.js` owns the multi-arch updater-metadata merge step, and `release-assets-stage.js` stages the final GitHub Release upload set. Desktop version resolution must prefer explicit script input, release environment variables, an exact checked-out Git tag, and only then the root package version, so OS app metadata matches the release being bundled. That helper also derives the two-segment release version used for published GitHub asset names by stripping a redundant trailing `.0` patch from semver-like tags such as `v0.40.0`. Keep the root `package.json` version aligned with the current Git-derived release version because npm script banners and package-version fallback paths read that metadata directly.

`packaging/release-asset-filters.yaml` owns the editable public-installer upload allowlist for the desktop workflow. During publish, `release-assets-stage.js` stages only the kept public installers under the uniform release asset name `Space-Agent-<release version>-<platform>-<arch>.<extension>`, rewrites the updater metadata files `metadata-latest-windows.yml`, `metadata-latest-mac.yml`, `metadata-latest-linux.yml`, and `metadata-latest-linux-arm64.yml` so they point at those same canonical names plus the canonical macOS updater zip names `Space-Agent-<release version>-macos-<arch>-update.zip`, and removes duplicate builder-default asset names and blockmaps from the GitHub Release. Published public asset names use the two-segment release version when the semver patch is `0`, so tags such as `v0.40.0` upload as `Space-Agent-0.40-<platform>-<arch>.<extension>` while packaged app metadata keeps the full semver build version required by the desktop toolchain and user-facing updater labels collapse that same redundant trailing `.0` patch to the two-segment display version.

`packaging/resources/` holds shared packaging resources, including the canonical source artwork that desktop packaging can derive platform icons from.

`packaging/platforms/` holds OS-specific packaging assets and metadata, including derived app icons such as the Windows `.ico` file and the Linux icon-size set.

Native hosts should remain thin:

- start the local server runtime
- open the browser app inside the host surface
- native host startup code must await async server-factory work before reading runtime fields such as `host`, `port`, `server`, or `watchdog`, and host shutdown paths must tolerate partial startup failure
- packaged desktop builds must keep the app tree unpacked on disk instead of wrapping it in `app.asar`, because the server watchdog and app-file indexing layers depend on watching real directories under the bundled project tree
- packaged desktop builds may add packaging-owned runtime param overrides when the native host contract requires them; the current Electron host binds the backend to loopback with `PORT=0` so the OS assigns a free local port, waits for the server runtime to publish the resolved `browserUrl`, forces `WORKERS=1` and `SINGLE_USER_APP=true` only for packaged apps, roots `CUSTOMWARE_PATH` under the native OS user-data directory as `<userData>/customware`, routes transient `tmpDir` storage to `<temp>/space-agent/server-tmp` so Linux AppImage and other read-only install layouts never try to create `server/tmp/` inside the bundled app tree, exports `SPACE_AUTH_DATA_DIR=<userData>/server/data` so backend-only auth fallback data and local `userCrypto` server shares also stay out of the installed bundle, opens `/enter` as the recovery-safe splash entry when single-user mode is active, and keeps normal runtime auth behavior for source-checkout desktop dev runs
- packaged desktop apps use the Electron release updater against GitHub Releases instead of mutating the installed bundle through `node space update`; startup must not trigger a background update check, `/enter` owns the recovery-safe background check through the `spaceDesktop` preload bridge, `/enter` should reveal an update action only after the updater reports a newer bundle, downloading or restart-to-install must remain explicit user actions, update checks must stay non-blocking, must not break launch when the machine is offline or the updater package cannot load, keep the native window title composed with the current page title so updater status remains visible on `/enter` and later routes, keep the no-update result visually quiet on `/enter` and in the window title, bypass the macOS close-to-hide behavior when restart-to-install is invoked because Electron emits `before-quit` too late for updater-triggered quits, disable differential updater downloads so GitHub Releases no longer need uploaded `.blockmap` artifacts, and mirror readable updater diagnostics into the renderer console while showing progress-bar status during checking or download
- tagged desktop release automation lives in `.github/workflows/release-desktop.yml`; it runs automatically for pushed `v*` tags and also supports manual `workflow_dispatch` reruns, but in both modes the selected tag must already be on `origin/main` history and the workflow skips it only when a newer `v*` tag is already on `origin/main` after it, uses the packaging scripts for all platform builds, requires OpenRouter-backed release-note generation from commit history through the prompt helper under `packaging/resources/release-notes/`, prepends every release body with a fixed `## Downloads` table that links the canonical DMG, AppImage, and EXE assets for x86 and ARM, requires the AI-written portion below that table to omit release-title and version/tag headings because GitHub already renders that metadata outside the body, tolerates an empty previous-release tag when no prior published release is available, merges multi-arch updater metadata during publish, stages public installer assets through `packaging/release-asset-filters.yaml`, rewrites those metadata files to the canonical updater payload names, uploads only NSIS installers, DMGs, AppImages, canonical macOS updater zips, and metadata files, removes duplicate builder-default asset names plus stale blockmaps from the release, rebuilds fresh desktop artifacts for every release run, and updates the GitHub Release for that tag before uploading the staged set separately from the local packaging scripts; the local and CI packaging wrapper must pass `publish: null` into `electron-builder` so builds never upload directly, and the macOS `--dir` flow must backfill `app-update.yml` into unpacked `.app` outputs because `electron-builder` only writes that file automatically when updater-capable targets such as `dmg` or `zip` are present; when a tag resolves to a semver patch of `0`, the published public installer asset names, canonical updater zip names, and user-facing updater text collapse to the two-segment release version
- preserve platform-neutral behavior here when possible

## Guidance

- avoid moving app logic into native hosts
- keep packaging automation in `packaging/scripts/`
- keep multiword packaging script filenames object-first so related entrypoints sort together
- keep platform-specific packaging details in `packaging/platforms/`
- keep release-staging verification data out of hidden scratch directories under the repo; do not create or commit paths such as `.tmp/` for packaging outputs, manifests, or generated binaries
- if packaging needs a checked-in fixture at all, keep it small, synthetic, and under an owned non-hidden test or documentation path instead of committing staged release artifacts or installer binaries
- keep local packaging workable without Apple credentials; the desktop builder consumes `SKIP_SIGNING=1` for macOS packaging runs and disables signing and notarization in that mode, and for signed local runs it accepts the launcher-style `APPLE_PASSWORD` env var as an alias for `APPLE_APP_SPECIFIC_PASSWORD`
- add future mobile-specific hosts alongside `packaging/desktop/`
- when native host behavior, preload bridges, packaging assets, or packaging entrypoints change, update this file in the same session
