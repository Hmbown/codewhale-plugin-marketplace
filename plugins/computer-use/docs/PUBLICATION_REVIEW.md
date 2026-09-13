# Publication review

Disposition record for the first public source snapshot (0.3.1). It
summarizes a read-only source review of the pre-publication tree and what was
done about each finding, so that the current support and qualification status
is clear without the private history. Test and native evidence are recorded in
[the release checklist](RELEASE_CHECKLIST.md); this page is not a transcript.

## Decision

- Publish source at 0.3.1 as a macOS beta candidate. The plugin manifest's
  public host eligibility is macOS only.
- Publish no signed download yet. The 0.3.0 archive was notarized and
  qualified on one maintainer Mac and was never released publicly. A notarized
  0.3.1 build is installed on that Mac and passed the update path, but stays
  unpublished until the remaining gates pass.
- Keep Windows and Linux as experimental, source-only backends until exact
  targeting, native human controls and per-platform native gates pass. Linux
  GTK/background work is in progress on a separate branch and is not part of
  this snapshot.

## Findings and disposition

| Finding | Disposition |
| --- | --- |
| Losing the Mac menu owner leaves an unreachable human-control state | Fixed in source: persist Stop, abort input and retire the daemon. The socket fixture verifies exit, relaunch in stopped mode, human-only resume and stale-lease refusal. A signed 0.3.1 build passed the native owner crash and reopen check with isolated state. |
| Old daemon cleanup can remove a replacement's socket/run receipt | Fixed in source. A two-daemon fixture blocks old cleanup while the replacement starts, then proves the new listener and receipt survive. |
| Catalog suggests equal support on all platforms | Fixed in the manifest, README, skill description and model instructions. Public host eligibility is macOS only; Windows/Linux experimental status is explicit. |
| Failed update apply leaves the reason only in a log | Fixed in source: persist the apply result for the next native panel launch, keep input stopped and avoid attributing every stop to the user. A rejected real apply invocation verifies the saved result and unchanged consent. The non-admin Applications-directory scenario still needs a device trial. |
| MCP reports an older version than the manifest | Fixed in source; initialization now uses the manifest version and the protocol test checks it. |
| A deleted registered app gets a generic connection error | Fixed in source with a repair path. It still refuses to bypass the installed helper. |
| Windows/Linux raw input follows the current foreground app | Confirmed from source. Release blocker for those ports; no background-input claim. Required work is in the porting plan. |
| Windows semantic targets are refused because a scoped UIA path cannot be guaranteed | Confirmed; keep the refusal until exact window targeting is implemented and independently verified. The model instruction implying working Windows background mutation was removed. |
| Windows screenshot ignores region/display selectors | Open; honor or explicitly refuse these selectors before Windows qualification. |
| Windows pipe squatting and Linux held-input survival after daemon death | Device/security hypotheses, not reproduced findings. Require explicit ownership tests and an implementation appropriate to each OS before release. |
| Rollback backups accumulate | Existing retention is deliberate: preserve rollback copies until the user removes them. A retention policy needs to preserve a verified rollback and disclose cleanup. |

The review found the existing Mac input preemption, scoped observations,
session leases, human-only Pause/Stop authority and verified-update chain worth
retaining. It did not establish full Codex parity or Windows/Linux readiness.

## Qualification status at publication

Verified, all on one maintainer Mac (arm64):

- Source suite: 240 passed, 0 failed, 15 platform skips. The hosted CI
  workflow runs the same suite on macOS and Ubuntu runners.
- Signed 0.3.1 native build: menu-bar owner crash and reopen with isolated
  state passed.
- Updater apply: an installed notarized 0.3.0 was replaced by the notarized
  0.3.1 build. The previous bundle was retained, the helper restarted with
  controls stopped, and all 33 runtime files plus the 3 native executables in
  the installed bundle matched the build.

Not yet verified:

- A clean-machine install with fresh Accessibility and Screen Recording
  grants.
- A model-driven task through an installed Codewhale Engine, as opposed to
  direct MCP calls.
- Any public distribution path: no GitHub release, package publication or
  signed download exists in this repository yet.

Source tests do not stand in for native or distribution qualification.

## Support

Report problems through this repository's GitHub issues after checking
[TROUBLESHOOTING.md](TROUBLESHOOTING.md). Security reports follow
[SECURITY.md](../SECURITY.md). This is a beta with best-effort maintenance.

## Cross-platform work order

1. Bind an exact application/window before input. Refuse unsupported background
   requests. Check foreground ownership throughout shared-input gestures and
   stop when the person switches apps; never reclaim focus implicitly.
2. Implement Windows semantic mutations against the same exact window used for
   observation. Preserve ambiguity and stale-element refusals.
3. Add native human controls using the existing daemon/session authority. Prove
   the Windows control transport independently; the current FD3 fixture times
   out on Windows and is not evidence of a working tray-control channel.
4. Make isolated X11 background work an owned product capability on Linux.
   Wayland needs its own compositor/portal consent and targeting path. A
   foreground Windows desktop is not an isolated background desktop.
5. Run native effects and independent focus/pointer observers, including a user
   switch during input, disconnect, owner crash and held-input cleanup.
6. Qualify per-platform installation, signing, update/rollback and an actual
   model-driven task before adding host eligibility or download links.

Reuse the platform-neutral parity runner and existing backends; do not add
another session store or execution loop. [PORTING.md](PORTING.md) describes
the driver and observer contracts.
