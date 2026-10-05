---
description: Triage the Linear queue, claim an issue, or draft a status update
usage: /linear [triage <team> | mine | claim <issue-id> | status <project>]
---

$ARGUMENTS

Use the Linear MCP tools. Load the matching skill and follow it exactly:

- `triage <team>`: load `linear-workflow:issue-triage`; list the triage queue and present
  proposed changes in a table. Change nothing until the user confirms rows.
- `mine` (or no argument): list issues assigned to me that are not completed
  (`list_issues` with assignee `"me"`), ordered by priority, with status and
  last update. Read-only.
- `claim <issue-id>`: load `linear-workflow:issue-triage` and run its claim workflow.
  Stop and report if someone else owns the issue or it is already started.
- `status <project>`: load `linear-workflow:status-update` and draft the update in chat.
  Post it only after the user approves the text.

Writes to Linear are shared state: state the exact change before making it.
If the Linear tools are unavailable or authentication fails, give the recovery
step from the skill and stop. Never print or request the API key.
