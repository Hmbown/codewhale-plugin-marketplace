# Loop

Run one task again and again until it is done. `/loop` re-prompts your Codewhale
session after every finished reply, up to a hard limit, and stops when the
completion phrase shows up, when you cancel, or when something goes wrong.

```text
/loop <prompt> [--max N] [--until <phrase>]
/loop-status
/cancel-loop          (aliases: /loop-cancel, /stop-loop)
```

**Start here.** Complete the setup below, then in a repository with a failing
test suite run:

```text
/loop Make `npm test` pass. Each round: run it, fix the first failure, run it again. --max 8 --until ALL_GREEN
```

Success looks like this: the reply for each round starts from the previous
round's files, the loop ends on a reply whose last line is `ALL_GREEN`, and
`/loop-status` says `completed`. If the limit comes first, the loop ends with
`capped` and the model writes a short wrap-up of what remains.

## Setup (required)

Codewhale hooks cannot start a turn by themselves, so the loop asks for each
next iteration over your session's local control socket. That socket is off by
default. Add this to `~/.codewhale/config.toml` and restart Codewhale:

```toml
[control_socket]
enabled = true

[hooks]
enabled = true   # the default; the loop needs hooks on
```

Then install, review, trust and enable the plugin:

```text
/plugin install <path-to-this-directory>
/plugin show loop
/plugin trust loop <content-hash>.<capability-hash>
/plugin enable loop
/plugin reload
/hooks list            # should list loop-gate (message_submit) and loop-turn-end (turn_end)
```

Prerequisites: Codewhale 0.10.1 or newer, `node` 22 or newer on `PATH`, macOS or
Linux (control sockets are Unix-only). Install at user scope, which is what
`/plugin install` does by default: the hooks run the engine from
`$CODEWHALE_HOME/plugins/loop` (or `~/.codewhale/plugins/loop`).

If you type `/loop` and the model answers that "the loop plugin is not active",
the message hook did not run. Check `/plugin list` (trusted and enabled), then
`/hooks list`, and that `[hooks] enabled` is not `false`.

## What it does

| Command | Effect |
| --- | --- |
| `/loop <prompt> [--max N] [--until <phrase>]` | Starts a loop and runs iteration 1 now. |
| `/loop-status` | Reports the loop's status. The plugin works it out; the model only relays one line. |
| `/cancel-loop` | Cancels the loop. The plugin does it; the model only acknowledges. A continuation already queued is dropped. |

- `--max N` is the most iterations it will run, 1 to 50, default 10. It cannot
  be set higher than 50. The first iteration counts.
- `--until <phrase>` ends the loop when the model's final line is exactly that
  phrase (quote it if it has spaces). A phrase inside a sentence or quoted
  mid-reply does not count. Without it the loop runs `--max` iterations.
- Put the flags at the end so they are not mistaken for part of the prompt.
- Every iteration sends the same prompt plus a short set of rules. The model
  finds the earlier work in the workspace and continues. A loop is exactly as
  good as the check you give it: name something it can verify, like a test
  command.

## Safety

The loop stops, and cannot be restarted by a stray event, when any of these happens:

| Stop | Status |
| --- | --- |
| The completion phrase is the last line of a reply | `completed` |
| The iteration count reaches `--max` (a wrap-up turn follows) | `capped` |
| You run `/cancel-loop` | `cancelled` |
| A turn fails or is interrupted (press Esc to stop a loop) | `stopped` |
| The control socket is unreachable, the transcript cannot be read to check `--until`, or the session cannot be identified | `error` |
| Six hours pass since it started | `expired` |

Design points worth knowing:

- Only the message hook counts, caps and starts an iteration. The turn-end hook
  can only *ask*; a duplicate or racing event cannot run past the cap, and a
  continuation that was queued before `/cancel-loop` is dropped when it arrives.
  The message hook never blocks a message (Codewhale hands a blocked message back
  to your input box), so a dropped request shows up as a one-line notice instead.
- A loop belongs to the session that started it. State files copied from a
  repository, or left by another session, are ignored.
- It refuses to start while a native `/goal` is active, so two loops are never
  re-prompting the same session. It also refuses a second `/loop` while one is
  running (an abandoned one older than two hours is replaced).
- If the engine, `node` or the socket is missing, it fails visibly (`/loop` is
  refused with the reason, or the loop stops with the reason in `/loop-status`)
  and never blocks an ordinary message.
- Typing your own message during a loop is allowed. It runs in order and the
  loop continues after it; only turns the loop started count as iterations.
  Use `/cancel-loop` to stop. If you cancel while a reply is still running, that
  reply finishes and then nothing further starts.

## What it touches

- Writes `.codewhale/loop/state.json` (prompt, limits, status, session id) in
  the workspace, plus a `.gitignore` there so it is never committed. Nothing
  else is written.
- Reads your session transcript under `$CODEWHALE_HOME/sessions` to check the
  final reply, only when `--until` is used.
- Talks only to your own session's Unix socket. It makes no network requests,
  needs no credentials and sends nothing anywhere.
- Each iteration is a normal model turn on your selected provider and model, so
  it costs what that many turns cost. The cap is your spending limit.

## Troubleshooting

| You see | Cause |
| --- | --- |
| `/loop` is refused: "no live Codewhale control socket" | `[control_socket] enabled = true` is missing, or Codewhale was not restarted after adding it. |
| Same, but the config is right | Unix socket paths are limited to about 100 characters. A long `CODEWHALE_HOME` or user name can exceed it; Codewhale logs "path must be shorter than SUN_LEN". Use a shorter `CODEWHALE_HOME`. |
| "several Codewhale sessions use this workspace" | Two live sessions share the workspace and the right one could not be identified. Close the others. |
| `/loop-status` says `error` | The reason is printed with it. |
| The loop ends after one reply with `--until` | The phrase was not alone on the final line, or the transcript could not be read. |

## Relation to `/goal`

Codewhale's native `/goal` keeps one objective going inside the agent loop. This
plugin is the other shape: a bounded, supervised sequence of whole turns with a
visible counter, an exact stop phrase and a hard cap. Prefer `/goal` for open
work that the model should judge finished. Use `/loop` when you want a number
you set and a phrase you chose to be the only things that end it.

A plugin command that has a `description` in its front matter sets a native
goal when it runs. The loop's commands deliberately have none, and a test
guards that.

## Verification status

Run from the repository root:

```text
node --test plugins/loop/tests/loop.test.mjs        # 38 engine and hook-protocol tests
LOOP_E2E=1 node --test plugins/loop/tests/e2e.test.mjs   # 7 terminal-UI tests
```

- `loop.test.mjs` runs the engine as the child process Codewhale spawns, feeds
  it the real hook payloads, and talks to a fake control socket that speaks the
  real protocol. It covers the cap, cancel, completion phrase, ordering,
  concurrency, session ownership, planted state files, symlinks and failure
  paths, and expands the shipped command files exactly as Codewhale does.
- `e2e.test.mjs` drives the real Codewhale terminal UI through a pseudo-terminal
  (tmux), in a scratch `CODEWHALE_HOME` and `HOME`, using the real
  install, review, trust and enable flow. The model is a local scripted server
  that records every request, so the tests assert exactly what each iteration was
  asked. It checks: a capped run is `--max` iterations plus one wrap-up and then
  silence; the phrase stops the run only on its own final line; `/cancel-loop`
  and Esc stop it; your own messages pass through and are not counted; without
  `[control_socket]` nothing starts; and editing the installed engine after
  trust is refused. It needs `LOOP_E2E=1`, `tmux` and a `codewhale` binary
  (`CODEWHALE_BIN` to choose one). It was run against Codewhale 0.10.1 on macOS.
- Not exercised: a real model provider (a scripted stand-in was used), Linux,
  and the marketplace install path (installs were from a local directory).

## License

MIT. See [LICENSE](LICENSE).
