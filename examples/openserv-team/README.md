# openserv-team

Four-agent workspace for building on the OpenServ platform.

| Agent       | Role                                                           | Skills                 |
| ----------- | -------------------------------------------------------------- | ---------------------- |
| `scout`     | Monitors the Ideaboard for ideas and bounties, reports to lead | `openserv-labs/skills` |
| `lead`      | Coordinates the team, reviews ideas, assigns work              | `openserv-labs/skills` |
| `agent-dev` | Builds and deploys OpenServ agents using the SDK               | `openserv-labs/skills` |
| `launcher`  | Launches ERC-20 tokens via the OpenServ Launch API             | `openserv-labs/skills` |

The scout runs on a cron schedule (every 4 hours) to fetch new ideas from the Ideaboard and share them with the lead. The lead then delegates to agent-dev or launcher as needed.

`WALLET_PRIVATE_KEY` is defined at the office level and shared by all agents — no need to set it per agent.

## Usage

```bash
mkdir -p ~/.agent-office/offices/openserv-team
cp examples/openserv-team/office.yaml ~/.agent-office/offices/openserv-team/office.yaml
pnpm dev start --office openserv-team --sandbox docker
```

Then in the REPL or via Telegram:

```
ao> send lead "Review latest ideas from scout and pick one for the team to build"
```

## Environment

Set these in the project root `.env` (not inside Docker — the host forwards them to containers):

```env
OPENAI_API_KEY=
WALLET_PRIVATE_KEY=          # EVM wallet key for openserv-labs/skills agents
TELEGRAM_BOT_TOKEN=          # optional, enables Telegram bridge
ALLOWED_USERS=               # optional, comma-separated Telegram allowlist
```
