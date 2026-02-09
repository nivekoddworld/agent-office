# basic-team

Three-agent workspace: a product manager, a coder, and a reviewer.

| Agent | Role |
|---|---|
| `pm` | Breaks down user requests into tasks, assigns work, tracks progress |
| `coder` | Writes and debugs code |
| `reviewer` | Reviews code for bugs, style, and correctness |

Agents coordinate autonomously via `send_mail` and `read_agent_file`.

## Usage

```bash
mkdir -p ~/.agent-office
cp examples/basic-team/agents.yaml ~/.agent-office/agents.yaml
pnpm dev start --sandbox docker
```

Then in the REPL:

```
ao> send pm "Build a REST API for a todo app with CRUD endpoints"
```

The PM will break the task down and delegate to coder and reviewer.
