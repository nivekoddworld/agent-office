# basic-team

Three-agent workspace: a product manager, a coder, and a reviewer.

| Agent      | Role                                                                |
| ---------- | ------------------------------------------------------------------- |
| `pm`       | Breaks down user requests into tasks, assigns work, tracks progress |
| `coder`    | Writes and debugs code                                              |
| `reviewer` | Reviews code for bugs, style, and correctness                       |

Coder and reviewer both `reports_to: pm`, creating a hierarchy where the PM manages the team. Agents coordinate autonomously via `send_mail` and `read_agent_file`.

## Features demonstrated

- **OAuth** — `auth: "oauth:github-copilot"` on all agents, no API keys needed
- **Hierarchy** — `reports_to: pm` on coder and reviewer creates a managed team
- **Prompt sources** — all agents use `prompt_inline` for custom instructions
- **Prompt mode** — Reviewer uses `prompt_mode: minimal` (base + identity + custom only)
- **Agent env** — Coder sets `LOG_LEVEL: debug` via `env`
- **Tool policy** — Reviewer has `cron_add` and `cron_remove` denied via `permissions.tools.deny`
- **Office cron** — Daily standup fires weekdays at 9 AM ET, targeting the PM
- **Memory citations** — `memory.citations: auto` at office level
- **Secrets** _(commented out)_ — PM shows optional `secrets` + `disclose_secrets` for `authenticated_fetch` use

## Prerequisites

- [GitHub CLI](https://cli.github.com/) (`gh`) installed — required for GitHub Copilot OAuth login

## Usage

```bash
cp -r examples/basic-team/ ~/.agent-office/offices/basic-team/
pnpm dev oauth login github-copilot --office basic-team
pnpm dev start --office basic-team --sandbox docker
```

Then via the Web UI or API:

```bash
# API (requires session cookie + CSRF headers from POST /api/auth)
curl -X POST http://127.0.0.1:<port>/api/send \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://127.0.0.1:<port>' \
  -H 'X-Requested-With: XMLHttpRequest' \
  -b 'ao_session=<session>' \
  -d '{"agent": "pm", "message": "Build a REST API for a todo app with CRUD endpoints"}'
```

The PM will break the task down and delegate to coder and reviewer.

## Environment

This example uses OAuth via GitHub Copilot — no API keys needed. The `oauth login` step above handles authentication.

```env
# Optional — uncomment secrets block in office.yaml to use
# MY_GH_TOKEN=ghp_...
```
