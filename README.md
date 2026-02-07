# pi-tests

FreeRTOS-inspired multi-agent workspace manager. Spawns and orchestrates multiple sandboxed [Pi](https://github.com/nichochar/pi-mono) agent instances from a single control point with tick-based scheduling, priority queues, mailbox IPC, mutex/semaphore guards, and a watchdog. Optionally routes messages through Telegram.

## Architecture

```
                          Telegram (grammY)
                               |
                               v
CLI REPL  ──>  Workspace (facade)
                   |        |        |
              Scheduler  MessageBus  Watchdog
              (tick loop) (mailboxes) (heartbeat)
                   |        |
                   v        v
              ┌─────────┐ ┌─────────┐ ┌─────────┐
              │ Agent A  │ │ Agent B  │ │ Agent C  │
              │ (Pi)     │ │ (Pi)     │ │ (Pi)     │
              │ sandbox/ │ │ sandbox/ │ │ sandbox/ │
              │ skills/  │ │ skills/  │ │ skills/  │
              └─────────┘ └─────────┘ └─────────┘
```

**Core flow:** CLI REPL (or Telegram) -> Workspace -> Scheduler tick -> drain mailbox -> dispatch to Pi Agent -> agent runs tools (bash, read, write, edit, send_mail) -> response.

Each agent is a full Pi coding agent with its own filesystem sandbox, skills, and an injected `send_mail` tool for inter-agent communication. The scheduler runs a FreeRTOS-style tick loop that serves agents by priority, one message per tick per agent, non-blocking.

## Quick Start

```bash
# Install
pnpm install

# Start the REPL (set your API key first)
ANTHROPIC_API_KEY=sk-... pnpm dev start

# With Telegram
TELEGRAM_BOT_TOKEN=xxx ANTHROPIC_API_KEY=sk-... pnpm dev start --telegram
```

## REPL Commands

| Command | Description |
|---|---|
| `spawn <name> [options]` | Create a new agent |
| `list` | Show all agents with status table |
| `send <agent> <message>` | Queue a message for an agent |
| `kill <agent>` | Stop and remove an agent |
| `status` | Show scheduler, watchdog, and resource state |
| `route <chatId> <agent>` | Route a Telegram chat to an agent |
| `route list` | List all Telegram chat routes |
| `help` | Show available commands |
| `exit` | Shutdown |

### spawn options

```
spawn <name>
  --model <provider:id>     Model to use (default: anthropic:claude-sonnet-4-20250514)
  --priority <0-4>          Priority level: 0=IDLE, 1=LOW, 2=NORMAL, 3=HIGH, 4=CRITICAL
  --thinking <level>        Thinking level: off, minimal, low, medium, high
  --cwd <path>              Custom working directory (default: ~/.pi-tests/agents/<name>/workspace)
  --prompt <text>           Custom system prompt
```

### Example session

```
$ ANTHROPIC_API_KEY=sk-... pnpm dev start
[scheduler] Started (tick=2000ms)
[watchdog] Started (check=10s, threshold=120s)

pi> spawn coder --model anthropic:claude-sonnet-4-20250514 --priority 3
[spawn] Agent "coder" created (cwd: ~/.pi-tests/agents/coder/workspace)

pi> spawn reviewer --model anthropic:claude-haiku-4-5 --priority 1
[spawn] Agent "reviewer" created (cwd: ~/.pi-tests/agents/reviewer/workspace)

pi> list
NAME            STATUS    PRIORITY    MODEL                       QUEUE  TURNS  HEARTBEAT
coder           idle      HIGH(3)     claude-sonnet-4-5..         0      0      2s ago
reviewer        idle      LOW(1)      claude-haiku-4-5            0      0      1s ago

pi> send coder "read the project and fix any bugs"
[send] Message queued for coder

pi> status
Scheduler: tick #42, 2 agents, 0 locked resources
Watchdog: 0 stuck

pi> kill reviewer
[kill] Agent "reviewer" stopped
```

## Concepts

### Tick-Based Scheduler

The scheduler runs a `setInterval` tick loop (default 2 seconds). Each tick:

1. Sorts agents by priority (CRITICAL=4 first, IDLE=0 last)
2. Skips agents that are currently mid-prompt (`status === "running"`)
3. Drains each agent's mailbox, delivers the highest-priority message
4. Dispatches the agent prompt **non-blocking** — agents run concurrently via async I/O
5. Re-queues remaining messages for the next tick

This means Agent A making an LLM call never blocks Agent B. All agents run their Pi loops concurrently within the same Node.js process.

```
--tick-interval <ms>    Configure via CLI flag (default: 2000)
```

### Priority Levels

| Level | Value | Use case |
|---|---|---|
| `IDLE` | 0 | Background tasks, monitoring |
| `LOW` | 1 | Review, optimization passes |
| `NORMAL` | 2 | Standard work (default) |
| `HIGH` | 3 | Primary agents, user-facing |
| `CRITICAL` | 4 | Urgent, time-sensitive |

Higher-priority agents are always served first within each tick. One message per tick per agent prevents starvation.

### Mailbox IPC

Each agent gets a priority-sorted message queue. Agents communicate autonomously via a `send_mail` tool injected into every agent's toolset:

```
Agent "designer" calls send_mail:
  to: "content"
  message: "I built the HTML structure. Write copy for hero, menu, about sections."

→ Message lands in "content" agent's mailbox
→ Next scheduler tick delivers it
→ "content" starts working
```

Broadcast to all agents with `to: "__broadcast__"`.

Messages between agents are sorted by priority within each mailbox, so a CRITICAL message from one agent will be delivered before a NORMAL message from another.

### Sandboxing

Each agent gets an isolated workspace directory:

```
~/.pi-tests/agents/
  agent-a/
    workspace/          # agent's cwd — all file tools scoped here
    skills/             # agent-specific skills (*.md / SKILL.md)
  agent-b/
    workspace/
    skills/
```

`createCodingTools(cwd)` from Pi scopes all file tools (read, write, edit, bash) to the agent's workspace directory. The agent cannot access files outside its sandbox through the tool interface. You can override the workspace directory with `--cwd`.

### Skills

Skills are markdown files with YAML frontmatter, loaded from each agent's `skills/` directory. They get injected into the agent's system prompt automatically.

```
~/.pi-tests/agents/designer/skills/
  design-system.md        # Root-level skill (any *.md)
  accessibility/
    SKILL.md              # Nested skill (must be SKILL.md)
```

Manage skills per agent via CLI:

```bash
# Install a skill package for an agent
pnpm dev skill install designer npm:@anthropic/web-skills

# List skills
pnpm dev skill list designer

# Remove
pnpm dev skill remove designer npm:@anthropic/web-skills
```

### Watchdog

The watchdog runs periodic heartbeat checks (default: every 10 seconds). If an agent's last heartbeat exceeds the stuck threshold (default: 120 seconds), it aborts the agent and re-initializes it with a fresh Pi instance.

Every Pi agent event (message updates, tool executions, turn completions) resets the heartbeat timer, so an agent actively streaming or running tools won't be flagged as stuck.

### Resource Guards

Mutex and semaphore primitives for coordinating shared resource access between agents:

```ts
// Mutex — one holder at a time
const release = await workspace.mutex.acquire("database", "agent-a");
// ... exclusive work ...
release();

// Semaphore — N concurrent holders
workspace.semaphore.create("api-rate-limit", 3);
const release = await workspace.semaphore.acquire("api-rate-limit");
// ... up to 3 agents concurrently ...
release();
```

### Telegram Integration

Connect a Telegram bot as a messaging frontend. Incoming messages route to agents via chat ID mapping; agent responses are sent back as Telegram replies.

```bash
# Start with Telegram
TELEGRAM_BOT_TOKEN=xxx pnpm dev start --telegram

# In REPL: route a specific chat to an agent
pi> route 123456789 designer

# Or let the default agent (first spawned) handle all unrouted chats
```

Long responses are automatically split at the 4000-character boundary.

### API Key Configuration

Two modes:

1. **Environment variables** (default): Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, etc. Pi auto-resolves at the provider layer.
2. **Per-agent override**: Pass `--prompt` or configure programmatically with `apiKey` in `AgentConfig` for agents using different providers/keys.

## Project Structure

```
src/
  index.ts              CLI entry + REPL
  types.ts              All shared types (Priority, AgentConfig, MailboxMessage, etc.)
  agent-handle.ts       Pi Agent wrapper — sandbox, skills, send_mail tool
  message-bus.ts        Per-agent priority mailbox queues
  scheduler.ts          Tick-based priority scheduler
  watchdog.ts           Heartbeat monitor + stuck detection
  workspace.ts          Central facade wiring everything together
  resource-guard.ts     Mutex + Semaphore via async-mutex
  telegram.ts           grammY bridge
  transport/
    types.ts            Transport interface
    local.ts            In-process transport implementation
  commands/
    spawn.ts            Agent creation with model/priority parsing
    list.ts             Agent status table
    send.ts             Message queueing
    kill.ts             Agent teardown
    status.ts           Scheduler/watchdog/resource overview
    route.ts            Telegram chat routing
    skill.ts            Per-agent skill install/list/remove
```

## End-to-End Example: Landing Page Builder

Three agents collaborate to build a landing page:

```
pi> spawn designer --model anthropic:claude-sonnet-4-20250514 --priority 3
pi> spawn content --model anthropic:claude-haiku-4-5 --priority 2
pi> spawn optimizer --model anthropic:claude-haiku-4-5 --priority 1
pi> send designer "Build a landing page for a coffee shop called Bean & Brew. Modern, minimal, responsive."
```

What happens across scheduler ticks:

```
Time ──────────────────────────────────────────────────────────────►

designer  [████ structure ████]  idle  [███ integrate copy ███]  idle  [█ fixes █]
content                         [████ writing copy ████]
optimizer                       [██ initial scan ██]     idle    [███ final review ███]
```

1. **designer** (priority 3) builds `index.html` + `styles.css`, then calls `send_mail` to delegate copy writing to **content** and review to **optimizer**
2. **content** (priority 2) and **optimizer** (priority 1) receive messages in parallel on the next tick
3. **content** writes `copy.json`, sends it back to **designer** via `send_mail`
4. **designer** integrates the copy, notifies **optimizer** to do final review
5. **optimizer** reviews for accessibility/performance, sends fixes back to **designer**
6. **designer** applies fixes — done

All coordination happens autonomously via the `send_mail` tool. No human intervention after the initial prompt.

## Dependencies

| Package | Purpose |
|---|---|
| `@mariozechner/pi-agent-core` | Pi agent runtime (Agent class, event system, tool interface) |
| `@mariozechner/pi-coding-agent` | Sandboxed coding tools (bash, read, write, edit), skills system |
| `@mariozechner/pi-ai` | Model registry, streaming, API key resolution |
| `@sinclair/typebox` | JSON Schema types for tool parameters |
| `async-mutex` | Mutex and semaphore primitives |
| `commander` | CLI argument parsing |
| `grammy` | Telegram Bot API |

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # TypeScript type check (tsc --noEmit)
pnpm check            # ESLint
pnpm dev start        # Run in dev mode (tsx)
```

Requires Node 22+.
