---
name: whalesong-listen
description: Render a recorded agent session to audio with Whalesong's deterministic synthesizer and interpret it — hear a loop, a stall, an error storm, or the difference between two runs. Use when the user wants to feel a session's shape, compare runs by ear, or present a run without scrolling a waterfall.
invocation: model+user
---

# Whalesong: listen to a run

The sonogram's audio path: the same signal pyramid that drives the picture
drives sound. `whalesong_listen` renders a trace (or session file) to stereo
24 kHz WAV, time-compressed into the requested duration.

## The vocabulary — designed, not measured

- **Sustained harmonic voices** — model/reasoning, retrieval, subagent spans.
  A session that is mostly thinking *sounds* sustained.
- **Short envelopes at fixed registers** — tool, file, code, browser, network
  calls. A busy hands-on phase sounds percussive.
- **Beating / dissonance** — error density. A run under failure literally
  sounds rougher.
- **Stereo pan** — fixed per category, so sources separate in space.

Meaning is carried by density, continuity, repetition and transitions. A
pleasant chord is not a success signal, and this is an experimental
diagnostic aid, not a validated monitor.

## Use it well

1. Render the interesting window, not always the whole run — `seconds`
   compresses; very long runs become grainy (the 80 ms score grid gets
   audible at extreme compression).
2. For A/B ("did the fix help?") render both at the **same** `seconds` —
   different speeds change the texture.
3. Play for the user: the tool returns `afplay "<file>"`. Report what the
   render exposes — e.g. "first third is dense tool chatter, then a long
   near-silent stretch, then a rough patch at the end" — and tie each
   audible feature back to findings/rows from `whalesong_analyze`.
4. Renders land in `~/.whalesong/renders/` unless `out` is given. Same
   trace + settings = same samples, so re-rendering is free.

## Pair with rhythm

`whalesong_rhythm` is the quantitative side of listening: if a passage
*sounds* metronomic, the periodogram's dominant period and the
autocorrelation lag say exactly how metronomic, in seconds.
