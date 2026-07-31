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

#### With Nix (flakes)

```bash
nix run github:agent0ai/space-agent
```

Or install permanently:

```bash
nix profile install github:agent0ai/space-agent
```

#### With Devbox

```bash
# Install devbox first (if not already installed)
curl -fsSL https://get.jetify.dev/devbox | bash

# Clone the repository
git clone https://github.com/agent0ai/space-agent.git
cd space-agent

# Initialize the environment
devbox shell

# Install dependencies
devbox run install

# create yourself an admin
node space user create admin --password "change-me-now" --full-name "Admin" --groups _admin

# start the server
node space serve
```

Or install devbox via Homebrew:

```bash
brew install jetify-com/devbox/devbox
```

#### From source

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

## AI-driven development and documentation

Space Agent is developed by AI agents, including its documentation.

The framework keeps a DOX `AGENTS.md` hierarchy, plus skills and focused docs, so agents can understand ownership, architecture, workflows, and local implementation rules while they build and maintain the system autonomously.

DeepWiki covers the human-readable side of that same knowledge base. Together, this keeps the codebase and its documentation prepared for autonomous agent work, and helps the documentation keep up with the pace of AI-driven development instead of falling behind.

If you want the deep tour, start here:

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agent0ai/space-agent)
