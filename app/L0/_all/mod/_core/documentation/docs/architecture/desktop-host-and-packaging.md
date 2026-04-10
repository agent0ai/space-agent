# Desktop Host And Packaging

This doc covers the Electron desktop host and the packaging scripts that build native desktop outputs.

## Primary Sources

- `packaging/AGENTS.md`
- `packaging/desktop/main.js`
- `packaging/desktop/preload.js`
- `packaging/scripts/desktop-builder.js`
- `packaging/scripts/desktop-dev-run.js`
- `packaging/release-asset-filters.yaml`
- `app/package.json`
- `package.json`
- `server/app.js`

## Desktop Host Startup

The Electron host stays thin:

- it starts the existing Node server runtime from `server/app.js`
- it waits for `listen()` before reading runtime fields such as `browserUrl`
- it opens the browser UI inside `BrowserWindow`

Current startup contract:

- the desktop host binds the backend to `127.0.0.1`
- it passes `PORT=0`, so the OS assigns a free local port for that launch
- packaged apps also set `CUSTOMWARE_PATH` to `<userData>/customware`, so writable `L1/` and `L2/` content stays in the native OS user-data location instead of inside the installed app bundle
- after `listen()`, the server runtime updates its public `port` and `browserUrl` fields to the resolved bound port
- the host loads `${browserUrl}${launchPath}` instead of reconstructing a fixed URL from config

## Packaged Versus Source-Checkout Behavior

Current Electron behavior differs only where the native-host contract requires it:

- packaged apps force `SINGLE_USER_APP=true`
- packaged apps persist writable customware under the native user-data root through `CUSTOMWARE_PATH`
- packaged apps open `/enter` as the recovery-safe launcher shell
- source-checkout desktop dev runs keep the normal runtime auth flow
- both packaged and source-checkout runs use the same free-port startup flow
- packaged release bundles lazy-load the Electron updater after the window is created, check GitHub Releases for a new signed desktop bundle only when startup update checks are enabled and Electron reports the network online, download updates in the background, show native window-title and progress-bar status while checking or downloading so startup does not look stalled, and install them on restart instead of mutating installed files in place with the source-checkout `space update` command
- updater package-load failures, offline launch, and update-check network errors must not prevent the local server or browser window from launching

`preload.js` currently exposes only the minimal `spaceDesktop.platform` bridge to renderer code.

## Packaging Outputs

Desktop packaging is owned by `packaging/scripts/desktop-builder.js` plus thin per-platform entrypoints.

Current build behavior:

- reads the root `package.json` `build` config
- keeps desktop-host runtime modules such as `electron-updater` in the root `dependencies` block so they are copied into the packaged app, while `packaging/package.json` stays limited to build-tool dependencies
- normalizes tag-like versions such as `v0.22` to a semver build version through `packaging/scripts/release-version.js`, so CI and local packaging can stamp the desktop app version consistently; the resolver checks explicit `--app-version`, release env vars, an exact checked-out Git tag, and finally the root package version
- keeps `directories.app` pinned to the repo root because the Electron host entry lives outside `app/`
- keeps `app/package.json` in the bundle so the app tree stays an ES module package boundary, which means that nested package file must keep basic metadata such as `name` and `version`
- includes both the extensionless `space` wrapper and `space.js` in the bundle so the packaged host still carries the documented CLI entrypoint surface it depends on
- keeps packaging scripts focused on building artifacts only; GitHub Release publishing is handled by the release workflow instead of by a local `--publish` script flag
- keeps GitHub publish provider config in the effective build config so `electron-builder` emits `app-update.yml` and update metadata, while the wrapper passes `publish: never` so local and CI packaging scripts never upload directly
- keeps the canonical source icon artwork under `packaging/resources/icons/source/` and derives platform-specific packaging icons from it
- points macOS packaging at that source PNG so `electron-builder` can compile the final app icon internally, while Windows and Linux use checked-in derived assets under `packaging/platforms/`
- enables hardened-runtime signing inputs for macOS and keeps notarization credential discovery in the standard `electron-builder` environment-variable flow
- allows local macOS packaging without signing credentials by honoring `SKIP_SIGNING=1` in the desktop builder wrapper, and also accepts the launcher-style `APPLE_PASSWORD` env var as a local alias for `APPLE_APP_SPECIFIC_PASSWORD`
- publishes update metadata for the GitHub provider so packaged apps can resolve new installers and bundles from the GitHub Release they were built for
- disables `npmRebuild` so optional native dependencies such as `nodegit` do not block desktop packaging when fallback Git backends are already available
- keeps `asar` disabled so the bundled project tree stays watchable on disk
- writes platform artifacts under `dist/desktop/<platform>/`
- for macOS, the default targets are `dmg` and `zip`
- `--dir` produces an unpacked `.app` output for local inspection

## Tagged Release Workflow

Repo-level desktop publishing lives in `.github/workflows/release-desktop.yml`.

Current release contract:

- the workflow runs automatically on pushed `v*` tags
- normal `main` branch pushes do not publish desktop releases unless the `v*` tag ref is pushed too
- automatic tag-push runs publish desktop artifacts only when the tag commit points at `origin/main` HEAD
- manual `workflow_dispatch` runs require an existing Git tag input and publish only when that tag is already on `origin/main` history, so failed or partial releases can be rebuilt after `main` has advanced
- fresh builds cover Windows, macOS, and Linux on both x64 and arm64 runners
- local and CI builds share the same packaging scripts, with CI passing the tag-derived app version through `SPACE_APP_VERSION`
- release notes are generated automatically from the commit range between the previous published release and the current tag, with an empty previous tag allowed when no prior published release is available, and CI requires the OpenRouter prompt helper under `packaging/resources/release-notes/` to return a non-empty AI-written body
- the publish job merges per-arch macOS and Windows updater metadata, but the GitHub Release upload allowlist comes from `packaging/release-asset-filters.yaml`
- selected release files are staged before upload with uniform `Space-Agent-<app version>-<platform>-<arch>.<extension>` asset names, so every uploaded bundle names its platform and architecture consistently and per-arch files with the same builder basename cannot collide on the GitHub Release
- every release run rebuilds fresh desktop artifacts, updates the GitHub Release for the selected tag, removes stale unprefixed selected-asset names left by older workflow attempts, and uploads that selected artifact set with `--clobber` so manual reruns replace failed or stale assets instead of publishing a second release

Use this doc together with `packaging/AGENTS.md` when you need the exact host-versus-server ownership split.
