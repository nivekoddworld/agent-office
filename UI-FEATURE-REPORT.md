# UI Feature Coverage Report

Detailed audit of all backend commands, API endpoints, and features — cross-referenced with what the web UI actually uses.

---

## Summary

| Category                   | Total Backend Commands | Used in UI | Not Used in UI |
| -------------------------- | ---------------------- | ---------- | -------------- |
| Agent Management           | 5                      | 3          | 2              |
| Scheduler                  | 2                      | 2          | 0              |
| Skills                     | 3                      | 0          | 3              |
| Office                     | 3                      | 2          | 1              |
| Agent Config (env/secrets) | 4                      | 0          | 4              |
| Agent Config (prompt)      | 4                      | 0          | 4              |
| Agent Config (hierarchy)   | 2                      | 1          | 1              |
| Agent Config (permissions) | 5                      | 0          | 5              |
| Organization               | 1                      | 0          | 1              |
| Cron                       | 10                     | 8          | 2              |
| Tasks (commands)           | 3                      | 0          | 3              |
| Tasks (REST API)           | 3                      | 0          | 3              |
| Prompt Report              | 1                      | 0          | 1              |
| Cost                       | 3                      | 1          | 2              |
| **Totals**                 | **49**                 | **17**     | **32**         |

**Coverage: ~35% of backend commands are used by the UI.**

---

## 1. Commands USED in the UI

### Agent Management

| Command                  | UI Component                                               | How It's Used                                                       |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------- |
| `hire <name> [options]`  | `AddNodeModal.tsx` (Org Chart)                             | Hire dialog with name, model, priority, thinking level, description |
| `fire <agent>`           | `QuickActions.tsx`, `NodeActions.tsx`                      | Fire button with confirmation dialog                                |
| `send <agent> <message>` | `MessageInput.tsx`, `ThreadDrawer.tsx`, `QuickActions.tsx` | Via `POST /api/send` (not the command system)                       |

### Scheduler

| Command           | UI Component                               | How It's Used                         |
| ----------------- | ------------------------------------------ | ------------------------------------- |
| `scheduler start` | `AppLayout.tsx`, `OfficeSettingsModal.tsx` | Toggle button in sidebar and settings |
| `scheduler stop`  | `AppLayout.tsx`, `OfficeSettingsModal.tsx` | Toggle button in sidebar and settings |

### Office

| Command                 | UI Component                                  | How It's Used                              |
| ----------------------- | --------------------------------------------- | ------------------------------------------ |
| `office reload --force` | `QuickActions.tsx`, `OfficeSettingsModal.tsx` | Reload button in agent detail and settings |
| `office validate`       | `OfficeSettingsModal.tsx`                     | Validate button in settings modal          |

### Agent Config (Hierarchy)

| Command                             | UI Component | How It's Used                                         |
| ----------------------------------- | ------------ | ----------------------------------------------------- | ----------------------------------------------------- |
| `agent-set-manager <agent> <manager | **clear**>`  | `OrgChart.tsx`, `AddNodeModal.tsx`, `NodeActions.tsx` | Drag-and-drop in org chart, context menu, hire dialog |

### Cron

| Command                      | UI Component      | How It's Used                                       |
| ---------------------------- | ----------------- | --------------------------------------------------- |
| `cron add <agent> ...`       | `CronAddForm.tsx` | Add form with agent, name, schedule, message fields |
| `cron add office ...`        | `CronAddForm.tsx` | Add form with targets field for office scope        |
| `cron remove <agent> <job>`  | `CronJobRow.tsx`  | Delete button per job row                           |
| `cron remove office <job>`   | `CronJobRow.tsx`  | Delete button per office job row                    |
| `cron trigger <agent> <job>` | `CronJobRow.tsx`  | Manual trigger button per job row                   |
| `cron trigger office <job>`  | `CronJobRow.tsx`  | Manual trigger button per office job row            |
| `cron enable <agent> <job>`  | `CronJobRow.tsx`  | Toggle switch per job row                           |
| `cron disable <agent> <job>` | `CronJobRow.tsx`  | Toggle switch per job row                           |

### Cost

| Feature                | UI Component    | How It's Used                                                  |
| ---------------------- | --------------- | -------------------------------------------------------------- |
| `GET /api/cost?days=N` | `CostModal.tsx` | Cost chart with configurable day range, auto-refresh every 30s |

---

## 2. Commands NOT USED in the UI

### Agent Management

| Command  | Notes                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| `roster` | Agent list is handled by `/api/state` bootstrap data and SSE updates instead. No command invocation needed.      |
| `status` | Scheduler/agent status is handled by SSE `scheduler_tick` events and `/api/state`. No command invocation needed. |

### Skills (entire category unused)

| Command                          | Notes                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `skill add <agent> <owner/repo>` | `SkillsManager.tsx` exists but is **read-only** — displays skills from agent detail but has no add UI. |
| `skill list <agent>`             | Skills are displayed via `/api/agents/:name` detail endpoint, not the command.                         |
| `skill remove <agent> <name>`    | No remove button in the UI.                                                                            |

### Office

| Command       | Notes                                      |
| ------------- | ------------------------------------------ |
| `office path` | No UI for displaying the office YAML path. |

### Agent Config — Environment Variables (entire subcategory unused)

| Command                                    | Notes                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `agent env set <agent> <KEY> <VALUE>`      | `EnvEditor.tsx` exists but is **read-only** — displays env keys but has no set/edit UI. |
| `agent env unset <agent> <KEY>`            | No unset button in the UI.                                                              |
| `agent secret-ref set <agent> <KEY> <ENV>` | `EnvEditor.tsx` displays secret keys but has no set/edit UI.                            |
| `agent secret-ref unset <agent> <KEY>`     | No unset button in the UI.                                                              |

### Agent Config — Prompts (entire subcategory unused)

| Command                              | Notes                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `agent prompt show <agent>`          | `PromptViewer.tsx` displays prompt breakdown from `/api/agents/:name` detail endpoint, not the command. |
| `agent prompt set <agent> <text>`    | No edit UI for prompts.                                                                                 |
| `agent prompt append <agent> <text>` | No append UI for prompts.                                                                               |
| `agent prompt clear <agent>`         | No clear button for prompts.                                                                            |

### Agent Config — Hierarchy

| Command                        | Notes                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `agent hierarchy show <agent>` | Hierarchy is displayed via org chart and `/api/agents/:name`, not the command. |

### Agent Config — Permissions (entire subcategory unused)

| Command                                           | Notes                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------ |
| `agent permission show <agent>`                   | `PermissionsEditor.tsx` exists but is **read-only** — displays permissions but has no edit UI. |
| `agent permission set <agent> office_cron <bool>` | No UI to toggle office cron permission.                                                        |
| `agent permission set <agent> tools allow         | deny <tools>`                                                                                  | No UI to edit tool allow/deny lists. |
| `agent permission clear <agent> office_cron`      | No clear button for cron permission.                                                           |
| `agent permission clear <agent> tools`            | No clear button for tool permissions.                                                          |

### Agent Config — General

| Command                     | Notes                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `agent config show <agent>` | Config is displayed via `/api/agents/:name` detail endpoint in `ConfigSection.tsx`, not the command. |

### Organization

| Command     | Notes                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| `org chart` | The UI has a full graphical org chart (`OrgChart.tsx` with ReactFlow). The text-based command is not used. |

### Cron

| Command               | Notes                                                                         |
| --------------------- | ----------------------------------------------------------------------------- |
| `cron list`           | Cron jobs are loaded via `/api/state` bootstrap data, not the command.        |
| `cron status [agent]` | No detailed cron status view in the UI (attempt counts, skip counts, errors). |

### Tasks — Commands (entire category unused)

| Command               | Notes                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| `task list [filters]` | Tasks are loaded via `/api/state` bootstrap data. Kanban board is read-only. |
| `task board`          | Kanban board uses bootstrap state, not the command.                          |
| `task get <id>`       | `TaskDetailModal.tsx` displays task details from state, not the command.     |

### Tasks — REST API Endpoints (entire category unused)

| Endpoint                        | Notes                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /api/tasks` (create)      | **Endpoint exists in backend but is never called by the UI.** No task creation form.                    |
| `PATCH /api/tasks/:id` (update) | **Endpoint exists in backend but is never called by the UI.** No task status/assignee/priority editing. |
| `GET /api/tasks/:id`            | Individual task fetch exists but UI uses bootstrap state instead.                                       |

### Prompt Report

| Command                 | Notes                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `prompt report <agent>` | Prompt report data is included in `/api/agents/:name` detail endpoint. The command is not invoked. |

### Cost

| Command                | Notes                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `cost status`          | Session cost summary is not shown in the UI. Only the persistent log-based cost chart is used. |
| `cost today [--agent]` | No "today" cost view. The UI uses `GET /api/cost?days=N` instead.                              |
| `cost report --days N` | No command-based cost report. The UI uses the REST API directly.                               |

---

## 3. API Endpoints — Usage Status

### Actively Used by Frontend

| Endpoint                              | Frontend Consumer                                                |
| ------------------------------------- | ---------------------------------------------------------------- |
| `POST /api/auth`                      | `client.ts` — authentication flow                                |
| `GET /api/state`                      | `use-state.ts` — bootstrap state loading                         |
| `GET /api/events` (SSE)               | `use-events.ts` — real-time event stream                         |
| `GET /api/agents/:name`               | `use-agent-detail.ts` — agent detail panel (polls every 10s)     |
| `GET /api/agents/:name/inbox`         | `AgentProfileDrawer.tsx` — inbox queue preview (polls every 5s)  |
| `GET /api/agents/:name/files`         | `AgentFilesPanel.tsx` — workspace file browser (polls every 15s) |
| `GET /api/agents/:name/files/content` | `AgentFilesPanel.tsx` — file content viewer                      |
| `POST /api/send`                      | `send-message.ts` — send messages to agents                      |
| `POST /api/commands/:command`         | `use-command.ts` — execute REPL commands                         |
| `GET /api/cost`                       | `CostModal.tsx` — cost chart (polls every 30s)                   |

### Not Used by Frontend

| Endpoint               | Notes                                 |
| ---------------------- | ------------------------------------- |
| `GET /api/hierarchy`   | Data included in `/api/state` instead |
| `GET /api/tasks`       | Data included in `/api/state` instead |
| `GET /api/tasks/board` | Data included in `/api/state` instead |
| `GET /api/tasks/:id`   | Data included in `/api/state` instead |
| `POST /api/tasks`      | Never called — no task creation UI    |
| `PATCH /api/tasks/:id` | Never called — no task editing UI     |
| `GET /api/cron`        | Data included in `/api/state` instead |

---

## 4. UI Components — Capability Assessment

### Full-Featured (read + write)

| Component                                               | Read                   | Write                                    |
| ------------------------------------------------------- | ---------------------- | ---------------------------------------- |
| **Messaging** (ChannelView, MessageInput, ThreadDrawer) | SSE events             | `POST /api/send`                         |
| **Scheduler** (AppLayout, OfficeSettingsModal)          | SSE scheduler_tick     | `scheduler start/stop`                   |
| **Org Chart** (OrgChart, AddNodeModal, NodeActions)     | `/api/state` hierarchy | `hire`, `fire`, `agent-set-manager`      |
| **Cron** (CronDashboard, CronAddForm, CronJobRow)       | `/api/state` cronJobs  | `cron add/remove/trigger/enable/disable` |
| **Office Config** (OfficeSettingsModal)                 | state                  | `office reload/validate`                 |

### Read-Only (display data but cannot edit)

| Component               | What It Displays                              | What's Missing                                                           |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| **KanbanBoard**         | Tasks by status column                        | No create, update status, reassign, or change priority                   |
| **TaskDetailModal**     | Task details (status, assignee, deps, result) | No edit, no status transitions, no result entry                          |
| **SkillsManager**       | Installed skills list                         | No add skill, no remove skill                                            |
| **EnvEditor**           | Environment variable keys, secret keys        | No set/unset env vars, no set/unset secret refs                          |
| **PermissionsEditor**   | office_cron flag, tools allow/deny lists      | No toggle permissions, no edit tool lists                                |
| **PromptViewer**        | Prompt block breakdown, char counts           | No edit/set/append/clear prompt                                          |
| **ConfigSection**       | Agent config table (model, priority, etc.)    | No inline editing                                                        |
| **CostChart/CostModal** | Cost over time chart                          | No session cost, no "today" shortcut, no per-agent drilldown via command |

### Not Represented in UI at All

| Feature                             | Notes                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `roster` command                    | Replaced by sidebar agent list + SSE                                          |
| `status` command                    | Replaced by SSE scheduler_tick events                                         |
| `office path` command               | No equivalent UI element                                                      |
| `org chart` (text) command          | Replaced by graphical OrgChart component                                      |
| `cron status` command               | Detailed cron execution stats (attempt/sent/skipped counts, errors) not shown |
| `prompt report` command             | Data available in agent detail but command not invoked                        |
| `cost status/today/report` commands | Replaced by `GET /api/cost` REST endpoint                                     |
| `agent config show` command         | Replaced by `/api/agents/:name` REST endpoint                                 |
| `agent prompt show` command         | Replaced by `/api/agents/:name` prompt report                                 |
| `agent hierarchy show` command      | Replaced by org chart + agent detail                                          |
| `agent permission show` command     | Replaced by `/api/agents/:name` permissions data                              |
| Command palette / autocomplete      | Not implemented in UI                                                          |

---

## 5. Gap Analysis — Largest Opportunities

### High Impact (core workflow gaps)

1. **Task Management (create/update)**: The Kanban board and task detail modal are entirely read-only. Users cannot create tasks, change status, reassign, set priority, or enter results from the UI. The backend has full REST endpoints (`POST /api/tasks`, `PATCH /api/tasks/:id`) and command support — none of it is wired up.
2. **Skills Management (add/remove)**: `SkillsManager.tsx` shows skills but cannot install or remove them. The `skill add/remove` commands exist and work.
3. **Agent Config Editing (env/secrets)**: `EnvEditor.tsx` shows keys but has no editing capability. The `agent env set/unset` and `agent secret-ref set/unset` commands exist.

### Medium Impact (power-user features)

1. **Permissions Editing**: `PermissionsEditor.tsx` is read-only. Users cannot toggle `office_cron` or edit tool allow/deny lists from the UI.
2. **Prompt Editing**: `PromptViewer.tsx` is read-only. Users cannot set, append, or clear agent prompts from the UI.
3. **Cron Status Details**: The cron dashboard doesn't show execution statistics (attempt count, sent count, skipped-busy count, skipped-cap count, last error). The `cron status` command provides this data.
4. **Command Palette**: No command palette or autocomplete UI is implemented yet.

### Low Impact (adequately replaced)

1. **roster/status/org chart text commands**: These are read-only commands adequately replaced by real-time UI equivalents (SSE, sidebar, graphical org chart).
2. **cost status/today/report commands**: The `GET /api/cost` REST endpoint serves the same data more flexibly.
3. **agent config/prompt/hierarchy show commands**: All display data is available via the `/api/agents/:name` detail endpoint.
