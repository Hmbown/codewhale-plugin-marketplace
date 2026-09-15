---
name: whalesong-analyze
description: Analyze one recorded agent session from the local Whalesong platform — or a raw session file — for loops, retries, bursts, gaps, context pressure, divergence and spawns. Use when the user asks what a session did, why it stalled, looped, errored, or burned tokens.
invocation: model+user
---

# Whalesong: analyze one session

The Whalesong platform at `127.0.0.1:4173` holds durable traces of local agent
sessions (codewhale, claude code, codex, kimi, grok, devin, muse, amp). This
skill inspects one of them end to end.

## Pick the trace

- If the user names a session or time, call `whalesong_list_traces` (filter
  `name` or `since_hours`, or `source` for one tool). Trace ids are prefixed
  with their source, e.g. `claude:…`, `codex:…`, `cw:…`.
- If the user gives a file (Whalesong JSONL, OTLP JSON, Codewhale session JSON,
  Codewhale runtime JSONL), skip listing — `whalesong_analyze` accepts `path`.

## Analyze

1. `whalesong_get_trace` — the rollup gives observation counts by type and
   category, models, tokens, errors, top tools, and wall-clock span. This is
   the cheapest orientation.
2. `whalesong_analyze` — the same deterministic core the instrument uses.
   Returns stats, a fingerprint, and findings. Each finding has `kind`,
   `severity`, `title`, `detail`, `atMs` and `events` (ids you can re-open).
3. For the findings that matter, pull evidence with `whalesong_observations`
   (`level: ERROR`, `type: GENERATION`, or a name filter) and quote names and
   timings — not guesswork.
4. `instrumentUrl` in the trace response deep-links the waterfall into the
   Whalesong instrument for the user.

## Reading findings honestly

- Findings are computed heuristics over the record. `loop` means the same
  call repeated; it does not prove the agent was stuck. `context` means
  observed tokens approached the known limit — not that quality degraded.
- An absent span is missing observation, not inactivity. Trailing
  `observedGapRatio` high plus few events usually means the collector only
  saw part of the session.
- Token and cost fields are null when unrecorded. Never estimate them.
- Severity `info`/`warn`/`error` ranks the finding against typical traces,
  not the session's correctness.
- Timestamps in analysis output (`atMs`) are relative to trace start.

## Report shape

Lead with the session's shape (duration, events, models, errors), then
findings ordered by severity with the evidence rows that support each, then
a short "what I'd check next" — grounded, no verdicts about intent.
