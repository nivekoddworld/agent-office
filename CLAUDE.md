# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this?

Agent Office — multi-agent workspace manager built on [Pi](https://github.com/nicholasgasior/pi). Orchestrates AI coding agents with tick-based scheduling, priority queues, mailbox IPC, multi-office architecture, and Telegram/web UI as frontends.

## Commands

```bash
pnpm install                      # Install dependencies
pnpm build                        # Type check (tsc --noEmit)
pnpm lint                         # Lint + autofix (eslint src/ test/)
pnpm lint:check                   # Lint without autofix
pnpm format                       # Format (prettier)
pnpm test                         # Run all tests (vitest run)
pnpm test -- test/scheduler.test  # Run a single test file
pnpm test:watch                   # Tests in watch mode
pnpm dev start --office <id>      # Run in dev mode (tsx)
pnpm ui:build                     # Build the React web UI
```

Pre-commit: `pnpm build && pnpm lint:check && pnpm test`

## Architecture

### Core loop

`Workspace` is the central facade. It wires together:

1. **Scheduler** (`scheduler/scheduler.ts`) — tick-based (default 2s), sorts agents by `Priority` (IDLE→CRITICAL), drains mailboxes, dispatches prompts/steers. Non-blocking: agents run concurrently via async I/O.
2. **MessageBus** → **LocalTransport** (`transport/`) — per-agent priority queues with rate-limiting (10 msgs/30s per sender). Supports `__broadcast__` and `__cron__` senders.
3. **Watchdog** (`scheduler/watchdog.ts`) — heartbeat monitor, restarts stuck agents.
4. **CronService** (`cron/`) — persistent cron jobs with catch-up, per-agent and office-level schedules stored in `cron/` dir under office.

### Agent lifecycle

`AgentHandle` (`agent/handle.ts`) wraps a Pi `Agent`. Two execution modes:
- **In-process** — direct `Agent` instance with coding tools, mailbox, memory, cron tools.
- **Sandboxed (Docker)** — container via `DockerProvider`, communicates through `HostApi` HTTP bridge. System prompt built host-side, agent runs inside container.

Tools are built via factory functions (`agent/tools/`), one file per tool. Proxy variants (`agent/tools/proxy/`) are for sandboxed agents calling back to the host API.

### Prompt system

`composeSystemPrompt` in `agent/prompts/prompt-manager.ts` assembles blocks in order: base → office → hierarchy → bootstrap → memory → runtime → identity → custom → skills. Two modes: `full` (all blocks) and `minimal` (base + identity + custom only). Blocks are truncated via configurable limits. Bootstrap files are loaded from `<agent-dir>/bootstrap/`.

### Multi-office architecture

Each office lives at `~/.agent-office/offices/<id>/` with:
- `office.yaml` — agents, env, secrets, cron, hierarchy
- `agents/<name>/workspace/` — agent working directory
- `agents/<name>/bootstrap/` — files injected into system prompt
- `agents/<name>/skills/` — skill files
- `cron/` — persistent cron state

`officeId` must match `[a-z0-9][a-z0-9_-]*`. The `--office <id>` flag is required for all runtime commands. Office-level env/secrets are inherited by agents (agent overrides office).

### Config system

`office-yaml.ts` handles loading, validation, and mutations of `office.yaml`. All YAML mutations use a two-layer lock (`config/lock.ts`): in-process mutex + cross-process file lock via `proper-lockfile`. Env values support `${VAR}` references resolved from `process.env`.

### Web UI

React SPA in `ui/` (separate package). Backend is a raw `http.createServer` in `src/ui/server.ts` with SSE for real-time events, session-cookie auth, CSRF protection, and SPA fallback. Commands dispatched through `command-parser.ts` → `command-intent.ts` (classifies mutations for SSE broadcast).

### Bridges

- **Telegram** (`bridges/telegram.ts`) — grammY bot, mention-only messages, allowed-users ACL.
- **Web UI** — launched via `ui` REPL command, opens browser with bootstrap token.

## Coding Conventions

- TypeScript ESM, strict mode, Node 22+
- Max 400 lines per file (ESLint enforced, disabled for test files)
- One tool per file in `src/agent/tools/`
- Tests in `test/` directory, not colocated
- `noUncheckedIndexedAccess` enabled — handle `T | undefined` on indexed access

## Adding a New Agent Tool

1. Create `src/agent/tools/<tool-name>.ts` — export a `create<ToolName>Tool()` factory
2. Add re-export to `src/agent/tools/index.ts`
3. Register in `AgentHandle.init()` (`src/agent/handle.ts`) in the `allTools` array
4. If sandboxed agents need it, create proxy variant in `src/agent/tools/proxy/`
5. Add test in `test/tools.test.ts`
