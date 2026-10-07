# Personal skills

Everyday workflows: money, shopping, travel, photos, music and audio.

After installing, reviewing, trusting and enabling the plugin, ask:

> Compare the three best-reviewed carry-on suitcases under $200 and say which
> is the best deal.

| Skill | What it does | Needs |
| --- | --- | --- |
| `shopping` | Compare products, prices and reviews | Web access |
| `flights` | Flight status, schedules, gates and delays | Web access; an optional FlightAware key you supply |
| `money` | Read-only balances and transactions | A Plaid connection you authorize; no payments |
| `photos` | Search a local Photos library and export chosen copies | macOS, Photos library, `osxphotos` |
| `spotify` | Playback control, search, playlists | Spotify desktop app on macOS, or an authorized Spotify connection |
| `tts` | Speak or render text with voices already on the machine | macOS `say`, Linux `espeak-ng`/`spd-say`, or Windows speech |
| `podcast` | Script, synthesize and stitch a spoken briefing | `tts` (included) and `ffmpeg` |
| `image-search` | Find images on the web and save chosen ones | Web access |

## Data destinations

Web research queries go to your configured search tools. `money` reads bank data
only through a connection you authorize and reports it to the model provider you
use; do not use it where that is unacceptable. `photos` works on local files and
exports copies only where you name. Nothing here buys, pays, uploads or
publishes on its own.

## Did it work?

Each skill states its setup and should fail loudly when a requirement is
missing. A comparison with prices and sources, a flight status with a timestamp,
or an exported file path is success; "no results" with no explanation is not.

## Relationship to `codewhale-skills`

These skills are byte-for-byte copies of the same-named files in the
repository's [`skills/`](https://github.com/Hmbown/codewhale-plugin-marketplace/tree/main/skills) mirror (MIT, see `LICENSE`);
`provenance.json` records the source revision and a SHA-256 for each file.
They load as `skills-personal:<skill>`. The monolithic `codewhale-skills` pack stays
available and still contains all of them under `codewhale-skills:<skill>`;
install either this plugin or the monolith for a given skill, not both, or the
same workflow appears twice. Codewhale's own bundled skills of the same name
are separate again.

Skills provide instructions only. Installing this plugin does not connect an
account, install a dependency, grant a permission or send data anywhere. It
declares no MCP servers, hooks, commands or network hosts.
