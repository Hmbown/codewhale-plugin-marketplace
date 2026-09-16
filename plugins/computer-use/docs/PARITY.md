# Parity suite

A reproducible behavioral suite that exercises the real MCP server against
disposable fixtures. Each task is a deterministic script of tool calls plus an
oracle check declared before execution, repeated `repeats` times from a fresh
fixture.

The engine (`scripts/parity-run.mjs`) is platform-neutral: it owns the task
DSL, the oracle and the step executor. Everything that knows about a specific
desktop — how fixtures launch, where their client origin is, how the oracle is
read, how host interference is measured — lives in a driver:

| platform | driver | fixtures | suite | oracle |
|---|---|---|---|---|
| Linux (X11/Xvfb) | `scripts/lib/desktop-x11.mjs` | Chrome `--app` page + Tk app (`parity/fixtures/native.py`) | `parity/tasks.json` | window title JSON via `xdotool`; state file |
| macOS (Aqua) | `scripts/lib/desktop-darwin.mjs` | Chrome `--app` page + a purpose-built AppKit app (`parity/fixtures/native-macos.m`) | `parity/tasks.darwin.json` | loopback beacon from the page; state file |
| Windows (console session) | `scripts/lib/desktop-win32.mjs` | Chrome `--app` page + Tk app (`parity/fixtures/native.py`) | `parity/tasks.win32.json` | loopback beacon from the page; state file |

The suite is chosen by platform automatically (`parity/tasks.<platform>.json`
when it exists, else `parity/tasks.json`); `--tasks <file>` overrides it.

The macOS driver differs in these ways:

- **No isolated route.** One login session owns the WindowServer, so there is
  only the shared desktop; interference is measured, not engineered away.
- **Input is bound to a process**, so every task with a fixture runs a prelude
  calling `open_application(pid, activate:false)`. Prelude tool calls are
  counted separately (`preludeCalls`) so the per-task counts stay comparable.
  A dialog task may explicitly activate its own fixture; foreground keyboard
  delivery then stops if another application takes focus.
- **Fixtures report their own content origin** (the page's `window.screenX`,
  the AppKit fixture's content rect) rather than the runner measuring windows
  from outside. That is exact, needs no extra TCC grant, and keeps the geometry
  independent of the accessibility backend under test.
- **Tk is not used as the macOS native fixture.** Tk/Aqua consumes no CGEvent
  posted to its process, so it could not distinguish a product failure from a
  toolkit that ignores the input; see `docs/LIMITATIONS.md`.

A task the platform genuinely cannot express carries `skip` with the reason and
is reported as skipped in the matrix — never dropped from it.

## Running

```sh
npm run parity                 # all tasks, shared desktop (DISPLAY=:0)
npm run parity -- --isolated   # Xvfb :99 1600x1200x24; fixtures+server on the
                               # isolated display while interference on the
                               # host display :0 is still measured
npm run parity -- --task 'browser.*' --repeats 2 --out /tmp/my-run
```

- `--task <id|glob>` may be repeated.
- `--repeats N` overrides `tasks.json` (default 5).
- `--out <dir>` defaults to `receipts/parity/<platform>-<session>-<ISO>/`.
- The exit code is non-zero when any non-optional task fails; `optional_a11y`
  tasks count as `skipped` when the app is not visible to AT-SPI.

The runner spawns a fresh `mcp/server.mjs` per task. On Linux it forces the
in-process backend (`CODEWHALE_CU_APP=off`) with an isolated state directory; on
macOS it keeps the real state directory so requests route through the desktop
app, which is the process that holds the OS permissions — a scratch state dir
would silently demote every task to direct mode.

Each repetition records per-step receipts (sanitized: home → `~`, username →
`<user>`, file/path fields → basenames), plus host interference measured
before the fixture launches, after it launches, and after the last step.
`interference` spans the whole repetition; `interference_actions` spans only
the agent's tool calls, which is what the matrix reports. Linux samples the
host with `xdotool`; macOS uses `parity/darwin-probe.m`, a standalone
CoreGraphics/AppKit probe that shares no code with the backend under test.

`run.json` in the run dir records the environment metadata: git commit, dirty
flag, node/os versions, session type, suite file, display geometry,
Chrome/python versions, date, repeats, and the task list.

## Background input by application family

`node scripts/background-input.mjs` answers a narrower question per app family:
with the application bound by `open_application(activate:false)`, can it be
observed, typed into and pressed without coming forward? Each family is a
disposable instance the script launches and kills, and each row ends as
"verified live", "verified failed-closed", or "untested" with the missing
precondition named. Results land in `receipts/background-input-<ISO>/` and the
committed summary is `parity/results/background-input-<platform>-<date>.json`.

## Rendering the matrix

```sh
node scripts/parity-matrix.mjs --run <run-dir> [--run <dir>...] \
  [--summary parity/results/<prior>.json ...] [--codex <file>...] \
  [--model-trials <trial-dir>...] [--out <report-dir>]
```

`--summary` renders a surface recorded on another machine from its committed
summary (`receipts/` is not in the repository), so one document can show every
surface at once. Statuses derive mechanically from `parity/thresholds.json`.

## Model trial eligibility

The matrix also checks the native model comparison's existing `receipts.jsonl`
and per-trial stream/oracle files. This command reads evidence only; it does
not launch models, fixtures, the installed app, or a new benchmark loop:

```sh
node scripts/parity-matrix.mjs --model-trials <trial-dir> --out <report-dir>
```

The output includes raw fixture outcomes, valid successes/failures, excluded
trials, missing coverage, fixed exclusion codes, and artifact hashes. It never
copies prompts, arguments, tool results, oracle content, or parser error text
into the report. The command exits 1 unless all six declared tasks, both
surfaces and both text/vision modes have five valid successes. Eligibility is
a fixture evidence gate; it does not establish full model parity or a package
release. Historical model summaries are not eligible evidence for this gate.

`parity/tasks.model-native.json` freezes the six original model-trial goals
using the same expectation DSL as the scripted suite. For each trial, retain:

- A receipt with `task`, `surface` (`codewhale` or `kimi`), `mode` (`text` or
  `vision`), `trial` (1–5), `timeout` (boolean), `exit_code`, `tool_calls`, and
  the independently collected `oracle`. Preserve errors and nonzero exits.
- Complete `log-<task>-<surface>-<mode>-<trial>.jsonl` stream output, including
  every call, corresponding response and final model response.
- `state-<task>-<surface>-<mode>-<trial>.json`, written by the disposable
  fixture and collected by the evaluator after execution, never by the model.

The gate recomputes the expectation from the fixture file and compares it with
the recorded oracle. A runner's `ok: true` or a model's DONE is insufficient.
Timeouts, failed/unknown process exits, disallowed tools anywhere in the full
trace, missing results, count mismatches, duplicate identities, malformed
evidence and missing/mismatched oracles are excluded. A valid failed fixture
outcome remains a failure. Missing observations cannot satisfy even a negative
expectation. Text trials exclude image calls/results; vision trials require
an image response followed by an allowed action. That order is observable;
whether the model actually reasoned from the image needs separate review.

Legacy files without the mode in their names remain readable for diagnosis.
Their missing mode/exit metadata stays unknown and excludes qualification.
Do not backfill unobserved facts or overwrite earlier attempts to make them
eligible. Use a new output directory for each future run and keep retries.

### Future Kimi runs

The reviewed `parity/agents/codewhale-native.md` and `kimi-native.md` profiles
declare explicit tools on only their named surface and disable subagents.
They use JSON frontmatter, which is a YAML subset. The same lists drive this
gate. Select the matching profile with Kimi's supported `--agent-file` option
for each **new** session. Do not resume an earlier unrestricted session.

Kimi documents tool filtering before dispatch in its
[agent-file contract](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents).
The installed 0.41.0 CLI exposes `--agent-file`; repository tests validate the
profiles and evidence gate without a provider. An actual installed-host denial
test and a new model comparison have not been run by this change.

These profiles are not an OS or filesystem sandbox. Allowed CU tools can
still target other apps or navigate a file dialog; argument-level application
binding, oracle separation from the agent's OS identity, ambient host/plugin
instructions, and third-party server behavior need independent enforcement
and qualification. Kimi's `get_app_state` mode is an argument, so the tool
allowlist alone cannot prohibit image mode. The evidence gate rejects image
use in text trials after execution. Keep oracle files, prior trial logs and
evaluation instructions out of the future agent workspace; a different cwd
alone does not deny filesystem access. New provider runs still require their
own spend authorization.

## Codex baseline (manual)

The full task suite has no matching Codex baseline yet. Separate native-text
and public-browser comparisons cover only their named workflows and do not
populate this matrix. To record a matching suite baseline:

1. Drive the same fixtures manually through Codex (e.g. via the fixture files
   and the same task goals in `parity/tasks.json`), 5 repetitions per task.
2. Write `parity/results/codex-<os>-<date>.json`:

```json
{
  "tasks": {
    "browser.form_submit": { "successes": 4, "repeats": 5, "elapsed_ms": 9000, "tool_calls": 12, "notes": "..." }
  }
}
```

One entry per task id. Then merge it into the matrix:

```sh
npm run parity:matrix -- --run <run-dir> [--run <dir>...] --codex parity/results/codex-<os>-<date>.json
```

## Statuses

Derived mechanically from `parity/thresholds.json` (never hand-edit):

- **demonstrated** — 5/5 successes and the Codex column is absent or ≤ ours.
- **partial** — 1–4 successes, or 5/5 but Codex scored higher.
- **missing** — 0 successes while the tool exists.
- **untested** — no receipts, or every rep skipped.

## Outputs

- `docs/PARITY_MATRIX.md` — one section per run + a fixed "Platforms" table.
- `parity/results/<platform>-<session>-<date>.json` — committable sanitized
  summary (counts/timings/status only, no receipt bodies).
- `receipts/parity/...` — full run.json + per-rep receipts (gitignored).
