# Matching Devin Review with Codewhale

What Devin Review actually does on a PR, and which part Codewhale can
match today versus which part is product work.

## What Devin Review does

| Capability | How Devin does it | Codewhale equivalent |
| --- | --- | --- |
| Fires on every PR | GitHub App, webhook subscription | GitHub Actions or a webhook → app-server bridge (recipe below) |
| Reviews with codebase context | DeepWiki index of the whole repo | `whalewiki` plugin — the review skill reads fresh wiki pages + callers |
| Line-anchored inline comments | GitHub review API with position | `gh api …/pulls/N/reviews` with per-line comments |
| Findings ranked + confidence-gated | tuned reviewer prompt | `review` skill: severity order, reachability gate, "considered" list |
| Security-adjacent catches | same reviewer pass | `security-review` skill discipline inside the review |
| Auto-fix follow-up | Devin session on findings | follow-up `codewhale exec` session or a fleet agent |
| Hosted, always-on, per-org install | Devin's SaaS | **product work** — needs a Codewhale GitHub App + hosted runner |

## The gap, honestly

Two of these are real product work, not recipes:

1. **A Codewhale GitHub App.** Devin Review exists because a user installs
   an app once and every PR gets reviewed. The recipe below needs a token
   and a workflow file per repo — friction Devin doesn't have.
2. **A hosted session runner with durable state.** App-server + a
   scheduler/fleet host that survives restarts. Until then the recipe runs
   in GitHub Actions minutes instead.

Everything else — context-aware findings, line comments, confidence
gating — is a *prompting* problem the `review` skill already encodes.

## Recipe: PR review in GitHub Actions

```yaml
# .github/workflows/codewhale-review.yml
name: codewhale-review
on:
  pull_request: [opened, synchronize, ready_for_review]
permissions:
  pull-requests: write
  contents: read
concurrency:
  group: cw-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
      # install codewhale CLI (release tarball or cargo install, pinned)
      - run: |
          codewhale exec --auto --output-format stream-json \
            "Load the review skill. Review this pull request: base \
             ${{ github.event.pull_request.base.sha }}, head \
             ${{ github.event.pull_request.head.sha }}. The repo is \
             checked out at HEAD — run git diff \
             ${{ github.event.pull_request.base.sha }}...HEAD and emit \
             findings in the skill's output format." \
            | tail -1 | jq -r '.message // .' > review.md
        env:
          CODEWHALE_API_KEY: ${{ secrets.CODEWHALE_API_KEY }}
      - name: Post findings as a PR review
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh api repos/$GITHUB_REPOSITORY/pulls/${{ github.event.pull_request.number }}/reviews \
            -f event=COMMENT -F body=@review.md
```

Notes:

- `fetch-depth: 0` is required — the review reads callers, not just the
  patch hunks.
- For true inline comments, post each finding through
  `pulls/N/comments` with `path`, `line`, `side` parsed from the skill's
  `file:line` anchors.
- If the repo carries a `whalewiki/`, the review gets codebase context
  for free — this is the closest analog to Devin's index.
- Keep the bot read-only: it comments, it never approves or merges.

## Recipe: webhook → app-server bridge

For orgs that want one Codewhale host reviewing many repos:

```
GitHub webhook (pull_request) → bridge service →
  POST {app-server}/v1/apps/sessions {cwd: <clone>, prompt: "load review …"}
  → poll session → gh api post review
```

Give the bridge its own `CODEWHALE_HOME`, its own GitHub token, and a
queue so `synchronize` bursts serialize rather than spawn N sessions.
The bridge is small; the durable-host problem it wraps is the product
work named above.
