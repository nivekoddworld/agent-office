# Agent Office: Multi-Agent Orchestration Runtime

Multi-agent orchestration runtime built on [Pi](https://github.com/badlogic/pi-mono) libraries. Manages AI coding agents with a tick-based scheduler, inter-agent messaging, cron jobs, task management, optional Docker sandboxing, and a web UI.

---

## Core Architecture

The system follows a **facade pattern** centered around `Workspace`, which wires together all subsystems:

```
Workspace (orchestrator)
├── Scheduler (tick-based, priority dispatch)
├── Watchdog (heartbeat monitoring, stuck detection)
├── MessageBus → LocalTransport (rate-limited message routing)
├── CronService → CronStore (scheduled message dispatch)
├── TaskService → TaskStore (Kanban-style task management)
├── AgentHandle[] (agent lifecycle wrappers)
└── [Optional] HostApi + DockerProvider (sandbox bridge)
```

## How It Works End-to-End

1. **Startup**: The CLI (`src/index.ts`) loads `office.yaml`, creates a `Workspace`, starts all services, spawns agents, and enters a REPL.

2. **Agent Spawning**: `Workspace.spawn()` validates the agent config, merges office/agent env+secrets, creates an `AgentHandle`, and initializes it — either **in-process** (using Pi's `Agent` class directly) or **sandboxed** (in Docker with a Host API bridge).

3. **Tick-Based Scheduling**: Every 2 seconds, the `Scheduler` sorts agents by priority (CRITICAL > HIGH > NORMAL > LOW > IDLE), drains each idle agent's inbox, picks the highest-priority message, sets the agent to "running", and dispatches it. Agents run concurrently via async I/O.

4. **Messaging**: The `MessageBus` wraps `LocalTransport` (in-memory per-agent queues) with rate limiting — agents are capped at 10 messages/30s, while `__user__` and `__cron__` senders are unlimited. Messages carry priority and are sorted on drain.

5. **Watchdog**: Checks every 10s. If a running agent hasn't heartbeated in 120s, it's considered stuck. The workspace aborts and re-initializes it, up to 5 times (reset counter after 10 minutes of health). Beyond that, the agent is marked "dead".

6. **Cron**: Per-agent and office-level cron jobs defined in `office.yaml`. Uses setTimeout-based scheduling with catch-up policies (`skip` or `once`). Global dispatch cap of 60/min. Skips busy agents.

7. **Tasks**: Kanban-style task management with statuses: `backlog → todo → in_progress → review → done` (and `cancelled → backlog` for reopen). Tasks support dependencies — when a task completes, all dependent `backlog` tasks auto-transition to `todo`. Max 500 tasks per office. Notifications are sent to assignees and creators on status changes.

---

## Agent System

Each agent is wrapped in an `AgentHandle` that abstracts away in-process vs. sandboxed execution:

- **In-process**: Creates a Pi `Agent` instance with a full tool array, applies tool policy, subscribes to events directly.
- **Sandboxed**: Starts a Docker container with a Pi agent inside. All tool calls route through the `HostApi` HTTP server on the host. Bearer-token authenticated per agent.

### Prompt Composition

Prompts are layered (9 blocks): base instructions, office context, hierarchy (manager/peers/reports), bootstrap files, memory system, runtime env, identity, custom instructions, and skills. The total is capped at 100K chars with per-block limits and head/tail truncation.

### Agent Tools

| Tool                                                     | Purpose                                              |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `message_agent`                                          | Send message to another agent (or broadcast)         |
| `list_agents`                                            | Discover all agents                                  |
| `read_agent_file`                                        | Read file from another agent's workspace             |
| `authenticated_fetch`                                    | HTTP requests with injected secrets (SSRF-protected) |
| `memory_search` / `memory_get`                           | Search/read memory files                             |
| `cron_add` / `cron_remove` / `cron_list`                 | Manage cron jobs                                     |
| `task_create` / `task_update` / `task_list` / `task_get` | Manage tasks                                         |
| `read_skill`                                             | Load on-demand skill content                         |
| + Pi coding tools                                        | File editing, shell execution, etc.                  |

Tool access is controlled by `permissions.tools.allow/deny` — enforced both at tool registration and at Host API endpoints (defense in depth).

---

## Configuration System

Offices are configured via `office.yaml` and stored under `~/.agent-office/offices/<officeId>/`. The config system supports:

- **Env substitution**: `${VAR}` references resolved at load time
- **Hierarchy**: Manager/peer/report relationships with cycle detection
- **Mutations**: All YAML mutations use in-process queueing + `proper-lockfile` for concurrent safety
- **Atomic writes**: Temp file + rename pattern prevents corruption
- **Validation**: Agent names (`^[a-zA-Z0-9_-]+$`), office IDs (`^[a-z0-9][a-z0-9_-]*$`), cron expressions, hierarchy cycles, etc.

---

## Web UI

A **React 19 + Mantine 7** frontend with a Slack-inspired design:

- **Slack-style messaging**: Channel/DM sidebar, message grouping, threads, markdown rendering, unread badges
- **Kanban board**: Task management with columns for each status, priority badges, dependency tracking
- **Org chart**: `@xyflow/react`-based visualization with drag-and-drop to change reporting hierarchy
- **Agent detail**: Config inspection, env editor, permissions editor, prompt viewer, skills manager
- **Real-time**: SSE connection for live event streaming, auto-reconnect with `Last-Event-ID` resumption
- **State management**: `useSyncExternalStore` pattern with ring buffers (events), thread stores, activity tracking, and unread counts

---

## Security

- **Secret redaction**: Events and responses sanitize sensitive data before forwarding
- **SSRF protection**: DNS resolution checks, private IP blocking, HTTPS enforcement
- **Path traversal guards**: `realpath()` validation ensures reads stay within workspaces
- **Docker isolation**: Optional sandboxing with HostApi bridge
- **Rate limiting**: Per-source message caps prevent abuse
- **CSRF**: UI backend checks `Origin === http://127.0.0.1:<port>`

---

## Test Suite

**43 Vitest test files** covering all core modules:

- Self-contained tests with temp directories and cleanup
- `vi.useFakeTimers()` for time-dependent behavior (scheduler ticks, watchdog checks)
- Minimal interface mocks (`as any`) for flexibility
- Integration-style tests (real services + message bus)
- Persistence verification (write → restart → read)
- Edge case coverage (invalid IDs, cycles, rate limits)

---

## Key Files & Directories

```
src/
├── index.ts                    # CLI entrypoint (Commander.js)
├── workspace.ts                # Central orchestrator facade
├── types.ts                    # Shared type definitions
├── constants.ts                # Configuration constants, path helpers
├── agent/
│   ├── handle.ts               # Agent lifecycle management
│   ├── handle-init.ts          # Agent initialization (in-process & sandbox)
│   ├── prompt.ts               # Prompt convenience wrapper
│   ├── entrypoints/            # Sandbox Docker entry
│   ├── prompts/                # Prompt system (base, manager, bootstrap, truncate)
│   ├── tools/                  # All agent tools (message, cron, task, fetch, memory, skills)
│   │   └── proxy/              # Sandbox proxy tool wrappers
│   ├── memory/                 # Memory search utility
│   └── skills/                 # On-demand skill loading
├── scheduler/
│   ├── scheduler.ts            # Tick-based priority scheduler
│   └── watchdog.ts             # Heartbeat monitoring, stuck detection
├── transport/
│   ├── message-bus.ts          # Message bus with rate limiting
│   └── local.ts                # In-process priority inbox queues
├── config/
│   ├── office-yaml.ts          # Office config loading, validation, mutations
│   ├── yaml-utils.ts           # Shared validation, atomic writes
│   ├── yaml-validation.ts      # Validation logic
│   ├── office-yaml-mutations.ts # YAML mutation helpers
│   ├── env-substitution.ts     # ${VAR} resolution
│   ├── hierarchy.ts            # Org hierarchy management
│   └── lock.ts                 # Two-layer locking
├── cron/
│   ├── cron-service.ts         # Timer orchestrator
│   ├── cron-store.ts           # State persistence
│   ├── cron-parser.ts          # Cron expression parsing
│   └── types.ts                # Cron type definitions
├── tasks/
│   ├── task-service.ts         # Task orchestrator (Kanban, dependencies)
│   ├── task-store.ts           # Persistence
│   ├── task-audit.ts           # Audit logging
│   └── types.ts                # Task types and status transitions
├── sandbox/
│   ├── docker-provider.ts      # Container lifecycle
│   ├── host-api.ts             # HTTP server for sandbox bridge
│   ├── host-api-handlers.ts    # API endpoint handlers
│   ├── host-api-ext-handlers.ts # Extended handlers
│   ├── types.ts                # Sandbox types
│   └── Dockerfile              # Container image
├── ui/
│   ├── server.ts               # Express server
│   ├── routes.ts               # API routes
│   ├── command-parser.ts       # Command parsing
│   ├── command-dispatch-sub.ts # Command dispatch
│   ├── event-buffer.ts         # SSE event buffering
│   └── types.ts                # UI types
├── commands/                   # CLI/REPL command handlers
├── security/                   # Secret redaction
├── metrics/                    # Token/cost usage tracking
└── skills/                     # Skill management

ui/                             # React + Vite web UI
├── src/
│   ├── App.tsx                 # Root component (auth, SSE, routing)
│   ├── main.tsx                # Bootstrap (React, Mantine, Query)
│   ├── api/                    # API client, hooks (state, events, commands, agent-detail)
│   ├── components/
│   │   ├── slack/              # Slack-style messaging UI
│   │   ├── kanban/             # Kanban task board
│   │   ├── org-chart/          # Org chart visualization
│   │   ├── agent-detail/       # Agent config/prompt/skills views
│   │   ├── cron/               # Cron dashboard
│   │   ├── cost/               # Cost charts
│   │   ├── shared/             # Shared components
│   │   └── layout/             # App layout
│   ├── store/                  # State management (events, threads, activity, unread)
│   └── theme/                  # Theming (Slack-inspired dark theme)

test/                           # 43 Vitest test files
examples/                       # Example office configurations (basic-team, feature-team, openserv-team)
```

---

## Dependencies

- **Core**: `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent` (v0.52.7)
- **CLI**: `commander`
- **Config**: `yaml`, `@sinclair/typebox`, `proper-lockfile`, `cron-parser`
- **UI**: React 19, Mantine 7, `@xyflow/react`, `@tanstack/react-query`, Vite 6
- **Dev**: TypeScript 5.8, Vitest 4, ESLint 9, Prettier 3, tsx

---

## Environment Variables

```bash
OPENAI_API_KEY=     # Required for OpenAI models
ANTHROPIC_API_KEY=  # For Anthropic models
GEMINI_API_KEY=     # For Google Gemini
XAI_API_KEY=        # For X.AI models
```

---

## Build, Test & Dev Commands

```bash
pnpm build            # TypeScript type check (tsc --noEmit)
pnpm lint              # ESLint with --fix
pnpm lint:check        # ESLint check only
pnpm format            # Prettier write
pnpm format:check      # Prettier check
pnpm test              # Vitest run (full suite)
pnpm test:watch        # Vitest watch mode
pnpm dev               # Run CLI with tsx (hot-reload)

# UI
pnpm ui:build          # Vite build for React UI
pnpm ui:lint           # Lint UI code
pnpm ui:check          # UI type check

# Full check
pnpm build && pnpm lint && pnpm test
```
