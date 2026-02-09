# Examples

Each folder contains an `agents.yaml` and a README describing the setup.

## [basic-team](basic-team/)

Three-agent team: product manager, coder, and reviewer. The PM breaks down tasks, the coder builds, and the reviewer provides feedback — all coordinated via `send_mail`.

```bash
mkdir -p ~/.agent-office
cp examples/basic-team/agents.yaml ~/.agent-office/agents.yaml
pnpm dev start --sandbox docker
```


## [openserv-team](openserv-team/)

Four-agent OpenServ workspace: an idea scout (with cron), a team lead, an agent developer, and a token launcher. The scout fetches ideas from the Ideaboard every 4 hours, the lead delegates work to agent-dev and launcher.

```bash
mkdir -p ~/.agent-office
cp examples/openserv-team/agents.yaml ~/.agent-office/agents.yaml
pnpm dev start --sandbox docker
```

