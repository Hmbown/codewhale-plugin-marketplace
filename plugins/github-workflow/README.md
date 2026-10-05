# GitHub

Review pull requests, triage issues and file well-formed issues from inside
Codewhale, using GitHub's official remote MCP server. The skills read first and
report to you; nothing is posted to GitHub without your approval of the exact text.

| Job | Try this | Result |
| --- | --- | --- |
| Review a PR | `/pr https://github.com/OWNER/REPO/pull/123` | A severity-ordered report in chat: blocking issues, checks, unresolved threads, files not reviewed |
| Triage open issues | “Triage the open bug issues in OWNER/REPO” | A table of class, priority, evidence and suggested action; no changes made |
| File an issue | “Draft an issue for this crash in OWNER/REPO” | A duplicate search, a draft that follows the repo template, then creation only after you approve it |

## Set up

1. Install, then review the bundle: `/plugin install <path-or-catalog>`,
   `/plugin show github`. The review shows one remote endpoint,
   `https://api.githubcopilot.com/mcp/`, and the network host
   `api.githubcopilot.com`.
2. Create a GitHub **fine-grained personal access token** limited to the
   repositories you want. Read-only is enough for review and triage; add
   Issues/Pull requests write only if you intend to post or file.
3. Make it available to the process that starts Codewhale, then start Codewhale
   from that shell. Keep the value out of config files, commits and transcripts:

   ```sh
   export GITHUB_PERSONAL_ACCESS_TOKEN=...   # your own token
   codewhale
   ```

4. `/plugin trust github <token from show>` then `/plugin enable github`.

Plugin-contributed MCP servers cannot run an interactive OAuth login in
Codewhale today, so the plugin declares token authentication through the
environment variable above. The plugin carries no credential.

## What it reaches and what it can do

- **Destination:** every tool call goes to `api.githubcopilot.com`, with your
  token. Repository names, PR numbers, issue text you ask it to write and file
  content it reads travel to GitHub. Do not put secrets in drafts.
- **Authority comes from the token.** The plugin's `merge_pull_request` tool is
  disabled in `mcp.json` by default; that is a guard, not a replacement for a
  minimal token. To work read-only at the server, edit your user MCP
  configuration to use `https://api.githubcopilot.com/mcp/readonly` instead of
  installing this plugin's default endpoint (the connection catalog lists it).
- **No drive-by comments.** The skills forbid commenting on, reviewing,
  labeling or closing issues and PRs you did not ask them to touch, and defer to
  a repository's own rule against agent comments. Tool approval and your
  repository instructions still apply on top.

## Success and setup failures

- Success: the first PR review names the checks by name and cites files and
  lines from the diff it read.
- No GitHub tools listed in `/mcp status`: the plugin is not yet trusted or
  enabled.
- Authentication error on the first call: the token is unset, expired or
  cannot see the repository. Restart Codewhale from a shell where the variable
  is set. A 404 on a private repository usually means the token lacks access.

## Notes

This repository also carries a bundled `github` skill that uses the `gh` CLI. This
plugin does not need `gh`; use whichever fits your setup. Live authentication
against GitHub's service is not exercised by this repository's tests; they check
the manifest, endpoint, review contract and the skills' safety rules.

License: MIT.
