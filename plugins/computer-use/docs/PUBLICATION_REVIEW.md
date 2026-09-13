# Publication review — 2026-09-13

Claude Fable 5.1 reviewed canonical source `5e80caf01fb509dd9b9fdf1251f4a9edc4dacd10`
using the exact model ID `claude-fable-5-1`. The review was read-only: source
inspection, without running the plugin or performing native device tests.
Its findings were checked against the source before changes were made.

## Release decision

The existing notarized macOS 0.3.0 release can remain public. The next app
release needs owner-recovery fixes and fresh qualification. Windows and Linux
are development backends and are excluded from the public marketplace's host
platforms until their targeting, human controls and native gates pass.

The 0.3.1 source candidate is not a newly qualified app archive. The published
0.3.0 archive, its digest and its notarization receipt remain unchanged.
See [the release checklist](RELEASE_CHECKLIST.md) for the clean-machine install,
fresh permission grants, notarized update and model-driven Engine task gates.

## Findings and disposition

| Finding | Disposition |
| --- | --- |
| Losing the Mac menu owner leaves an unreachable human-control state | Fixed in source: persist Stop, abort input and retire the daemon. The socket fixture verifies exit, relaunch in stopped mode, human-only resume and stale-lease refusal. |
| Old daemon cleanup can remove a replacement's socket/run receipt | Fixed in source. A two-daemon fixture blocks old cleanup while the replacement starts, then proves the new listener and receipt survive. |
| Catalog suggests equal support on all platforms | Fixed in the manifest, README and model instructions. Public host eligibility is macOS only; Windows/Linux development status is explicit. |
| Failed update apply leaves the reason only in a log | Fixed in source: persist the apply result for the next native panel launch, keep input stopped and avoid attributing every stop to the user. A rejected real apply invocation verifies the saved result and unchanged consent. The non-admin Applications-directory scenario still needs a device trial. |
| MCP reports 0.2.1 despite the manifest version | Fixed in source; initialization now uses the manifest version and the protocol test checks it. |
| A deleted registered app gets a generic connection error | Fixed in source with a repair path. It still refuses to bypass the installed helper. |
| Windows/Linux raw input follows the current foreground app | Confirmed from source. Release blocker for those ports; no background-input claim. Required work is in the porting plan. |
| Windows semantic targets are refused because a scoped UIA path cannot be guaranteed | Confirmed; keep the refusal until exact window targeting is implemented and independently verified. Removed the model instruction implying working Windows background mutation. |
| Windows screenshot ignores region/display selectors | Open; honor or explicitly refuse these selectors before Windows qualification. |
| Windows pipe squatting and Linux held-input survival after daemon death | Device/security hypotheses, not reproduced findings. Require explicit ownership tests and an implementation appropriate to each OS before release. |
| Rollback backups accumulate | Existing retention is deliberate: preserve rollback copies until the user removes them. A retention policy needs to preserve a verified rollback and disclose cleanup. No backups were deleted for this review. |

The review found the existing Mac input preemption, scoped observations,
session leases, human-only Pause/Stop authority and verified-update chain worth
retaining. It did not establish full Codex parity or Windows/Linux readiness.

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
   model-driven task before adding marketplace eligibility or download links.

Reuse the platform-neutral parity runner and existing backends; do not add
another session store or execution loop. [PORTING.md](PORTING.md) describes
the driver and observer contracts.
