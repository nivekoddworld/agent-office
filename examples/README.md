# Examples

Each folder contains an `office.yaml` and a README describing the setup. These are demonstration defaults illustrating available features, not required production defaults.

## [basic-team](basic-team/)

Three-agent team: product manager, coder, and reviewer. The PM breaks down tasks, the coder builds, and the reviewer provides feedback — all coordinated via `send_mail`. Coder and reviewer both `reports_to: pm`, creating a hierarchy where the PM manages the team. The reviewer uses `prompt_mode: minimal` to keep its prompt lean. The PM demonstrates `prompt_file` (loads prompt from `prompts/pm-prompt.md`).

```bash
cp -r examples/basic-team/ ~/.agent-office/offices/basic-team/
pnpm dev start --office basic-team --sandbox docker
```

## [openserv-team](openserv-team/)

Four-agent OpenServ workspace: an idea scout (with cron), a team lead, an agent developer, and a token launcher. The scout fetches ideas from the Ideaboard every 4 hours, the lead delegates work to agent-dev and launcher. `WALLET_PRIVATE_KEY` is shared at the office level.

Demonstrates additional features:
- **Tool policy** — `launcher` has `cron_add` denied via `permissions.tools.deny`.

```bash
mkdir -p ~/.agent-office/offices/openserv-team
cp examples/openserv-team/office.yaml ~/.agent-office/offices/openserv-team/office.yaml
pnpm dev start --office openserv-team --sandbox docker
```
