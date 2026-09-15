---
name: whalesong-annotate
description: Attach review scores to recorded Whalesong traces and build comparison pairs — mark a session good/bad/regressed, then diff two runs deterministically. Use when evaluating agent changes, reviewing a run after the fact, or building a small eval set.
invocation: model+user
---

# Whalesong: annotate and compare

Two jobs: leave durable review marks on traces, and diff runs.

## Scoring

`whalesong_score` writes a Langfuse-style score row onto a trace. Suggested
names stay consistent so later queries aggregate cleanly:

- `review` — categorical: `accepted` / `needs-work` / `failed`
- `rating` — numeric 1–5
- `regression` — boolean: true means this run was worse than its baseline

Always pass `comment` with the one-line reason; a bare score is a label
nobody can act on later. Scores are the only write this plugin performs —
confirm the trace id before writing.

## Comparing runs

`whalesong_compare` takes two trace ids (or file paths) and returns a
deterministic diff: overall similarity, per-channel and temporal similarity,
deltas in duration / tokens / errors / p95 latency / finding counts, and the
timeline points where the two runs diverged most.

Good pairs:

- same task, before/after a prompt or model change,
- a passing run vs. its scored `regression` pair,
- the same workflow across two different agent CLIs.

Similarity near 1.0 means the runs' *shape* matched; it says nothing about
output quality — inspect the differing span names the diff reports.

## Typical flow

1. Triage or list traces → pick the pair.
2. `whalesong_compare` → report the deltas that matter.
3. `whalesong_score` both runs so the verdict is durable.

Keep the write side boring: one score, one comment, correct trace id.
