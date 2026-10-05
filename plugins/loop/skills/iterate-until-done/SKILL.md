---
name: iterate-until-done
description: Set up a bounded iterate-until-done run with the loop plugin's /loop command. Use when the user wants the same task retried or refined across several replies until a check passes, such as "keep going until the tests pass" or "do this up to 5 times".
invocation: model+user
---

# Iterate until done

The loop plugin re-prompts this session after every finished reply, up to a hard
limit, until a completion phrase appears or the user cancels. You cannot start
it yourself: only the user's own `/loop` command can, so tell them the exact
command to run.

```text
/loop <prompt> [--max N] [--until <phrase>]
/loop-status
/cancel-loop
```

- `--max N` is the most iterations to run, 1 to 50, default 10. Pick the smallest number that fits the task.
- `--until <phrase>` ends the loop early when the final line of a reply is exactly that phrase. Quote it if it has spaces.
- Flags go at the end of the command so the prompt is not misread.

## Writing the prompt

The same prompt is used on every iteration, and each iteration sees the files the previous ones changed. So:

- State a check the loop can verify itself, such as "until `npm test` exits 0", and pair it with `--until`.
- Say what to do each round: inspect the current state, make one concrete improvement, verify it.
- Keep the scope small enough that a few iterations can finish it.

Example for the user to run:

```text
/loop Make `npm test` pass. Each round: run it, fix the first failure, run it again. --max 8 --until ALL_GREEN
```

## When you are inside an iteration

A message that starts with `[loop <id> #n/max]` is one iteration of a running loop.

- Continue from the work already in the workspace; do not restart.
- Make progress, then end your reply. The next iteration starts by itself.
- Write the completion phrase as the last line only when the task is truly done and verified. Never quote it, plan it or mention it otherwise, because the loop stops the moment it appears on its own line.
- If you are blocked and need the user, say so plainly and make no further changes.
- Never type `<<loop-...>>` markers; they are internal.

## Limits to mention

- It needs `[control_socket] enabled = true` in Codewhale's config; without it `/loop` refuses to start and says so.
- It does not run alongside an active `/goal`.
- State is in `.codewhale/loop/state.json` in the workspace; `/loop-status` summarizes it. A message that starts with `[loop notice]` is a status or error for you to relay in a sentence; do no other work.
