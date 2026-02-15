# basic-team

Three-agent workspace: a product manager, a coder, and a reviewer.

| Agent      | Role                                                                |
| ---------- | ------------------------------------------------------------------- |
| `pm`       | Breaks down user requests into tasks, assigns work, tracks progress |
| `coder`    | Writes and debugs code                                              |
| `reviewer` | Reviews code for bugs, style, and correctness                       |

Coder and reviewer both `reports_to: pm`, creating a hierarchy where the PM manages the team. Agents coordinate autonomously via `send_mail` and `read_agent_file`.

## Features demonstrated

- **Hierarchy** — `reports_to: pm` on coder and reviewer creates a managed team
- **Prompt sources** — PM uses `prompt_file`, coder and reviewer use `prompt_inline`
- **Prompt mode** — Reviewer uses `prompt_mode: minimal` (base + identity + custom only)
- **Agent env** — Coder sets `LOG_LEVEL: debug` via `env`
- **Tool policy** — Reviewer has `cron_add` and `cron_remove` denied via `permissions.tools.deny`
- **Office cron** — Daily standup fires weekdays at 9 AM ET, targeting the PM
- **Memory citations** — `memory.citations: auto` at office level
- **Secrets** _(commented out)_ — PM shows optional `secrets` + `disclose_secrets` for `authenticated_fetch` use

## Usage

```bash
cp -r examples/basic-team/ ~/.agent-office/offices/basic-team/
pnpm dev start --office basic-team --sandbox docker
```

Then in the REPL or via Telegram:

```
ao> send pm "Build a REST API for a todo app with CRUD endpoints"
```

The PM will break the task down and delegate to coder and reviewer.

## Environment

Set these in the project root `.env` (not inside Docker — the host forwards them to containers):

```env
OPENAI_API_KEY=
TELEGRAM_BOT_TOKEN=          # optional, enables Telegram bridge
ALLOWED_USERS=               # optional, comma-separated Telegram allowlist
MY_GH_TOKEN=                 # optional, uncomment secrets block in office.yaml to use
```
