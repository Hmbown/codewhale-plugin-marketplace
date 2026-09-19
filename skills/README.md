# Codewhale skills

47 active skills from Core generation 14. Each installs as
`codewhale-skills:<name>`. Skills provide instructions; they do not connect
accounts, install dependencies, grant permissions, or prove live service access.

Try “summarize my unread email”, “compare flights for this date”, “make an audio
briefing”, or “review this pull request”. Use `npm run skills -- <words>` to
search this directory, or `npm run skills -- --json` for the full inventory.

## What needs setup?

| Workflow | Requirement |
| --- | --- |
| Gmail / Calendar | Connected account, or user-owned Google OAuth client with task-specific scopes |
| GitHub | Authenticated `gh` or a host-provided GitHub connection |
| Flights / shopping / image search | Web access; FlightAware is an optional keyed route |
| Bank balances | User-authorized Plaid connection; read-only workflow, no payments |
| Photos | macOS, local Photos library and `osxphotos` |
| Spotify | Running Mac app for local playback; authorized API access for search |
| Speech / podcast | Local speech engine; podcast assembly also needs `ffmpeg` |
| Forget | Codewhale Context Lens; unavailable on hosts without that control |
| Documents / browser testing | The tools and dependencies stated by each skill |

## Build and maintain software

| Skill | When it helps |
| --- | --- |
| [plan](plan/SKILL.md) | Turn a sufficiently understood task into an ordered implementation plan with dependencies and verification. Orchestrate Codewhale’s native plan state; do not build a parallel planner. |
| [implement](implement/SKILL.md) | Carry an authorized, defined request or approved plan through scoped edits and proportionate verification. Skill loading is not write authorization by itself. |
| [debug](debug/SKILL.md) | Reproduce, minimize, localize, identify root cause, and distinguish diagnosis from an authorized fix. Prefer root-cause over symptom patches. |
| [test](test/SKILL.md) | Detect the project’s test stack, run the narrowest useful tests, create tests when authorized, and report coverage/gaps honestly. |
| [review](review/SKILL.md) | Diff-scoped correctness review that reads the codebase around the change — callers, contracts, and invariants — and returns line-anchored findings ranked by severity with confidence, then a merge-risk verdict. Use for reviewing a PR, diff, or named change set. Not for style review, approvals-as-rubber-stamp, or editing the code. |
| [security-review](security-review/SKILL.md) | Review a change, module, or surface for exploitable defects — trust boundaries, authn/authz, injection, secret exposure, filesystem and network reach, dependency risk. Use when the user asks for a security review, audit, or vulnerability check of concrete code. Not for general code review, lint, or compliance paperwork. |
| [simplify](simplify/SKILL.md) | Improve clarity and reduce needless complexity after behavior is understood; preserve behavior and keep cleanup separate from correctness fixes. |
| [verify](verify/SKILL.md) | Exercise the real app/API/CLI and collect observable evidence; tests alone do not count as end-to-end verification. |
| [batch](batch/SKILL.md) (explicit only) | Break a large, parallelizable goal into bounded work units, coordinate existing agent/worktree machinery, integrate, and verify. Explicit-only. |
| [dependency-update](dependency-update/SKILL.md) (explicit only) | Read release notes/changelogs, update a defined dependency scope, handle breaking changes, and verify. Explicit-only; no broad update-everything by inference. |
| [release](release/SKILL.md) (explicit only) | Prepare a named version: preflight, version consistency, build/package, smoke test, checksums/notes, and release readiness. Publishing/tagging/deploy need separate authorization. Explicit-only. |
| [github](github/SKILL.md) | GitHub via gh — issues, PRs, reviews, search, and CI runs. Use when: user mentions a repo, issue, PR, review, release, workflow run, or anything on github.com. |
| [handoff](handoff/SKILL.md) | Write a compact, decision-ready handoff so the next session (or the user) can continue without reconstructing the current one. Use when the session is ending, context is running low, the user asks for a handoff / 'pass the baton' / 'hand off', or a long-running operation needs a durable state checkpoint. |
| [best-of-n](best-of-n/SKILL.md) | Generate a small set of independent candidate solutions in worktrees, judge them against one explicit rubric, and apply the winner only after PASS verification. |
| [interview](interview/SKILL.md) | Ask one useful structured question at a time only when material product/implementation choices are genuinely missing; remember answers and produce a brief/spec. Discoverable facts should be investigated instead of asked. |

## Research and make things

| Skill | When it helps |
| --- | --- |
| [research](research/SKILL.md) | Current external research using available web tools, primary sources where possible, links/citations, date awareness, synthesis, and unresolved uncertainty. |
| [frontend-design](frontend-design/SKILL.md) | Produce intentional, responsive, accessible UI work and perform visual QA instead of generic component assembly. |
| [webapp-testing](webapp-testing/SKILL.md) | Start/reuse a local app, wait for readiness, inspect rendered state/console/network, act from observed selectors, and verify with evidence. |
| [document](document/SKILL.md) | Write or update repository/product documentation: README, user guides, API docs, architecture, migration notes, and changelog material. This is not the Word-document artifact skill. |
| [dataviz](dataviz/SKILL.md) | Choose and produce an appropriate chart/dashboard/visual explanation from data, with legible encodings and source/assumption notes. |
| [docx](docx/SKILL.md) | Create/edit/inspect Word documents using available managed or host capabilities. |
| [pdf](pdf/SKILL.md) | Read, extract, split, merge, rotate, watermark, fill, OCR, or create PDF files with verification of page counts and text extraction. |
| [pptx](pptx/SKILL.md) | Create/edit/inspect/verify slide decks and PPTX presentations. |
| [xlsx](xlsx/SKILL.md) | Create/edit/analyze/verify spreadsheet workbooks including XLSX/CSV/TSV. |
| [documents](documents/SKILL.md) | Compatibility alias for the docx skill. Prefer loading docx. |
| [presentations](presentations/SKILL.md) | Compatibility alias for the pptx skill. Prefer loading pptx. |
| [spreadsheets](spreadsheets/SKILL.md) | Compatibility alias for the xlsx skill. Prefer loading xlsx. |
| [image-search](image-search/SKILL.md) | Find images on the web and save them locally. Use when: find an image, image search, stock photo, picture of, download an image, or need a visual. |

## Everyday tasks

| Skill | When it helps |
| --- | --- |
| [gmail](gmail/SKILL.md) | Search, read, draft, and send Gmail when the user asks to work with their inbox or email. |
| [google-calendar](google-calendar/SKILL.md) | Read schedules, check availability, and create or update Google Calendar events when the user asks to work with their calendar. |
| [flights](flights/SKILL.md) | Track flights and look up status and schedules. Use when: flight status, track a flight, flightaware, arrivals, departures, delays, or a flight number. |
| [shopping](shopping/SKILL.md) | Product research — compare options, prices, and reviews. Use when: buy, shopping, product recommendation, compare prices, best X to buy, or is this a good deal. |
| [money](money/SKILL.md) | Bank accounts, balances, and transactions via Plaid. Use when: bank, balance, transactions, spending, accounts, or plaid. |
| [photos](photos/SKILL.md) | Search a local macOS Photos library and export selected copies when the user asks to find or use their own photos. |
| [spotify](spotify/SKILL.md) | Control Spotify playback and search the library and playlists. Use when: spotify, music, playlist, play, pause, or what's playing. |
| [tts](tts/SKILL.md) | Speak or render text to speech locally. Use when: read aloud, speak, voice output, tts, text to speech, or an audio version of text. |
| [podcast](podcast/SKILL.md) | Turn research into a spoken podcast — script, synthesize, stitch. Use when: podcast, generate a podcast, audio briefing, narrate, or turn this into audio. |
| [goals](goals/SKILL.md) | Set, review, and update the user's goals. Use when: goals, resolutions, track progress, what am I working toward, or holding me accountable. |
| [forget](forget/SKILL.md) | Help the user remove a stored fact using Codewhale's Context Lens when they ask to forget or delete a memory. |

## Extend your agent

| Skill | When it helps |
| --- | --- |
| [help](help/SKILL.md) (explicit only) | Route a "how do I use Codewhale" question to the installed help, config, and doctor surfaces instead of reciting a manual from memory. Explicit-only. |
| [skill-creator](skill-creator/SKILL.md) | Create or improve codewhale skills. Use when the user wants a new skill, wants to update an existing skill, or needs guidance on when a skill should be a skill versus MCP, hooks, tools, or a plugin scaffold. |
| [skill-installer](skill-installer/SKILL.md) | Install, update, trust, or inspect Codewhale skills from GitHub or local skill folders. Use when the user asks for available skills or wants a community skill installed. |
| [plugin-creator](plugin-creator/SKILL.md) | Scaffold a local Codewhale plugin bundle with a versioned manifest, namespaced Skills, and an explicit trust review. |
| [mcp-builder](mcp-builder/SKILL.md) | Design, build, configure, or debug Model Context Protocol servers for codewhale, including stdio and HTTP/SSE transports. |
| [mcp-discovery](mcp-discovery/SKILL.md) | Find and start a zero-environment local MCP server when the session lacks a capability that no available tool, project script, or ordinary local code can cover. |
| [delegate](delegate/SKILL.md) | Strategic delegation for multi-step coding, research, or verification work. Use when a task can be split into parent reasoning plus focused sub-agent execution through the agent tool. |
| [fleet-manager](fleet-manager/SKILL.md) | Use when managing, triaging, restarting, escalating, or summarizing Codewhale fleet runs and workers. |

## Source and maintenance

Generated from [Core](https://github.com/Hmbown/Codewhale/tree/44ec195dc52ff2b01c9b51d7ed195d999942796d/crates/tui/assets/skills) by `scripts/skills.mjs`. `upstream.json` pins the exact revision and hashes
of every mirrored file. `npm run check` validates the inventory and this directory;
`npm run check -- --core ../codewhale` also compares the active Core catalog.

`feedback` and `contributor-onboarding` are repository-local; `feishu` is optional
and `v4-best-practices` is retired. Retained migration bodies are deliberately
excluded, so installing this pack does not resurrect retired workflows.
