# Examples

Each folder contains an `office.yaml` and a README describing the setup. These are demonstration defaults illustrating available features, not required production defaults.

## [basic-team](basic-team/)

Three-agent team: product manager, coder, and reviewer. The PM breaks down tasks, the coder builds, and the reviewer provides feedback — all coordinated via `send_mail`. The reviewer uses `prompt_mode: minimal` to keep its prompt lean.

```bash
mkdir -p ~/.agent-office/offices/basic-team
cp examples/basic-team/office.yaml ~/.agent-office/offices/basic-team/office.yaml
pnpm dev start --office basic-team --sandbox docker
```

## [openserv-team](openserv-team/)

Four-agent OpenServ workspace: an idea scout (with cron), a team lead, an agent developer, and a token launcher. The scout fetches ideas from the Ideaboard every 4 hours, the lead delegates work to agent-dev and launcher. `WALLET_PRIVATE_KEY` is shared at the office level.

Demonstrates additional features:
- **On-demand skills** — `agent-dev` uses `on_demand_skills: true` to load skill summaries only, fetching full content via `read_skill` when needed.
- **Tool policy** — `launcher` has `cron_add` denied via `permissions.tools.deny`.

```bash
mkdir -p ~/.agent-office/offices/openserv-team
cp examples/openserv-team/office.yaml ~/.agent-office/offices/openserv-team/office.yaml
pnpm dev start --office openserv-team --sandbox docker
```
