_---
name: Space Widgets
description: Create, patch, inspect, and remove widgets in the current space
metadata:
  placement: system
  when:
    tags:
      - space:open
  loaded:
    tags:
      - space:open
---

Use this skill for widget work in the current open space

storage
- ~/spaces/<spaceId>/space.yaml = space meta + live layout
- ~/spaces/<spaceId>/widgets/<widgetId>.yaml = widget meta + renderer
- ~/spaces/<spaceId>/data/ and assets/ = widget-owned files
- ~/spaces/<spaceId>/scripts/ = current-space shared JS modules loaded through `context.import("scripts/...")`

transient
- `Current Space Widgets` in `_____transient` lists `id|name|col|row|cols|rows|state|render status`
- `Current Widget` appears after patchWidget(), renderWidget(), or reloadWidget()
- `Current Widget` is one envelope with `rendered↓` for stripped live HTML and `source↓` for the numbered readback

main helpers
- listWidgets()
- readWidget(id)
- seeWidget(id, full=false)
- patchWidget(id, { name?, cols?, rows?, col?, row?, metadata?, edits? })
- renderWidget({ id, name, cols, rows, metadata?, renderer })
- reloadWidget(id)
- reposition(), removeWidget(...), removeWidgets(...), removeAllWidgets()
- rearrangeWidgets(...), toggleWidgets(...), repairLayout(), rearrange(), reload(options?)

catalog and readback
- Prefer `space.current.*` for widget work in the current open space
- `Current Space Widgets` is the live layout summary. Use it before rediscovering ids manually
- Use listWidgets() when you need the compact widget catalog. It returns:
widgets (id|name|description)↓
example|Example|expanded, 4x3 widget
- That catalog is plain text, not JSON. Do not expect widgets, items, or other object fields from it
- If the user already named the target widget clearly, for example snake, tetris, or minesweeper, do not ask which widget. Read that widget directly by id or display name
- On the next turn, read the visible id row directly, for example `snake-game|Snake|...` means use `readWidget("snake-game")`
- Use that id for readWidget(), seeWidget(), patchWidget(), and reloadWidget(). Name is fallback only
- readWidget() returns the numbered source directly in `_____framework result↓`
- when widget YAML carries metadata, readWidget() includes a compact `metadata: ...` line before `renderer↓`
- seeWidget() returns the current rendered widget HTML directly in `_____framework result↓`
- `seeWidget(id)` strips script/style tags, inline handlers, class lists, ids, and data attrs by default
- Use `seeWidget(id, true)` only when you explicitly need the full live innerHTML
- Current Widget format after a write or reload↓
rendered↓
<div>Hello</div>

source↓
id: example
name: Example
cols: 4
rows: 3
renderer↓
0 async (parent, currentSpace, context) => {
1   console.log("hello");
2 }
- Patch numbers come only from numbered renderer lines after renderer↓ inside source↓
- Do not copy displayed line numbers into patch content
- In prepared input, optional example turns may appear before live history, _____user = human, _____framework = runtime output, and _____transient = trailing current-space widget context

staged turns
- listWidgets(), readWidget(), and seeWidget() are discovery calls. If the next step depends on them, end the execution there
- If `Current Space Widgets` or `_____framework` already showed the widget id you need, skip another discovery call and move to the next step
- After readWidget() or seeWidget(), patch on the next turn, not in the same JS block
- After patchWidget(), renderWidget(), or reloadWidget(), use the refreshed Current Widget on the next turn if another edit is needed: `rendered↓` for what mounted and `source↓` for the next patch
- Never answer with raw JS or a code fence after a widget error. Either send a proper execution message or a normal user-facing answer
- If you receive an error from patchWidget() that is not a problem in the underlying code, consider fixing the widget with a renderWidget() call
- If you receive an error from a renderWidget() or patchWidget() call.  Summarize the error and attempt to rerun with the error fixed.  Repeat up to 3 times before giving up
- Start every execution block with one short sentence saying the immediate step
- Put that sentence on its own line. Then put `_____javascript` alone on the next line separated from other text by newlines
- If the prompt asks you to change, fix, or modify the widget, you should wrap any output code in a patch and render instruction and output in a solitary `_____javascript` block.  Do not merely state the fix.
- If the response to an error correction emits corrected code, use this code to patch or render the widget.
- Do not execute silently
- Do not send only a staging sentence such as checking widget source, loading widget source, patching the widget, rendering the widget, or fixing the widget. If you announce a widget read, list, patch, reload, render, or fix step, the same message must execute it
- Do not send only a code change without applying it to the widget unless the user specifically asks for the change not to be applied.
- After a successful patch or render that satisfies the request, stop and answer normally. Do not keep making more visual tweaks unless the user asked for another iteration or the runtime reported failure
- After a successful patch or render, the next assistant turn should usually be the final user-facing answer. Do not output another promise line such as Updating... or Applying... without execution
- After a successful patch or render, do not output raw javascript, html, or css code in the final user-facing answer
- Never output raw html or css code in user-facing answers, unless the user specifically requests to see code
- Never output raw javascript code in user-facing answers unless the user specifically requests to see code; otherwise all javascript code should be in a solitary `_____javascript` block
- `_____javascript` must appear only once and be on its own line
- Always prepend `_____javascript` or `_____framework` or `_____transient` or `_____user` with a line break so that they begin a new line
- Always append `_____javascript` or `_____transient` with a line break so that any following text is on a new line
- The tags `_____javascript` or `_____framework` or `_____transient` or `_____user` should never appear on the same line
- Any widget modifying requests must result in a patchWidget or renderWidget call- no raw code snippets
- Any widget modifying requests that returns a successful response must call patchWidget or renderWidget to apply the code changes - no successful response without a code change


examples
Checking widget catalog
_____javascript
return await space.current.listWidgets()

Reading the widget source
_____javascript
return await space.current.readWidget("tetris-game")

Seeing the current rendered widget HTML
_____javascript
return await space.current.seeWidget("tetris-game")

After the catalog already showed snake-game, reading Snake source
_____javascript
return await space.current.readWidget("snake-game")

User asked for the snake widget, reading it directly
_____javascript
return await space.current.readWidget("snake")

Rendering a widget
_____javascript
return await space.current.renderWidget({...
})

Patching a widget
_____javascript
return await space.current.patchWidget("snake-game", ...)

bad
javascript
return await space.current.renderWidget({

replace with
_____javascript
return await space.current.renderWidget({


bad
Checking the current widget source

bad
Checking the current widget source_____javascript

replace with
Checking the current widget source
_____javascript

bad
Checking the current widget source_____javascript return

replace with
Checking the current widget source
_____javascript
return

bad
_____javascript
return await space.current.readWidget("snake-game")

bad
_____javascriptreturn await space

replace with
_____javascript
return await space

bad
_____javascriptreturn await space.current.renderWidget({

replace with
_____javascript
return await space.current.renderWidget({

bad
_____framework execution success↓_____javascript return await

replace with
_____framework execution success↓
_____javascript
return await

bad
Which widget should I change?

bad
const widgets = await space.current.listWidgets();
const snake = widgets.widgets.find(...)

bad
return await space.current.readWidget("snake-game")
return await space.current.patchWidget("snake-game", ...)

bad
return await space.current.patchWidget("snake-game", ...)
// success came back
return await space.current.patchWidget("snake-game", ...)

bad
return await space.current.patchWidget("snake-game", ...)

replace with
_____javascript
return await space.current.patchWidget("snake-game", ...)

bad
return await space.current.renderWidget({

replace with
_____javascript
return await space.current.renderWidget({

bad
Updating the snake widget background now
Applying the color edits now

patch vs rewrite
- Use patchWidget() for bounded edits to an existing renderer
- Use renderWidget() for new widgets or full rewrites
- patchWidget() is not a whole-renderer rewrite API. Do not use broad guesses like 0-999
- Use name, cols, rows, col, row, and metadata for widget metadata changes. Use edits only for renderer lines
- Preferred small-edit shape: [{ find, replace? }]
- find must be one exact unique snippet copied from readWidget() output or from Current Widget `source↓`
- Omit replace on a find edit to delete that snippet
- Line-edit shape also works: [{ from, to?, content? }]
- Line-edit shape patches must include a from
- from and to are inclusive zero-based renderer line numbers
- to must be an integer greater or equal to from
- the content of the patch should go into content and not to
- Omit content on a ranged line edit to delete
- Common line aliases like line, startLine/endLine, range, text, and replace are tolerated, but prefer the canonical shapes above
- Do not mix exact find edits and line edits in the same call
- Do not overlap edits
- The runtime applies edits from higher line numbers down to lower ones
- If you build edits programmatically, parse the numbered renderer lines from readWidget() output or Current Widget `source↓`. Do not use widget.split("\n") array indexes as patch coordinates
- If patchWidget() or renderWidget() says No files were written, the old widget file is still the source of truth. Fix and retry

example exact snippet patch
_____javascript
return await space.current.patchWidget("snake-game", {
  edits: [
    {
      find: "parent.style.background = '#6f8f54';",
      replace: "parent.style.background = '#5f7f3f';"
    }
  ]
})

write and reload behavior
- readWidget() returns the numbered source readback
- seeWidget() returns rendered HTML
- patchWidget(), renderWidget(), and reloadWidget() return short status strings and refresh Current Widget in _____transient with both `rendered↓` and `source↓`
- Helpers also emit plain-text console status
- Do not parse status strings. The execution output is enough
- If a write or reload reports a render failure, keep fixing the widget from Current Widget `source↓` before claiming success
- Use reloadWidget(id) when you want an explicit rerun without changing source

renderer rules
- Prefer async (parent, currentSpace, context) => { ... }
- Render into parent
- Use `const mod = await context.import("scripts/utils.js")` when several widgets need shared state, widget-to-widget communication, or other space-global functionality
- `context.import(...)` resolves relative to the current space root, so copied or imported spaces keep working without hardcoded space ids, titles, or folder names
- `context.paths.scripts` is the current space scripts folder
- If several widgets need the same live shared state, import the same `scripts/...` module from each widget so they share one module instance on that space page
- For very large or complex widgets, keep the renderer small and move substantial logic into `scripts/*.js` modules
- If an imported module needs widget helpers or state, export functions that receive `context` instead of hardcoding globals or space ids
- Do not add outer wrapper padding just to inset content. The widget shell already provides that spacing
- Default widget card surface is `#101b2d` (`rgba(16, 27, 45, 0.92)`). Do not add another full-card background unless the content truly needs its own stage
- Use light text and UI elements by default because widgets sit on that dark surface
- For markdown-heavy output, use space.utils.markdown.render(text, parent)
- If a widget should show a website, search page, URL, live web page, or browser-like surface that the agent may need to inspect or control, use `<x-browser src="google.com"></x-browser>` or create an `x-browser` element in DOM
- Add `controls="true"` to `x-browser` only when the widget needs its own address bar and navigation controls; omit it or use `controls="false"` for a frameless embedded browser
- Do not use `<iframe>` for general web browsing widgets. Iframes are not registered browser surfaces, so `space.browser`, injected browser actions, and last-interacted browser content will not work through them
- Use an iframe only for a provider-specific embed that is intentionally not a controllable browser surface, such as a YouTube embed
- For external HTTP reads, use `fetch(url)` or `space.fetchExternal(url)`. Do not hardcode third-party CORS proxy services; the runtime already retries blocked origins through `/api/proxy`
- Use `space.proxy.buildUrl(url)` only when you specifically need a same-origin proxied URL string for a non-fetch consumer
- Max widget size is 24x24
- Pick a reasonable size. Do not default to oversized cards
- Return a cleanup function if you attach listeners, timers, or other long-lived effects
- Do not patch unrelated page DOM
- Do not use global plain-key listeners that interfere with chat. Require widget focus or use modified shortcuts
- Do not emit raw javascript code that calls a method of space.current. Any such code should be in a  `_____javascript` block
- Where there are code changes for the widget, wrap the code in a patchWidget() or renderWidget() call
- Do not emit raw javascript code which is unwrapped
- When asked for code changes, do not output the raw javascript code but rather generate the patchWidget() or renderWidget() call used to modify the code
- Requests to modify or change the widget should cause the widget to be patched or rerendered rather than only emitting raw javascript code

flow
1. listWidgets() if you need the live catalog
2. readWidget(id) for any existing widget you will change
3. seeWidget(id) only when you need the live rendered DOM rather than source
4. Next turn: patchWidget(id, ...) or renderWidget(...)
5. Next turn if needed: use the refreshed Current Widget, then continue
