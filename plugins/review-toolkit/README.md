# Review Toolkit

Six read-only specialist reviewers and one command that runs them together over
your diff, a branch or a pull request, then merges their findings into a single
ranked report.

| Reviewer | Looks for | Profile id |
| --- | --- | --- |
| General | Correctness, regressions, data integrity, trust boundaries, concurrency | `review-general` |
| Silent failures | Swallowed errors, misleading fallbacks, false success | `review-silent-failures` |
| Type design | Invalid states a type allows, unenforced invariants, leaky encapsulation | `review-type-design` |
| Test gaps | Changed behavior that no test would catch, weakened or skipped tests | `review-test-gaps` |
| Comment accuracy | Comments, docs and help text the change made false | `review-comments` |
| Simplifier | Behavior-preserving ways to remove code the diff added | `review-simplifier` |

**Start here:** install, review, trust and enable the plugin, then in a
repository with uncommitted changes or a feature branch run:

```text
/review-pr
```

Other scopes:

```text
/review-pr 123                      # a pull request (needs an authenticated gh)
/review-pr main..HEAD               # a ref range
/review-pr src/api/ src/db/         # only these paths
/review-pr --only general,test-gaps # choose reviewers
/review-pr --skip simplifier
```

A good result is one report with a verdict, findings grouped Blocking, Should
fix and Consider, each anchored to `path:line` in the new code, and a list of
what every reviewer checked and found sound. Findings the chair could not
verify are listed separately as Unconfirmed. A reviewer that did not finish is
named, never silently dropped.

## Install

```text
/plugin install /absolute/path/codewhale-plugin-marketplace/plugins/review-toolkit
/plugin show review-toolkit
/plugin trust review-toolkit <content-hash>.<capability-hash>
/plugin enable review-toolkit
```

Use the exact `trust` line that `/plugin show` prints. Confirm the reviewers
joined the roster with `/subagents roster` (look for the `review-*` profiles)
and the skill with `/skills` (`review-toolkit:review-panel`).

## What it can and cannot do

- Every reviewer profile has role `reviewer` with the read-only tools posture.
  Reviewers read the diff and the repository; they do not edit files, stage,
  commit, push or comment on a PR or issue. Whether a reviewer may run a shell
  command is decided by Codewhale's reviewer policy and your session, not by
  this plugin.
- The plugin declares no MCP server, network host or credential. PR scopes use
  your own `gh` login if you have one; without it, pass a ref range.
- Each reviewer is a separate model run, so a full panel costs several
  inferences on your selected provider. Reviewers inherit your session model;
  nothing here pins a vendor or model. Use `--only` to spend less.
- This is a model review of a diff. It is not a test run, CI, a security audit
  or human approval. Reviewer output is checked against the cited lines by the
  chair, but a clean report still means only "nothing found by this panel".
- Profile ids are global to the agent roster. Your own personal or workspace
  profile with the same id takes precedence over this plugin's.

## Using a reviewer alone

Any reviewer can be started directly through the `agent` tool with its profile
id, for example `profile: "review-silent-failures"` and a prompt naming the
diff. `/review-pr` is the supported way to combine them.

## Origin

All reviewer prompts and the panel protocol were written for this plugin and
are MIT licensed. The lineup is the familiar specialist split (failure
handling, type design, tests, comments, simplification, general review); the
prompts are original.
