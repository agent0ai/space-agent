[![Space Agent banner](./.github/readme-banner-thin.svg)](https://space-agent.ai)

[![Try Live Now!](./.github/readme-try-live-now.svg)](https://space-agent.ai)

[![Run local App](https://img.shields.io/badge/Run%20local%20App-59F0A8?style=for-the-badge&labelColor=07111F&color=59F0A8)](https://github.com/agent0ai/space-agent/releases/latest)
[![Host yourself](https://img.shields.io/badge/Host%20yourself-FFFFFF?style=for-the-badge&labelColor=07111F&color=FFFFFF)](#a-real-server-for-you-or-your-team)

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/qVnMIg?referralCode=HhsRaZ&utm_medium=integration&utm_source=template&utm_campaign=generic)

### Created by [Agent Zero](https://agent-zero.ai).

[![Discord](https://img.shields.io/badge/Discord-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/B8KZKNsPpj)
[![X](https://img.shields.io/badge/X-000000?style=flat&logo=x&logoColor=white)](https://x.com/Agent0ai)
[![YouTube](https://img.shields.io/badge/YouTube-FF0000?style=flat&logo=youtube&logoColor=white)](https://www.youtube.com/@AgentZeroFW)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agent0ai/space-agent)

[![Watch Space Agent on YouTube](./.github/thumbnail.webp)](https://www.youtube.com/watch?v=CNRHxEZ8yqs)

## Why Space Agent Is Different

|  |  |
| :--- | :--- |
| **The agent reshapes the interface** — Ask for a page, tool, widget, or workflow and the agent can build it straight into the running workspace while you work. | **Endless possibilities** — The agent is not trapped inside a fixed product surface. It can develop the capabilities it needs from within the system itself and keep extending the Space toward whatever the user can imagine. |
| ![Space Agent app icon](packaging/resources/icons/source/space-agent-icon-256.webp) | **The agent lives in the frontend runtime** — Space Agent runs in the browser layer itself, whether you open it in a tab or through the desktop app, so the agent can work directly with the same framework, modules, spaces, and UI it is reshaping. |
| **Text-based agent** — New capabilities can live in simple `SKILL.md` files that the agent can write and extend itself in plain text. | **Token-efficient execution** — No bulky tool-call JSON. When action is needed, the agent can stay in plain text and plain JavaScript inside the same message. |
| **Puzzle-piece modularity** — The core stays small. Most of Space Agent is made of modular pieces that can be added, removed, or swapped cleanly instead of being welded into one rigid app. | ![Space Agent helmet](app/L0/_all/mod/_core/visual/res/chat/admin/helmet_no_bg_256.webp) |
| **Personal to hierarchical** — Use Space Agent as a completely personal assistant, or organize it into a hierarchical system of users and groups as the scope grows. | **Per-user work, group sharing** — Users can build in their own layer without affecting anyone else, then groups can share tools, workflows, and behavior across teams when they are ready. |
| ![Space Agent astronaut](app/L0/_all/mod/_core/visual/res/engineer/astronaut_red_512h.webp) | **Persistent admin and time travel** — When something breaks, admin mode gives you a stable control plane, and Git-backed history lets you roll back user or group changes without taking everyone down with you. |

## Try it in 30 seconds

# [space-agent.ai](https://space-agent.ai)

Try our demo server with guest account.

## Run it yourself

### The desktop app

Grab the latest build from [GitHub Releases](https://github.com/agent0ai/space-agent/releases/latest). It runs everything as one app. No terminal required.

### A real server, for you or your team

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

### Deploying to Railway

[Railway](https://railway.com) can run Space Agent from this repo using the checked-in [`railway.toml`](./railway.toml): the service builds from the root [`Dockerfile`](./Dockerfile), sets `CUSTOMWARE_PATH` to `/data/customware`, and expects a **persistent volume** at that path so user data survives redeploys (see the `volumes` entry under `[service.experimental]` in `railway.toml`).

1. Create a Railway project and connect this repository (or push the image you build from the same `Dockerfile`).
2. Attach storage so `/data/customware` is a mounted volume; without it, redeploys can wipe local state.
3. Deploy; Railway injects `PORT` and the container listens on `HOST=0.0.0.0`.

**Default login (Docker / Railway first boot):** username `admin`, password `change-me-now`. The entrypoint creates this user only when the admin layer is missing on the volume (see [`docker-entrypoint.sh`](./docker-entrypoint.sh)). Change the password immediately after first sign-in, or set `SPACE_DOCKER_ADMIN_PASSWORD` before the first boot if you want a different initial password.

Run `node space help` to see the full command surface and built-in help for each from [`commands/params.yaml`](./commands/params.yaml).

## AI-driven development and documentation

Space Agent is developed by AI agents, including its documentation.

The framework keeps a hierarchical `AGENTS.md` instruction system, plus skills and focused docs, so agents can understand ownership, architecture, workflows, and local implementation rules while they build and maintain the system autonomously.

DeepWiki covers the human-readable side of that same knowledge base. Together, this keeps the codebase and its documentation prepared for autonomous agent work, and helps the documentation keep up with the pace of AI-driven development instead of falling behind.

If you want the deep tour, start here:

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agent0ai/space-agent)
