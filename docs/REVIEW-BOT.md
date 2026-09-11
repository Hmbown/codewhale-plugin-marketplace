# Codewhale review workflows

The `review` and `security-review` skills define how to inspect a change with its
callers and contracts, gate findings on a reachable defect, and cite useful
file/line anchors. These instructions improve the workflow; they do not prove
review quality, detection rates or parity with another product.

A useful local review reads the repository and compares the intended base/head:

```sh
codewhale review --help
```

Select the diff scope supported by your installed version. Review the findings
and cited source before posting them. WhaleWiki can help retrieve context, but
its seals establish unchanged evidence, not that the reviewer is correct.

## Turning the workflow into a bot

A bot needs more than a review prompt:

1. An installed GitHub app or properly scoped repository workflow receives the
   event and identifies the immutable PR base/head.
2. A durable queue coalesces superseded updates, limits concurrency and records
   retries without duplicate reviews.
3. An isolated checkout runs the pinned Codewhale binary with explicit model,
   resource limits and normal approval boundaries. Untrusted PR code must not
   run with publishing credentials.
4. A parser reads the actual structured output contract of that pinned binary,
   validates paths and line anchors against the current PR diff, and retains
   source/test evidence. `tail -1` of a stream is not a reliable review parser.
5. A separate authorized publishing step posts a comment/review using its scoped
   token. Posting a review is not permission to approve or merge the PR.
6. Failures, model costs, user decisions and lifecycle state remain observable
   through the existing runtime and receipt owners.

The earlier Actions snippet was incomplete and its webhook recipe used a
nonexistent `/v1/apps/sessions` bridge contract. Existing integrations use
`POST /v1/threads`, `POST /v1/threads/<id>/turns`, and runtime events/approvals.
See the [integration guide](../integrations/README.md).

The supplied Slack/Linear webhook adapter is intake plus explicit dispatch; it
does not implement GitHub review publication. A hosted GitHub App, durable result
delivery and live installation acceptance remain product work. Do not market a
prompt, package install or mocked API test as an always-on review service.
