# Examples

## agents.yaml

Basic two-agent workspace with a coder and a reviewer. The coder writes code, the reviewer reads agent files and sends feedback via `send_mail`. Drop-in ready — copy to `~/.agent-office/agents.yaml` and start.

```bash
cp examples/agents.yaml ~/.agent-office/agents.yaml
pnpm dev start
```

Requires `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in `.env` (or swap models to a single provider).
