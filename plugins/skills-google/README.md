# Google skills

Workflows for Gmail and Google Calendar.

After installing, reviewing, trusting and enabling the plugin, ask:

> What is on my calendar tomorrow, and are there any unread emails from the
> people I am meeting?

| Skill | What it does |
| --- | --- |
| `gmail` | Search, read and draft mail; sending needs your explicit approval of recipients, subject and body |
| `google-calendar` | Read schedules, check availability, create or update events with timezone-aware verification |

## Prerequisites

The skills use an already connected Gmail or Calendar tool when there is one.
Otherwise they describe direct API use with **your own** Google OAuth client and
the narrowest scope for the task (for example `gmail.readonly` or
`calendar.events.readonly`). Installing this plugin connects nothing; with no
connection the agent should tell you setup is needed. No credential is included
here and none should be pasted into chat.

Email and event text sent to Google's APIs, and message or event contents read
back, go through the model provider you have configured.

## Did it work?

Success is a list of real messages or events with sender, date or local time and
timezone. A missing connection, a missing OAuth client or an authorization error
means setup is incomplete, not that your inbox or calendar is empty.

Google Photos is not covered. The `photos` skill is for a local macOS Photos
library and lives in `skills-personal`.

## Relationship to `codewhale-skills`

These skills are byte-for-byte copies of the same-named files in the
repository's [`skills/`](https://github.com/Hmbown/codewhale-plugin-marketplace/tree/main/skills) mirror (MIT, see `LICENSE`);
`provenance.json` records the source revision and a SHA-256 for each file.
They load as `skills-google:<skill>`. The monolithic `codewhale-skills` pack stays
available and still contains all of them under `codewhale-skills:<skill>`;
install either this plugin or the monolith for a given skill, not both, or the
same workflow appears twice. Codewhale's own bundled skills of the same name
are separate again.

Skills provide instructions only. Installing this plugin does not connect an
account, install a dependency, grant a permission or send data anywhere. It
declares no MCP servers, hooks, commands or network hosts.
