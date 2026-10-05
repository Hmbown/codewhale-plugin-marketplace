# Document skills

Workflows for creating, editing and checking office and PDF files, plus
writing repository documentation.

After installing, reviewing, trusting and enabling the plugin, ask:

> Make a one-page Word memo about the Q3 roadmap, then reopen it and show me
> the text you saved.

| Skill | What it does |
| --- | --- |
| `docx` | Create, edit and inspect Word documents; verify by reopening and extracting text |
| `pdf` | Read, extract, split, merge, rotate, watermark, fill, OCR or create PDFs; check page counts and text |
| `pptx` | Create, edit, inspect and verify slide decks |
| `xlsx` | Create, edit, analyze and verify workbooks, including CSV and TSV |
| `document` | Write or update README files, user guides, API docs, architecture and migration notes (not a Word skill) |

## Prerequisites

None to install. Each skill names the tools it prefers (for example
`python-docx`, `pandoc` or a host document capability) and says what to do when
one is missing. Files stay on your machine; the skills do not upload them.

## Did it work?

The agent should name the file it wrote and report what it read back (text
excerpt, page or slide count, sheet names). A missing tool should be reported as
a setup problem, not worked around silently.

The `docx`, `pptx` and `xlsx` skills mention a compatibility alias
(`documents`, `presentations`, `spreadsheets`). Those aliases exist only in the
monolithic pack; use the skill names above.

## Relationship to `codewhale-skills`

These skills are byte-for-byte copies of the same-named files in the
repository's [`skills/`](https://github.com/Hmbown/codewhale-plugin-marketplace/tree/main/skills) mirror (MIT, see `LICENSE`);
`provenance.json` records the source revision and a SHA-256 for each file.
They load as `skills-docs:<skill>`. The monolithic `codewhale-skills` pack stays
available and still contains all of them under `codewhale-skills:<skill>`;
install either this plugin or the monolith for a given skill, not both, or the
same workflow appears twice. Codewhale's own bundled skills of the same name
are separate again.

Skills provide instructions only. Installing this plugin does not connect an
account, install a dependency, grant a permission or send data anywhere. It
declares no MCP servers, hooks, commands or network hosts.
