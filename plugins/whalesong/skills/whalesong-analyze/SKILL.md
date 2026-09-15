---
name: whalesong-analyze
description: Analyze one recorded agent session the way the Whalesong instrument does — signal shape first, computed findings second, exact evidence rows last. Use when the user asks what a session did, why it stalled, looped, errored, or burned tokens.
invocation: model+user
---

# Whalesong: analyze one session

Whalesong's contract is **see the behavior, then read the record**. Follow that
order — shape, findings, evidence — instead of starting in rows.

## Pick the trace

- `whalesong_list_traces` (filter `source`, `name`, `since_hours`). Ids are
  source-prefixed: `claude:…`, `codex:…`, `cw:…`, `devin:…`, `muse:…`.
- A file path works too: `whalesong_analyze` accepts `path` for Whalesong
  JSONL, OTLP JSON, Codewhale session JSON, or runtime JSONL.

## Shape before findings

1. `whalesong_get_trace` — rollup: counts by type/category, models, tokens,
   errors, top tools, span. Long duration + few events = partially observed,
   not slow.
2. `whalesong_rhythm` — the instrument's actual DSP: dominant onset period,
   spectral entropy, strongest autocorrelation lag. A metronomic session
   (strong lag, low entropy) is a different failure than an arrhythmic storm.
3. `whalesong_analyze` — findings with `kind`, `severity`, `atMs`,
   `detail`, and sampled `events` ids. Every finding is a heuristic with a
   stated threshold, not a verdict.
4. `whalesong_observations` with `full: true` on the finding's event ids —
   `statusMessage`/`input`/`output` say *why* a call failed or what a loop
   was running. Shape without payload is half the answer.

## If the shape is the story

- `whalesong_listen` renders the run to WAV — sustained harmonics are
  model/reasoning/subagent work, short envelopes are tool/file/network at
  fixed registers, beating is error density. Offer the path; let the human
  hear the session rather than read about it.
- `whalesong_report` produces the privacy-safe numerical report (no names,
  payloads, ids or absolute timestamps) when the analysis needs to be shared.

## Honesty rules — the instrument's own

- Repetition is evidence, not proof of a stuck agent; identical calls can
  still progress. Gaps are *unobserved* time: waiting, uninstrumented work,
  dropped data, or stall — the record cannot say which.
- Token/cost fields stay null when unrecorded. Never estimate them.
- `observedGapRatio` near 1 means the collector saw fragments — read
  coverage before behavior.

## Report

Shape line (duration, events, models, errors, dominant period if notable),
then findings by severity each backed by quoted evidence rows, then one
"check next" — `instrumentUrl` deep-links the waterfall for the human.
