# Linear

Triage the issue queue, claim work without colliding with a teammate, and draft
evidence-based status updates, using Linear's official remote MCP server.
Changes to Linear are stated before they are made.

| Job | Try this | Result |
| --- | --- | --- |
| Triage a queue | `/linear triage ENG` | A table of proposed priority, labels and duplicates; applied only to rows you confirm |
| See your work | `/linear mine` | Your open issues by priority with status and last update |
| Claim an issue | `/linear claim ENG-123` | Checks owner, status and blockers, then assigns you and moves it to the team's started state |
| Status update | `/linear status "Project name"` | A draft with shipped, in progress, blocked and a health value with the rule that set it; posted only after you approve |

## Set up

1. Install, then review the bundle: `/plugin install <path-or-catalog>`,
   `/plugin show linear`. The review shows one remote endpoint,
   `https://mcp.linear.app/mcp`, and the network host `mcp.linear.app`.
2. Create your own Linear API key (Settings, Security & access). A restricted
   read-only key works for `mine`, triage reads and status drafts; writes then
   fail by design.
3. Make it available to the process that starts Codewhale, then start Codewhale
   from that shell. Keep it out of config files, commits and transcripts:

   ```sh
   export LINEAR_API_KEY=...   # your own key
   codewhale
   ```

4. `/plugin trust linear <token from show>` then `/plugin enable linear`.

Linear's server also supports OAuth, but plugin-contributed MCP servers cannot
run Codewhale's interactive OAuth login today. For OAuth, configure Linear as a
user-level MCP server instead (see the repository's
[connections guide](../../docs/CONNECTIONS.md)); do not install both.

## What it reaches and what it can do

- **Destination:** tool calls go to `mcp.linear.app` with your key. Issue
  content you ask it to write is stored in Linear. If your team syncs to a public
  GitHub repository, treat what you write as public.
- **Authority comes from the key.** The plugin disables the delete tools
  (`delete_comment`, `delete_attachment`, `delete_status_update`) by default.
- Skills never overwrite another person's assignee, never invent labels, and ask
  before every shared write.

## Success and setup failures

- Success: `/linear mine` lists real issues with identifiers and URLs; a claim
  is verified by re-reading the issue.
- No Linear tools listed in `/mcp status`: plugin not yet trusted or enabled.
- 401 or unauthorized: the key is unset, revoked or malformed. Restart Codewhale
  from a shell where `LINEAR_API_KEY` is set.

Live authentication against Linear is not exercised by this repository's tests;
they check the manifest, endpoint, review contract and the skills' safety rules.

License: MIT.
