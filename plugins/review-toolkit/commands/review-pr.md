---
description: Run six specialist reviewers over your diff, a branch or a PR in parallel and get one ranked report
usage: /review-pr [PR number|PR URL|base..head|branch|paths...] [--only general,silent-failures,type-design,test-gaps,comments,simplifier] [--skip <names>]
arguments: optional scope and reviewer filters
---

Load the `review-toolkit:review-panel` skill and follow it exactly.

Scope and options from the user: $ARGUMENTS

With no scope, review the current uncommitted work, or if there is none, the
current branch against its default branch. This is a read-only review: do not
edit files, stage, commit, push, or post comments anywhere. Report findings
verified against the code, and name any reviewer that did not complete.
