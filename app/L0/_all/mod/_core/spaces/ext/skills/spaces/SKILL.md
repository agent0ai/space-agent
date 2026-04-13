---
name: Spaces Widgets
description: Create, patch, move, and remove widgets
metadata:
  when:
    tags:
      - route:spaces
  just_loaded:
    tags:
      - space:open
---

Use this skill for widget work in a space

storage
- ~/spaces/<spaceId>/space.yaml = space meta + live layout
- ~/spaces/<spaceId>/widgets/<widgetId>.yaml = widget meta + renderer
- ~/spaces/<spaceId>/data/ and assets/ = widget-owned files

main helpers
Current space:
- listWidgets()
- readWidget(id)
- seeWidget(id, full=false)
- patchWidget(id, { name?, cols?, rows?, col?, row?, edits? })
- renderWidget({ id, name, cols, rows, renderer })
- reloadWidget(id)
- removeWidget(...), removeWidgets(...), removeAllWidgets()
- rearrangeWidgets(...), toggleWidgets(...), repairLayout(), rearrange(), reload()

Cross-space:
- listSpaces(), createSpace({ title }), openSpace(id), removeSpace(id)
- upsertWidget(...), patchWidget(...), removeWidgets(...), removeAllWidgets(...)

catalog and readback
- Prefer space.current.* when already inside a space
- Use listWidgets() when you need the live catalog. It returns:
widgets (id|name|description)↓
example|Example|expanded, 4x3 widget
- That catalog is plain text, not JSON. Do not expect widgets, items, or other object fields from it
- If the user already named the target widget clearly, for example snake, tetris, or minesweeper, do not ask which widget. Read that widget directly by id or display name
- On the next turn, read the visible id row directly, for example `snake-game|Snake|...` means use `readWidget("snake-game")`
- Use that id for readWidget(), seeWidget(), patchWidget(), and reloadWidget(). Name is fallback only
- readWidget() returns the numbered source directly in `_____framework result↓`
- seeWidget() returns the current rendered widget HTML directly in `_____framework result↓`
- `seeWidget(id)` strips script/style tags, inline handlers, class lists, ids, and data attrs by default
- Use `seeWidget(id, true)` only when you explicitly need the full live innerHTML
- Current Widget transient appears after patchWidget(), renderWidget(), or reloadWidget()
- That transient is one envelope with `rendered↓` for stripped live HTML and `source↓` for the numbered readback
- Current Widget format after a write or reload↓
rendered↓
<div>Hello</div>

source↓
id: example
name: Example
cols: 4
rows: 3
renderer↓
0 async (parent, currentSpace) => {
1   console.log("hello");
2 }
- Patch numbers come only from numbered renderer lines after renderer↓ inside source↓
- Do not copy displayed line numbers into patch content
- In prepared input, optional example turns may appear before live history, _____user = human, _____framework = runtime output, and _____transient = trailing Current Widget context

staged turns
- listWidgets(), readWidget(), and seeWidget() are discovery calls. If the next step depends on them, end the execution there
- If _____framework already showed the widget id you need, skip another discovery call and move to the next step
- After readWidget() or seeWidget(), patch on the next turn, not in the same JS block
- After patchWidget(), renderWidget(), or reloadWidget(), use the refreshed Current Widget on the next turn if another edit is needed: `rendered↓` for what mounted and `source↓` for the next patch
- Start every execution block with one short sentence saying the immediate step
- Put that sentence on its own line. Then put _____javascript alone on the next line
- Do not execute silently
- Do not send only a staging sentence such as Checking widget source or Loading widget source. If you announce a widget read, list, patch, reload, or render step, the same message must execute it
- After a successful patch or render that satisfies the request, stop and answer normally. Do not keep making more visual tweaks unless the user asked for another iteration or the runtime reported failure
- After a successful patch or render, the next assistant turn should usually be the final user-facing answer. Do not output another promise line such as Updating... or Applying... without execution
- Never answer with raw JS or a code fence after a widget error. Either send a proper execution message or a normal user-facing answer

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

bad
Checking the current widget source

bad
_____javascript
return await space.current.readWidget("snake-game")

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
Updating the snake widget background now
Applying the color edits now

patch vs rewrite
- Use patchWidget() for bounded edits to an existing renderer
- Use renderWidget() for new widgets or full rewrites
- patchWidget() is not a whole-renderer rewrite API. Do not use broad guesses like 0-999
- Use name, cols, rows, col, row for metadata changes. Use edits only for renderer lines
- Preferred small-edit shape: [{ find, replace? }]
- find must be one exact unique snippet copied from readWidget() output or from Current Widget `source↓`
- Omit replace on a find edit to delete that snippet
- Line-edit shape also works: [{ from, to?, content? }]
- from and to are inclusive zero-based renderer line numbers
- Omit to to insert before from
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
- Prefer async (parent, currentSpace) => { ... }
- Render into parent
- Do not add outer wrapper padding just to inset content. The widget shell already provides that spacing
- Default widget card surface is `#101b2d` (`rgba(16, 27, 45, 0.92)`). Do not add another full-card background unless the content truly needs its own stage
- Use light text and UI elements by default because widgets sit on that dark surface
- For markdown-heavy output, use space.utils.markdown.render(text, parent)
- For external HTTP reads, use `fetch(url)` or `space.fetchExternal(url)`. Do not hardcode third-party CORS proxy services; the runtime already retries blocked origins through `/api/proxy`
- Use `space.proxy.buildUrl(url)` only when you specifically need a same-origin proxied URL string for a non-fetch consumer
- Max widget size is 24x24
- Pick a reasonable size. Do not default to oversized cards
- Return a cleanup function if you attach listeners, timers, or other long-lived effects
- Do not patch unrelated page DOM
- Do not use global plain-key listeners that interfere with chat. Require widget focus or use modified shortcuts

flow
1. listWidgets() if you need the live catalog
2. readWidget(id) for any existing widget you will change
3. seeWidget(id) only when you need the live rendered DOM rather than source
4. Next turn: patchWidget(id, ...) or renderWidget(...)
5. Next turn if needed: use the refreshed Current Widget, then continue
