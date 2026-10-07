---
description: Review a GitHub pull request read-only and report findings in chat
usage: /pr <number | PR URL | owner/repo#number>
---

Review this pull request: $ARGUMENTS

Load the `github-workflow:pr-review` skill and follow it exactly. This command is
read-only: gather the PR description, changed files, diff, checks and existing
discussion with the GitHub MCP tools, then give the report in the skill's format.

Do not post a comment or review, approve, request changes, label, merge or close
anything. If the user then asks you to post, show the exact text and wait for a
clear approval first.

If no argument was given, ask which pull request to review. If the GitHub tools
are not available or the first call fails authentication, say so with the
recovery step from the skill and stop.
