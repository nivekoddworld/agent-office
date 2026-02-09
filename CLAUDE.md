# CLAUDE.md

## What is this?

Agent Office — multi-agent workspace manager built on Pi. Orchestrates AI coding agents with tick-based scheduling, priority queues, mailbox IPC, and Telegram as a frontend.

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Type check (tsc --noEmit)
pnpm check            # Lint (eslint src/ test/)
pnpm test             # Run tests (vitest)
pnpm test:watch       # Tests in watch mode
pnpm dev start        # Run in dev mode (tsx)
```

## Project Structure

```
src/
  index.ts                CLI entry + REPL
  workspace.ts            Central facade
  types.ts                Shared types
  constants.ts            Shared constants (AGENT_OFFICE_DIR)
  agent/
    handle.ts             Agent lifecycle
    prompt.ts             System prompt builder
    tools/                One file per tool
      index.ts            Barrel re-export
      list-agents.ts      Discover agents
      read-agent-file.ts  Cross-agent file read
      send-mail.ts        Inter-agent mail
  scheduler/
    scheduler.ts          Tick-based priority scheduler
    watchdog.ts           Heartbeat monitor
    resource-guard.ts     Mutex + Semaphore
  transport/
    local.ts              In-process priority queues
    message-bus.ts        Bus wrapper
  bridges/
    telegram.ts           grammY Telegram bridge
  commands/               REPL command handlers
test/                     Unit tests (<feature>.test.ts)
```

## Coding Conventions

- TypeScript ESM, strict mode, Node 22+
- Max 400 lines per file (ESLint enforced)
- One tool per file in `src/agent/tools/`
- Tests in `test/` directory, not colocated
- Run `pnpm build && pnpm check && pnpm test` before committing

## Adding a New Agent Tool

1. Create `src/agent/tools/<tool-name>.ts`
2. Export the factory function
3. Add re-export to `src/agent/tools/index.ts`
4. Register in `src/agent/handle.ts` `init()` method
5. Add test in `test/tools.test.ts`
