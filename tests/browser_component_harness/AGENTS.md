# AGENTS

## Purpose

`tests/browser_component_harness/` owns the standalone Electron browser-component harness used to debug the desktop browser bridge without booting the full app shell.

## Ownership

This scope owns:

- `main.cjs`: the standalone Electron main-process harness that opens one window, one `<webview>`, mirrors renderer progress to stdout, exposes parent-process IPC commands, and runs named end-to-end scenarios
- `preload.cjs`: the harness-window preload that exposes the minimal renderer bridge used by the standalone harness UI
- `index.html`: the single-window harness UI shell, including the built-in manual controls and debug panes
- `renderer.mjs`: the browser harness controller that owns guest injection, bridge envelopes, state tracking, request helpers, and the manual UI actions for `open`, `state`, `dom`, `content`, `detail`, `click`, `type`, `typeSubmit`, `submit`, `scroll`, `back`, `forward`, and `reload`

This doc does not own the sibling launchers and wrappers in `tests/` itself:

- `browser_component_harness_cli.mjs`
- `desktop_browser_harness.mjs`
- `browser_desktop_harness_test.mjs`

Those remain owned by `tests/AGENTS.md`.

## Local Contracts

### Local Contracts

- this harness is intentionally narrower than the real desktop app; it should exercise the browser guest path directly and must not recreate the full Space Agent shell, router, or app stores
- the harness must keep a single browser instance with the public browser id `1` and the internal guest id `browser-1`
- because that single browser id is always `1`, manual harness commands such as `detail 1`, `click 1`, `submit 1`, `scroll 1`, `type 1 ...`, and `type-submit 1 ...` must treat that trailing `1` as the reference id when no extra scoped browser id is present; browser-id stripping is only valid when additional scoped arguments remain
- the standalone harness must reuse the real browser guest runtime from `app/L0/_all/mod/_core/web_browsing/` and the real Electron guest preload from `packaging/desktop/browser-webview-preload.js`; do not fork separate browser logic here unless the test surface truly needs harness-only glue
- parent-process control must stay explicit and small: probe readiness, call one browser method, and receive one structured result
- guest console lines must stay available through the parent-process debug surface so browser injection and bridge failures are visible without opening a second inspector; unlike the full app runtime's browser logger, this harness should stay verbose by default, and the sibling CLI owns the human-facing `log` command and should buffer those lines instead of streaming them during ordinary commands
- the sibling CLI owns the human-facing operator timeout too: readiness and each explicit CLI browser command should fail after 10 seconds rather than hanging the terminal indefinitely when the harness or guest bridge stalls
- because of that hard CLI timeout, direct navigation commands in this harness should wait for the next guest document to rebuild its bridge when possible and otherwise fall back to returning the settled page state instead of reporting a false navigation failure after the page visibly opened
- document-lifecycle resets in this harness should follow real guest loading starts rather than every main-frame `did-start-navigation` callback; late or same-document navigation-start events that do not produce a fresh guest document must not clear an already-usable bridge
- guest-ready waits must follow the current lifecycle instead of timing out on abandoned readiness promises after a later navigation replaces the previous document
- the harness URL entry path should mirror `_core/web_browsing` address-bar normalization for bare hosts, so inputs such as `novinky.cz` or `localhost:3000` resolve to browser-like destinations instead of app-relative paths or localhost being forced through `https://`
- navigation, DOM extraction, content extraction, and ref-targeted actions should behave as close as possible to the real desktop browser path; if the harness needs a workaround, document it here instead of silently diverging
- ref-targeted actions should return the same top-level shape as the real app path, namely `{ action, state }`, and `action.status` should preserve visible-effect signals such as `reacted`, `noObservedEffect`, `validationTextAdded`, `nearbyTextChanged`, or `domChanged`
- selector-scoped `content([...])` requests should stay cheap enough for manual debugging; when the shared desktop DOM helper is available, the harness should ask it for selector-target snapshots instead of serializing the entire recursive page tree first
- scenario helpers in `main.cjs` should stay thin wrappers around the same browser method calls exposed to the CLI and tests

## Work Guidance

### Local Work Rules

- prefer debugging browser transport or extraction issues here before touching the full desktop host
- keep the harness readable and manual-friendly; it is both a regression surface and an operator tool
- when adding a new browser bridge capability, expose it here in the controller and the manual UI if that capability is useful for debugging
- when the harness startup flow, parent IPC contract, or shared guest-runtime reuse changes, update this file and `tests/AGENTS.md` in the same session

## Verification



## Child DOX Index

- No child DOX docs.
