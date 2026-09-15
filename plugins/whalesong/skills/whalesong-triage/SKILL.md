---
name: whalesong-triage
description: Sweep recent sessions across every agent CLI recorded in Whalesong and surface the ones worth a look — errors, runaway loops, token blowouts, stalled gaps. Use for "what have my agents been doing", morning reviews, or finding the session that went wrong.
invocation: model+user
---

# Whalesong: triage recent sessions

A cross-tool sweep over the durable store. Default window is the last 24h
(`since_hours`), unless the user names a period.

## Sweep

1. `whalesong_health` — confirm the platform is up and note per-project
   counts so the sweep is bounded.
2. `whalesong_list_traces` with `since_hours` — one row per session:
   source, name, timestamp, observation count, latency, cost.
3. `whalesong_find` with `level: ERROR` and the same window — every errored
   observation across all tools, with its `traceId`. Group by trace.
4. `whalesong_daily` — the per-day token/trace totals put any outlier in
   context.

## Rank, don't exhaust

Most sessions are routine. Rank candidates for deeper inspection by:

- error density (errored observations / total),
- retries and loops (`whalesong_analyze` on the top suspects),
- token volume vs. that source's baseline in `whalesong_daily`,
- long spans with few events (stalled or only partially recorded).

Run `whalesong_analyze` on the top 2–3, not all of them — findings on
hundreds of sessions is noise, not triage.

## Report

A compact table: source | session | when | events | errors | notable finding.
Then a short paragraph on the worst offender with evidence rows
(`whalesong_observations`), and whether the rest of the window looked normal.

## Boundaries

- `source` values: `claude`, `codex`, `kimi`, `grok`, `devin`, `muse`, `amp`,
  `codewhale`. A source absent from the listing simply had no recorded
  activity in the window — say that rather than implying it didn't run.
- Session data is local and private; never post trace contents anywhere.
- Coverage gaps (a tool whose store isn't wired into the collector) are a
  platform gap, not a finding — mention it in one line, don't dwell.
