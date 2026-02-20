# Feature Team — Task-Driven Development

Demonstrates task tools with dependency chains and Kanban board.

## Agents

| Agent | Role | Description |
|-------|------|-------------|
| **task-manager** | Task Manager | Receives user requests, creates tasks with dependencies |
| **coder** | Developer | Implements coding tasks |
| **reviewer** | Reviewer | Reviews code when coding tasks complete |

## How It Works

1. Send task-manager a feature request:
   ```
   send task-manager Add a forgot-password feature to the login page
   ```

2. task-manager creates two tasks automatically:
   - `T-xxx`: "Implement forgot-password" → assigned to **coder** (status: `todo`)
   - `T-yyy`: "Review forgot-password" → assigned to **reviewer**, depends on `T-xxx` (status: `backlog`)

3. **Coder** receives notification, implements the feature, marks task done

4. **TaskService** detects dependency resolved → moves review task to `todo` → **reviewer** gets notified

5. **Reviewer** reads coder's files, reviews, marks review task done

## Task Tools

Task tools (`task_create`, `task_update`, `task_list`, `task_get`) are available to all
in-process agents by default. Per-agent access can be restricted via `permissions.tools.deny`.

## Track Progress

- **CLI**: `task board` or `task list`
- **Web UI**: Click "Tasks" in the sidebar for the Kanban board
- **Programmatic**: `GET /api/tasks/board`

## Setup

```bash
pnpm dev start --office feature-team
```
