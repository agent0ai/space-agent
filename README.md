<p align="center">
  <a href="https://space-agent.ai"><img src="./.github/readme-banner-thin.svg" alt="Space Agent banner" /></a>
</p>

<p align="center">
<br>
  <a href="https://space-agent.ai"><img alt="Try Live Now!" src="./.github/readme-try-live-now.svg" /></a>
  <br />
  <br />
  <a href="https://github.com/agent0ai/space-agent/releases/latest"><img alt="Run local App" height="50" src="https://img.shields.io/badge/Run%20local%20App-59F0A8?style=for-the-badge&labelColor=07111F&color=59F0A8" /></a>
  <a href="#host"><img alt="Host yourself" height="50" src="https://img.shields.io/badge/Host%20yourself-FFFFFF?style=for-the-badge&labelColor=07111F&color=FFFFFF" /></a>
</p>

<h3 align="center">Created by <a href="https://agent-zero.ai">Agent Zero</a>.</h3>

<p align="center">
  <a href="https://discord.gg/B8KZKNsPpj"><img alt="Discord" src="https://img.shields.io/badge/Discord-5865F2?style=flat&logo=discord&logoColor=white" /></a>
  &nbsp;
  <a href="https://x.com/Agent0ai"><img alt="X" src="https://img.shields.io/badge/X-000000?style=flat&logo=x&logoColor=white" /></a>
  &nbsp;
  <a href="https://www.youtube.com/@AgentZeroFW"><img alt="YouTube" src="https://img.shields.io/badge/YouTube-FF0000?style=flat&logo=youtube&logoColor=white" /></a>
  &nbsp;
  <a href="https://deepwiki.com/agent0ai/space-agent"><img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" /></a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=CNRHxEZ8yqs"><img src="./.github/thumbnail.webp" alt="Watch Space Agent on YouTube" width="560" /></a>
</p>

## Why Space Agent Is Different

<table width="100%" border="0" cellpadding="0" cellspacing="0">
  <tr>
    <td valign="top" width="50%">
      <strong>The agent reshapes the interface</strong><br />
      Ask for a page, tool, widget, or workflow and the agent can build it straight into the running workspace while you work.
    </td>
    <td valign="top" width="50%">
      <strong>Endless possibilities</strong><br />
      The agent is not trapped inside a fixed product surface. It can develop the capabilities it needs from within the system itself and keep extending the Space toward whatever the user can imagine.
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" width="50%">
      <img src="packaging/resources/icons/source/space-agent-icon-256.webp" alt="Space Agent app icon" width="120" />
    </td>
    <td valign="top" width="50%">
      <strong>The agent lives in the frontend runtime</strong><br />
      Space Agent runs in the browser layer itself, whether you open it in a tab or through the desktop app, so the agent can work directly with the same framework, modules, spaces, and UI it is reshaping.
    </td>
  </tr>
  <tr>
    <td valign="top" width="50%">
      <strong>Text-based agent</strong><br />
      New capabilities can live in simple <code>SKILL.md</code> files that the agent can write and extend itself in plain text.
    </td>
    <td valign="top" width="50%">
      <strong>Token-efficient execution</strong><br />
      No bulky tool-call JSON. When action is needed, the agent can stay in plain text and plain JavaScript inside the same message.
    </td>
  </tr>
  <tr>
    <td valign="top" width="50%">
      <strong>Puzzle-piece modularity</strong><br />
      The core stays small. Most of Space Agent is made of modular pieces that can be added, removed, or swapped cleanly instead of being welded into one rigid app.
    </td>
    <td align="center" valign="top" width="50%">
      <img src="app/L0/_all/mod/_core/visual/res/chat/admin/helmet_no_bg_256.webp" alt="Space Agent helmet" height="112" />
    </td>
  </tr>
  <tr>
    <td valign="top" width="50%">
      <strong>Personal to hierarchical</strong><br />
      Use Space Agent as a completely personal assistant, or organize it into a hierarchical system of users and groups as the scope grows.
    </td>
    <td valign="top" width="50%">
      <strong>Per-user work, group sharing</strong><br />
      Users can build in their own layer without affecting anyone else, then groups can share tools, workflows, and behavior across teams when they are ready.
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" width="50%">
      <img src="app/L0/_all/mod/_core/visual/res/engineer/astronaut_red_512h.webp" alt="Space Agent astronaut" height="148" />
    </td>
    <td valign="top" width="50%">
      <strong>Persistent admin and time travel</strong><br />
      When something breaks, admin mode gives you a stable control plane, and Git-backed history lets you roll back user or group changes without taking everyone down with you.
    </td>
  </tr>
</table>

## Try it in 30 seconds

# [space-agent.ai](https://space-agent.ai)

Try our demo server with guest account.

## Run it yourself

### The desktop app

Grab the latest build from [GitHub Releases](https://github.com/agent0ai/space-agent/releases/latest). It runs everything as one app. No terminal required.

### A real server, for you or your team

<a id="host"></a>

```bash
git clone https://github.com/agent0ai/space-agent.git
cd space-agent
npm install

# create yourself an admin
node space user create admin --password "change-me-now" --full-name "Admin" --groups _admin

# start the server
node space serve
```

### For development

```bash
npm run dev # server with auto-reload
```

Open the checked-in VS Code launch entry `Dev Server (npm run dev)` when you want breakpoints in `server/` code. It launches the same watcher and auto-attaches to the spawned `node space serve` process across restarts.

### For production

```bash
node space set CUSTOMWARE_PATH=/srv/space/customware
node space supervise HOST=0.0.0.0 PORT=3000 # zero downtime auto-update
```

Run `node space help` to see the full command surface and built-in help for each from [`commands/params.yaml`](./commands/params.yaml).

## Sign in with ChatGPT (Codex OAuth)

The overlay and admin chat surfaces ship a `ChatGPT` provider tab that uses the official OpenAI Codex OAuth device-code flow. If you already pay for ChatGPT Plus, the agent can send its chats through that subscription via `https://chatgpt.com/backend-api/codex/responses` without requiring a separate OpenAI platform API key.

**Requirements**

- An active **ChatGPT Plus** subscription. Free accounts cannot authorize the Codex device flow. Team and Enterprise plans have not been verified yet; they may work if they expose the same `/backend-api/codex` surface to the account.
- The space-agent server process must be reachable from the browser you sign in from; the OAuth device-flow calls run through authenticated server endpoints to serialize refresh-token rotation safely.

**Setup**

1. In the overlay or admin settings dialog, open the `ChatGPT` tab and press **Sign in with ChatGPT**.
2. A verification URL plus a short code appear. Open the URL in a signed-in ChatGPT browser tab and paste the code.
3. Once you approve the device, the agent receives access and refresh tokens, stores them encrypted in your user config through `userCrypto`, and unlocks the model dropdown.
4. Pick a model (default `gpt-5.4-mini`) and close the dialog. The next message is routed through Codex.

The overlay config stores its tokens in `~/conf/onscreen-agent.yaml`, the admin chat in `~/conf/admin-chat.yaml`. The two surfaces do not share tokens, so signing in on one does not sign in on the other.

**Why does this need a server-side OAuth endpoint?**

Space Agent normally prefers frontend implementations. Codex refresh tokens use single-use rotation: if two browser tabs refresh at the same moment, one call succeeds and the other fails with `invalid_grant`, discarding the only valid refresh token and forcing a full re-login. The OAuth device-code flow and token refresh therefore run through server endpoints in `server/api/openai_codex_*.js` with a single-writer mutex. This is covered under the `shared-data integrity` rule in [`/server/AGENTS.md`](./server/AGENTS.md).

**Troubleshooting**

- **HTTP 403 with `cf-mitigated: challenge`**: Cloudflare blocked the request because the required originator headers were missing. The client ships those headers automatically; if you see this in logs after modifying `app/L0/_all/mod/_core/openai_codex/request.js`, check that `User-Agent`, `originator`, and `ChatGPT-Account-ID` are still set on every outbound Codex request.
- **HTTP 401 "Refresh token is no longer valid. Please log in again."**: Your refresh token has already been consumed by another Codex client, often the `codex` CLI or the Codex VS Code extension signed into the same account. Sign in again in the settings dialog.
- **`response.completed.response.output` is empty**: the Codex endpoint sometimes returns an empty final output array even when the streamed deltas arrived correctly. The adapter accumulates text live from `response.output_text.delta` for exactly this reason; do not read the final reply from the completion payload.
- **HTTP 400 after local changes to the request body**: the Codex `/responses` endpoint rejects `max_output_tokens`, `temperature`, `tools`, and several other Chat-Completions fields. The shape converter in `app/L0/_all/mod/_core/openai_codex/request_shape.js` strips them; if you add a new field, check the drop-list there first.

**Disclaimer**

This provider uses your ChatGPT Plus subscription via the official OpenAI Codex OAuth flow, the same flow the Codex CLI and VS Code extension use. OpenAI's terms of service apply; use at your own risk and avoid non-interactive volume patterns that might look automated.

## AI-driven development and documentation

Space Agent is developed by AI agents, including its documentation.

The framework keeps a DOX `AGENTS.md` hierarchy, plus skills and focused docs, so agents can understand ownership, architecture, workflows, and local implementation rules while they build and maintain the system autonomously.

DeepWiki covers the human-readable side of that same knowledge base. Together, this keeps the codebase and its documentation prepared for autonomous agent work, and helps the documentation keep up with the pace of AI-driven development instead of falling behind.

If you want the deep tour, start here:

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agent0ai/space-agent)
