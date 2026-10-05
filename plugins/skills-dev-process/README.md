# Dev process skills

Workflows for the stages of changing software: plan, implement, debug, test,
review, simplify, verify and hand off. They reinforce evidence over assertion
(reproduce before fixing, run the narrowest useful test, exercise the real app).

After installing, reviewing, trusting and enabling the plugin, ask:

> Review my uncommitted diff for correctness bugs and rank the findings.

| Skill | What it does |
| --- | --- |
| `interview` | Ask one structured question at a time, only when a material choice is missing |
| `plan` | Turn an understood task into an ordered plan with dependencies and verification |
| `implement` | Carry an authorized request or approved plan through scoped edits |
| `debug` | Reproduce, minimize, localize and find the root cause before fixing |
| `test` | Detect the test stack, run the narrowest useful tests, report gaps honestly |
| `review` | Diff-scoped correctness review with ranked, line-anchored findings and a merge-risk verdict |
| `security-review` | Review a change or surface for exploitable defects |
| `simplify` | Reduce needless complexity while preserving behavior |
| `verify` | Exercise the real app, API or CLI and collect observable evidence |
| `handoff` | Write a compact, decision-ready handoff for the next session |

## Prerequisites

None to install. Skills use whatever repository, shell and test tools the
session already has. Loading a skill is not write authorization; `implement`
says so explicitly.

## Not included

`batch`, `best-of-n`, `dependency-update` and `release` depend on host agent
and worktree machinery or on separate publishing authority, and `github`,
`webapp-testing`, `research` and `frontend-design` are tool-specific. They remain
in `codewhale-skills`.

## Did it work?

A review should list findings with file and line; a debug session should show
the reproduction; a verify run should show the command that was exercised and its
output. Claims without that evidence mean the skill was not followed.

## Relationship to `codewhale-skills`

These skills are byte-for-byte copies of the same-named files in the
repository's [`skills/`](https://github.com/Hmbown/codewhale-plugin-marketplace/tree/main/skills) mirror (MIT, see `LICENSE`);
`provenance.json` records the source revision and a SHA-256 for each file.
They load as `skills-dev-process:<skill>`. The monolithic `codewhale-skills` pack stays
available and still contains all of them under `codewhale-skills:<skill>`;
install either this plugin or the monolith for a given skill, not both, or the
same workflow appears twice. Codewhale's own bundled skills of the same name
are separate again.

Skills provide instructions only. Installing this plugin does not connect an
account, install a dependency, grant a permission or send data anywhere. It
declares no MCP servers, hooks, commands or network hosts.
