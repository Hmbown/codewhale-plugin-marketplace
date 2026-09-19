# Whalesong

Find out why an agent run was slow, repetitive or unsuccessful. This plugin
reads sessions recorded by the local Whalesong platform and offers trace
inspection, comparisons, numerical reports and audio renderings.

## First useful task

After installing, reviewing, trusting and enabling the plugin, ask:

> Look at my latest recorded run. Where did it spend time, and which failure
> should I investigate first? Link the evidence.

Start with `whalesong_health`, then `whalesong_list_traces` and
`whalesong_analyze` for a returned trace ID. The
[analysis skill](skills/whalesong-analyze/SKILL.md) explains the workflow.
An empty trace list means no matching recorded session, not that the run passed.

## Requirements and data

- Node and a separately installed, built Whalesong platform are required.
- The platform's local configuration in `~/.whalesong/env` supplies
  `WHALESONG_URL`, `WHALESONG_SECRET_KEY`, `WHALESONG_HOME` and
  `WHALESONG_DATA` as needed. Do not paste their values into chat.
- The default API address is `http://127.0.0.1:4173`. HTTP tools use the
  configured platform endpoint; an operator-configured remote address sends
  those requests there. Review that destination before connecting.
- Analysis imports the installed platform's implementation and reads its trace
  store. The plugin does not bundle or provision that platform, record new agent
  sessions, or call a model provider.
- Most tools read data. `whalesong_score` writes a review score;
  `whalesong_listen` renders a local WAV file. Invoke these when requested.

Use [triage](skills/whalesong-triage/SKILL.md) for recorded problems,
[rhythm](skills/whalesong-rhythm/SKILL.md) for timing patterns,
[listen](skills/whalesong-listen/SKILL.md) for audio, or
[annotate](skills/whalesong-annotate/SKILL.md) for a requested review score.
Findings are heuristics with evidence, not verdicts about an agent's intent.
Missing usage or cost remains unknown.

If health fails, check platform availability and configuration. A successful
plugin install alone does not establish a running platform or live trace data.
