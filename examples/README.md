# Examples

Each folder contains an `agents.yaml` and a README describing the setup.

## [basic-team](basic-team/)

Three-agent team: product manager, coder, and reviewer. The PM breaks down tasks, the coder builds, and the reviewer provides feedback — all coordinated via `send_mail`.

```bash
mkdir -p ~/.agent-office
cp examples/basic-team/agents.yaml ~/.agent-office/agents.yaml
pnpm dev start --sandbox docker
```

Requires `OPENAI_API_KEY` in `.env` (or swap models to your preferred provider).
