# macOS distribution

**Status:** no release has been published from this repository yet. The
latest-release endpoint answers 404 to anonymous requests, the setup page
reports the download as pending, and the app's **Check for updates…** reports
that no stable installer has been published. The procedure below is how the
first release will be produced; it is not evidence that one exists.

The public entry point is [codewhale.net/computer-use](https://codewhale.net/computer-use).
The plugin marketplace links there; this repository's GitHub Releases stores
the versioned files. The website resolves the latest stable release and offers
a download only when `release.json` confirms notarization and matches the
archive name, platform, architecture, size, and GitHub SHA-256 asset digest.
Missing qualification leaves the download pending; a network failure reports
that availability is unknown.

The standalone download carries its native launcher, accessibility helper,
practice app and Node 24.21.0 for Apple silicon and Intel. It requires macOS
13.5+. No Node installation, compiler, npm install or terminal setup is needed
to open the downloaded app. MCP hosts still use their own server launch
configuration; the helper automatically owns local input once registered.

## Build and qualify

```sh
npm ci
npm test
npm run build:branding
node scripts/prepare-node-runtime.mjs
node scripts/build-app.mjs --platform macos --node-runtime dist/node
node scripts/package-macos.mjs --notary-profile YOUR_SAVED_KEYCHAIN_PROFILE
```

Node downloads are pinned by version and the hashes in `app/node-lock.json`.
Only the fixed binary and license members are extracted from verified Node
archives. The universal runtime is signed with a JIT entitlement; the other
native executables do not receive that entitlement.

Packaging requires a Codewhale Developer ID signature, submits to Apple's
notary service using an existing Keychain profile, waits for **Accepted**,
staples the app and checks Gatekeeper. A failed or missing notarization does
not produce a release archive. Keep `notarization.json`, `release.json` and
`SHA256SUMS.txt` alongside the archive as release evidence. See
[Apple's notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

The archive is named `Codewhale-Computer-Use-VERSION-macos-universal.zip`.
Publish the archive, `SHA256SUMS.txt`, and `release.json` together with a stable
`vVERSION` release in this repository after every applicable gate in
[the release checklist](RELEASE_CHECKLIST.md) has a recorded result. Keep the
release draft until all three assets have uploaded. The website refreshes
availability within five minutes of publication; no hard-coded website version
needs to change. Packaging does not tag, publish, or change
the separate Codewhale Engine release. Windows/Linux distribution remains
source-based until those installers have their own device/signing receipts.

## Installation and updates

For a download, expand the archive and move the app to Applications. Open it
once to register the helper, then use its setup panel.

For a developer build, `npm run install:app` installs in `~/Applications`.
It stages and verifies the complete app before replacement and retains the
previous bundle. A self-contained bundle is copied without changing its
notarized resource seal. Developer builds without bundled Node pin the local
runtime and are signed again before installation.

**Check for updates…** contacts this repository's GitHub Releases only when
clicked.
The updater offers stable, newer versions with an exact asset name and a
[GitHub SHA-256 asset digest](https://docs.github.com/en/rest/releases/assets).
Choosing **Install VERSION…** downloads a bounded archive, validates its
paths before extraction, then checks the digest, bundle version, Codewhale
signing team and Gatekeeper's notarized Developer ID verdict. Stapled-ticket
validation happens during packaging, so consumers do not need Xcode. It stops input, retains
the previous app and restarts. Existing sessions stay stopped. There is no
background polling or silent update installation.

The inline catalog icon is a bounded PNG data URI, at most 32 KiB and 256 by
256 pixels. It is display metadata, never a trust grant. Browsing artwork
does not fetch a publisher URL or render executable SVG content.
