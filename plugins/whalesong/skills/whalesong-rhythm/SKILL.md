---
name: whalesong-rhythm
description: Quantify periodicity in a recorded agent session — dominant onset period in seconds, spectral entropy, autocorrelation lag. Use to prove a poll loop, measure how metronomic retries are, compare cadence between runs, or window into one suspicious stretch.
invocation: model+user
---

# Whalesong: rhythm forensics

`whalesong_rhythm` bins a trace's onset train into 1,024 samples and runs
the instrument's real DSP: centered variance-normalized autocorrelation and
a Hann-windowed one-sided periodogram. Frequencies here are cycles/second
of the *event train* — not audio pitch, not the sonogram's semantic rows.

## Reading the output

- `dominantPeriodSeconds` — the strongest repetition interval. ~4s means
  something fired every four seconds; match it against loop findings.
- `spectralEntropy` 0–1 — low = one dominant rhythm (metronomic), high =
  arrhythmic activity. Use it to separate "stuck on a timer" from "busy".
- `strongestAutocorrLagSeconds` + `autocorrAtBestLag` — self-similarity at
  its best offset; a high value confirms periodic structure the spectrum
  might split into harmonics.
- Sparse onset trains produce harmonics — the dominant peak may be a
  multiple of the true period. Cross-check with the autocorr lag.

## Windows and categories

Default is the whole trace. Narrow with `start_ms`/`end_ms` (finding
`atMs` values are relative to trace start — feed them straight in) or one
`category` (e.g. `tool` for just the call cadence, `reasoning` for model
cadence). A stalled session's gap boundaries make good window edges.

## Workflow

1. `whalesong_analyze` or the sonogram flags a repeating pattern.
2. `whalesong_rhythm` on the flagged window → period + confidence.
3. `whalesong_observations` on that window, `full: true` → what the
   metronome was actually calling.
4. State it plainly: "retried `bash <cmd>` every ~8.5s for 40 min",
   not "exhibited anomalous periodicity".

Cadence is a property of the record — it still doesn't prove intent.
