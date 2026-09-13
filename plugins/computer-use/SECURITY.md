# Security

## Reporting a vulnerability

Please do not file public issues for suspected vulnerabilities. Use GitHub's
private vulnerability reporting for this repository
(**Security → Report a vulnerability** on
[github.com/Hmbown/codewhale-cu-plugin](https://github.com/Hmbown/codewhale-cu-plugin)).
If that option is not available, open an issue that says only that you have a
security report and how to reach you, without details of the problem.

Include the plugin version, macOS version, whether the desktop helper was
installed (`request_access` reports `via: "app"` or `"direct"`), and the
steps to reproduce. Remove private app contents, document text and
credentials from logs and screenshots.

This is a beta maintained on a best-effort basis. Reports are read and
acknowledged as time allows; there is no guaranteed response time, bounty or
coordinated disclosure schedule. Only the current source snapshot and, once
one exists, the latest published macOS release are considered supported.

## What the design promises

These are the properties the code is written to hold and that the source tests
exercise. They are design intentions, not third-party audit results.

- **Fail closed.** Missing permissions, missing platform tools, unknown
  computers, stale element targets and unsupported gestures return an error
  that names the cause. If a gesture is interrupted, inspect its receipt and
  the application state before retrying; some effects may already have occurred.
- **Human controls win.** When the macOS helper is installed, it owns local
  input. Pause cancels queued work and releases held input; Stop invalidates
  sessions. Only the person at the menu bar can allow input again. A model
  instruction cannot resume the helper, and the source instructs models not to
  bypass a stopped helper with direct mode.
- **No shell over the socket.** The desktop helper and the ssh agent execute
  only an allow-listed tool set; arguments travel as data.
- **Verified updates.** The updater accepts only a stable GitHub release in
  this repository with an exact asset name, checks the download's size and
  SHA-256 digest, validates archive paths before extraction, and requires the
  Codewhale signing team and a notarized Developer ID verdict before replacing
  the app. The previous bundle is retained. There is no background polling.
- **Local by default.** The MCP server contacts no network service on its
  own. OCR runs on device. The outbound connections are the user-initiated
  update check and download, the panel's Help button (which opens this
  repository's troubleshooting page in the browser), and the ssh/hdc
  transports the user registers. Building the self-contained bundle downloads
  the pinned Node runtime from nodejs.org and verifies it against
  `app/node-lock.json`.

## Known boundaries

- The macOS background mode is app-scoped control of a local application, not
  an isolated desktop. Shared-desktop gestures move the real cursor and are
  only offered with explicit user authorization.
- Windows and Linux backends are experimental. Their raw input follows the
  foreground application, they have no native human controls, and the
  ownership of held input after a helper crash is not yet verified on those
  platforms. They are excluded from the plugin's public host eligibility.
- Accessibility and Screen Recording grants are keyed to the app's signing
  identity. Rebuilding an ad-hoc signed developer app may require new grants.
- The receipt hygiene script (`scripts/check-receipts.mjs`) scans committed
  evidence for home paths, usernames, emails and common credential shapes. It
  is a guard against accidental leaks, not a guarantee.
- See [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for the full list of what is
  measured, untested or known broken.
