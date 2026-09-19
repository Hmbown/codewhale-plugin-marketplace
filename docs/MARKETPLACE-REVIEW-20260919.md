# Marketplace and WhaleWiki review — September 19, 2026

The marketplace needs to answer three questions: which extension helps with my
task, what must already be connected or installed, and how can I verify the
result? A large catalog alone does not answer them.

## References inspected

| Reference | Exact source reviewed | Applied here |
| --- | --- | --- |
| [MiniMax Code Plugins](https://github.com/MiniMax-AI/MiniMax-Code-Plugins/tree/1385340eed78016f7a467f44d1d6dc0029c24b04) | README, plugin compatibility contract, validation tooling | First useful task, visible requirements/data destinations, README and license inside every bundle, checks against installable contents |
| [Claude Code official plugins](https://github.com/anthropics/claude-plugins-official/tree/c447c3207a425bc4e2a0d068435f64b0477ae981) | README, example plugin, marketplace metadata | Stable plugin IDs, readable display names, explicit skill selection, namespaced capabilities |
| [Agent Skills specification](https://agentskills.io/specification) | Naming, descriptions, progressive disclosure and resources | Validate names against directories; mirror supporting resources; keep task routing concise |
| [DeepWiki](https://docs.devin.ai/work-with-devin/deepwiki) | Repository wiki workflow | Lead with understanding and navigating code; keep WhaleWiki's existing local model and source receipts |

Reference checkouts live outside product repositories under
`refs/minimax-code-plugins` and `refs/claude-plugins-official`. They are research
inputs, not installed plugins. Their presence does not imply compatibility or
permission to execute their tools. No implementation was copied from them.

Codewhale keeps its native marketplace and reviewed installer. Claude's
`strict: false` schema and MiniMax's runtime-specific layouts are not pasted into
Codewhale metadata. Catalog identity remains stable. Trust, enablement and
session reload remain separate.

## Findings and changes

- The old mirror had 37 directories and missed 14 Core asset directories.
  Core's actual generation-13 catalog has **47 active skills**. `feedback` and
  `contributor-onboarding` are repository-local, Feishu is optional, and
  `v4-best-practices` is retired. Copying all 51 asset directories would have
  misrepresented the bundle and reintroduced retired workflows.
- The synchronized pack uses Core's active catalog, pins the reviewed commit,
  hashes every current skill/resource and generates a task directory. Default
  validation detects added, missing or altered files without a sibling Core
  checkout. `--core` additionally detects upstream catalog/resource drift.
- Six canonical skills were corrected, then retained old bodies were added to
  Core's existing non-destructive upgrade mechanism. Generation 14 upgrades
  exact shipped copies while preserving user modifications and deleted skills.
- Google's [gcloud OAuth documentation](https://docs.cloud.google.com/sdk/gcloud/reference/auth/application-default/login)
  requires a user-owned OAuth client for Workspace scopes. Gmail and Calendar
  guidance now prefers existing connectors and asks only for task-specific
  scopes; replacing ADC is made explicit. Scope choices follow the official
  [Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes) and
  [Calendar](https://developers.google.com/workspace/calendar/api/auth) references.
- [OSXPhotos](https://rhettbull.github.io/osxphotos/cli) exports selected UUIDs;
  the invented `--query` export flag was removed. Capture and library-add dates
  are distinguished. Spotify guidance handles explicit play/pause and no longer
  promises the [restricted Recommendations API](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api).
- Core's `remember` tool supports append/revise candidates only. The forgetting
  skill now directs users to Context Lens without inventing a deletion proposal.
  Plugin authoring guidance uses the existing marketplace and live-session
  reload instead of obsolete v0.9.1 limitations.
- WhaleWiki now answers direct documentation-impact questions from its existing
  source manifest. Search ranks distinct query coverage before repetition and
  returns freshness and source paths. The offline reader supports multiword
  search, Enter-to-open and a source-evidence disclosure on each sealed page.
- All five bundles are included in packaging CI. Whalesong and Cloudflare Docs
  now have an in-package first-task guide and the declared license text; the
  skill bundle carries Core's existing license notice.

## Practical acceptance scenarios

1. Browse/search the skill directory and locate email, calendar, GitHub, photo,
   travel and audio workflows. The directory states prerequisites separately
   from installation.
2. Package the skill bundle; compare every resource digest with the source pin.
   Retired default workflows must not appear in the installed skill roots.
3. Scaffold a scratch wiki, write and seal a page, then ask the packaged MCP
   server which pages cite its source from a different working directory.
4. Change/delete that source and see stale/orphaned verdicts. An unreferenced
   file must be called uncovered, not unaffected.
5. Search a two-word topic whose words occur in different paragraphs, open it
   with Enter, inspect source evidence, follow an internal heading link, and
   use the review filter on desktop and mobile. Unsafe page HTML stays text.
6. Upgrade a generation-13 skill install: unchanged bodies refresh, edited
   bodies survive and intentionally deleted skills stay deleted.

## Evidence boundaries

Local package, protocol, browser and upgrade checks are recorded below after
execution. They do not prove live Gmail/Calendar/Plaid authorization, a Photos
library export, a Spotify account operation, remote MCP availability, accurate
model-written prose, semantic skill routing or hosted CI. No service login,
provider call, paid action, customer contact, deployment or release is part of
this review. The Core catalog pin reaches installed users only after an
appropriately qualified rebuild/release.

## Separate integration gap

`npm run check:cu-sync` confirmed that this marketplace's Computer Use bundle
matches its canonical source at `9a261c4b47a7`. It also found 16 runtime-file
and 18 test/fixture differences in Core's separately embedded Computer Use copy.
Those copies are owned by another lane; no files were overwritten here. The
marketplace bundle and Core's embedded runtime must not be described as equal
until their owner synchronizes and qualifies them. The active rebuild task was
notified with the exact paths. This does not change which bytes this marketplace
packages or its own bundle checks.

## Executed local checks

- `npm test && npm run check:web`: 522 Node tests passed, zero failed,
  17 platform-specific skips; four desktop/mobile browser checks passed.
- `npm run check -- --core ../codewhale`: all five bundles and all 47 active
  skills validated against Core source commit `44ec195dc52ff2b01c9b51d7ed195d999942796d`,
  generation 14. `npm run check:wiki`: three fresh pages, no stale, orphaned or
  unsealed pages. `git diff --check` passed.
- All five bundles packaged locally: Computer Use 2,217,796 bytes; Whalesong
  42,093; WhaleWiki 95,111; Cloudflare Docs 4,091; skills 88,653. Each is below
  the installer limit. The packaged MCP impact lookup also passed from an
  unrelated working directory against a scratch repository.
- Core skill tests: 222 of 223 passed initially; the sole failure was an old
  generation-13 assertion. After updating it for generation 14, the focused
  recheck passed (one passed, zero failed). The new upgrade preservation
  regression passed in the original run. Core's required Node/web gate also
  passed, including 471 web checks and 14 runtime-SDK checks.
- A separate scratch upstream verified sync of a supporting reference file,
  upstream-drift detection and refusal to overwrite dirty source. A negative
  search control selected a repeated single-word page under the old engine;
  the new engine selected the page covering both requested terms.
- An offline reader was exported and the desktop/mobile browser screenshots
  inspected. This is local source qualification; hosted CI and installed
  native-client acceptance remain separate evidence.

### Hosted follow-up

The first pushed revision `bda1cac` passed the full Linux and macOS jobs in
[run 35442130719](https://github.com/Hmbown/codewhale-plugin-marketplace/actions/runs/35442130719).
Windows caught an ESM import portability error in the new search regression
(32 passed, one failed, six skipped in the WhaleWiki sub-suite). The test now
uses a file URL; the local WhaleWiki recheck passed all 39 tests. This correction
changes no packaged production bytes. Fresh hosted qualification follows the
test-fix commit; the original Windows failure is retained as evidence.

The public immutable archive at `bda1cac` was downloaded successfully and all
five plugin identities and 47 skill-resource hashes verified. The source pin's
Core commit publication is coordinated with the shared build owner.
