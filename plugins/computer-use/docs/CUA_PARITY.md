# Cua reference and Codewhale parity

Verified October 4, 2026. This is a source comparison and implementation plan.
Upstream documentation, local protocol fixtures, native application receipts,
installed builds and real cloud tasks are separate evidence.

## Reference versions

| Component | Version | Release commit |
| --- | --- | --- |
| [Cua Driver](https://github.com/trycua/cua/releases/tag/cua-driver-rs-v0.33.2) | 0.33.2 | `c82d32e3e1adbc6578a148962002ddf6e3e8a15a` |
| [Base SDK / CLI](https://github.com/trycua/cua/releases/tag/cua-sdk-v0.3.1) | 0.3.1 | `3f01aec64307e989c5e10e73c9af68f91f94c13e` |
| [Spaces app](https://github.com/trycua/cua/releases/tag/cua-spaces-v0.7.0) | 0.7.0 | `e5c86b47ecbe9409a26a4eb954b32cd8c4ae9c28` |
| [spacesd](https://github.com/trycua/cua/releases/tag/cua-spacesd-v0.5.3) | 0.5.3 | `0d274d0d428ebb7c9f1345c377028c2315eecc2b` |

Driver's release notes explain that its GitHub prerelease badge reserves the
monorepo's Latest pointer; ordinary Driver SemVer is its stable channel.
Newer website documentation must not be assumed to describe every released
Spaces feature.

## Existing authority and concrete gaps

The canonical plugin owns computer-use tools and packaged operating guidance.
Engine owns sessions, tool approval, model-visible context and receipts.
Keep those owners when adding capabilities. A Cua-style workflow must use
Codewhale's existing computers and provider lifecycle rather than introducing
another account, agent loop or registry.

| Capability | Codewhale source | Remaining proof or implementation |
| --- | --- | --- |
| App discovery and observation | `list_apps`, `list_windows`, `get_app_state`, OCR and state IDs | Actual native app/toolkit catalog and exact installed release |
| Semantic actions | Revalidated element identity, consent and background refusals | Continuous human coexistence; broader Windows/Linux qualification |
| Pixel capture identity | `raster_id` pins screenshot/OCR/zoom coordinates; stale pins refuse | Pins are optional for legacy clients and do not prove unchanged UI |
| Nested zoom | Server supplies the exact bound parent file to each backend | Native crop/image fidelity per platform; mocked transport proof is narrower |
| Browser control | Isolated browser here; signed-in Chrome through Chromewhale | Frame/navigation/download parity on the installed host |
| Human takeover | Existing pause/stop, lease and cancellation gates | Real contested-input and interrupted-action receipts |
| Separate desktops | Task-owned Docker desktop, registered SSH computers | Persistent cloud lifecycle and an actual remote task |
| Shared desktop viewing/files | Existing app preview and recordings | Scoped viewers, team presence, streaming and transfer capabilities |
| Persistent agents | Engine task/session authority remains the owner | Crash continuation and computer replacement acceptance |

Cua's [Driver tool contract](https://cua.ai/docs/cua-driver/reference/mcp-tools)
offers exact targets, capture-bound actions and structured action outcomes.
Codewhale uses its own advertised schemas: `raster_id` is not an alias for
Driver's `capture_id` or spacesd's `screenshot_id`. Codewhale pins are reusable
while current; they do not implement Driver's capture consumption contract.
Never prescribe upstream tool names to a Codewhale model.

## Teaching delivered by this slice

The existing `initialize.instructions` and five reviewed MCP resources carry
the updated guide. No second prompt source or training service is introduced.
It teaches models to carry the observed raster ID, use child IDs after zoom,
re-observe after replacement or UI changes, verify delivery and preserve all
permission, human-control and consequential-action gates. An omitted image
still cannot supply coordinates. OCR targets carry the same pin automatically.
The recording resource teaches the same contract. Saved capture-dependent
trajectory steps are marked non-replayable, including older files without that
marker; review and replay never strip or remap a pin to authorize new input.

`target_raster_id` records the conversion source; `parent_raster_id` records
the zoom source. A changed computer route or app bind retires capture context.
Coordinates without a pin retain compatibility with older clients; the new
guide never recommends dropping a pin to recover from a refusal.

## Qualification using the existing suite

Reuse [PARITY.md](PARITY.md)'s native fixtures, task DSL, independent oracles,
interference probes and retained retries. Add coverage to that suite as new
capabilities land. Do not create another model loop or hand-edit success rows.

The first source checks cover helper/direct/remote capture replacement, OCR,
child geometry and trusted crop sources, malformed/other-computer pins, route
retirement and no input on refusal. These mocked checks do not operate a real
desktop or establish behavioral parity. Native acceptance must also cover
multiple windows, changing focus, Unicode/IME, missing permissions, human
Pause/Stop, unknown delivery outcomes and file preservation on remote stop.

Keep Windows/Linux experimental until their existing release gates pass.
Cua's [platform matrix](https://cua.ai/docs/cua-driver/concepts/platform-support)
also distinguishes compositor, browser and app-family support; a cross-platform
binary is insufficient evidence for every native behavior.

## Spaces adoption boundary

The upstream [license map](https://github.com/trycua/cua/blob/7d69b8d80ccfb1a3f9ae747d63bc1ae237a0a406/LICENSING.md)
distinguishes MIT Driver/base SDK from FSL Spaces, spacesd and streaming
components. Its [commercial policy](https://github.com/trycua/cua/blob/7d69b8d80ccfb1a3f9ae747d63bc1ae237a0a406/COMMERCIAL.md)
requires commercial licensing for hosted or managed offerings built on Spaces.
This slice imports no Cua implementation. Use MIT components only after normal
dependency review; Spaces is a workflow reference until adoption is separately
decided. Keep credential transfer, viewer access and data retention explicit.
