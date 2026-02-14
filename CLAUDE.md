# CLAUDE.md

## What is this?

Agent Office — multi-agent workspace manager built on Pi. Orchestrates AI coding agents with tick-based scheduling, priority queues, mailbox IPC, multi-office architecture, and Telegram as a frontend.

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Type check (tsc --noEmit)
pnpm check            # Lint (eslint src/ test/)
pnpm test             # Run tests (vitest)
pnpm test:watch       # Tests in watch mode
pnpm dev start --office <name>   # Run in dev mode (tsx)
```

## Project Structure

```
src/
  index.ts                CLI entry + REPL (--office required)
  workspace.ts            Central facade
  types.ts                Shared types (OfficeYaml, OfficeContext, etc.)
  constants.ts            Office path helpers, officeId validation
  config/
    office-yaml.ts        Office loader, validator, mutations
    yaml-utils.ts         Shared validation, cron extraction, atomic writes
    lock.ts               Two-layer lock (in-process + cross-process)
  agent/
    handle.ts             Agent lifecycle
    prompt.ts             System prompt builder
    prompts/
      prompt-manager.ts   Layered composition (base → office → runtime → identity → custom)
    tools/                One file per tool
  commands/
    office-apply.ts       Apply office.yaml + reload/validate/path
    hire.ts               Agent creation (persists to office.yaml)
    fire.ts               Agent teardown (removes from office.yaml)
    roster.ts             Agent status table
    migrate.ts            Legacy agents.yaml → office.yaml migration
  scheduler/
    scheduler.ts          Tick-based priority scheduler
    watchdog.ts           Heartbeat monitor
  transport/
    local.ts              In-process priority queues
    message-bus.ts        Bus wrapper
  bridges/
    telegram.ts           grammY Telegram bridge
test/                     Unit tests (<feature>.test.ts)
```

## Multi-Office Architecture

Each office lives under `~/.agent-office/offices/<id>/` with its own `office.yaml`, agents dir, and config lock.

- **officeId**: path-safe (`[a-z0-9][a-z0-9_-]*`), used for CLI flags and filesystem
- **office.name**: free-form display label in YAML, used in prompts
- `--office <name>` is required for all runtime commands
- Office-level env/secrets are inherited by all agents (agent overrides office)

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
