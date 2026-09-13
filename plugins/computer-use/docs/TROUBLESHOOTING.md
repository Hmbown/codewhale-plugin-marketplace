# Set up Computer Use

Open **Computer Use…** from the whale in the macOS menu bar. The app starts
quietly; connecting a model does not open Settings or take keyboard focus.

1. In **Accessibility**, choose **Allow…**, then enable **Codewhale Computer
   Use** in System Settings. This permits reading controls and sending input.
2. In **Screen Recording**, choose **Allow…**, then enable the same app. This
   permits app screenshots. macOS may require quitting and reopening the app.
3. Return to the panel. Both permission rows should say **Granted**.
4. Choose **Run background check** and keep your pointer still briefly. It
   edits a temporary practice window, presses Apply and captures that window.
   The result says what was verified. It does not touch your documents or
   clipboard. Pointer or foreground movement makes the result inconclusive.
5. In Codewhale, review and enable the built-in Computer Use plugin, then
   start a task. Selecting an app in the task makes it appear in the panel.

## Working controls

**Background** uses app-scoped accessibility actions and process-bound input.
Unsupported actions fail with an explanation. **Foreground** shares the
desktop and requires the user's authorization. Neither is a second desktop.

**Pause** cancels pending requests and releases held input. **Resume** allows
new requests in those sessions. **Stop all sessions** also invalidates their
input bindings and leases. **Allow new sessions** does not revive stopped
requests: begin a new task. Paused/stopped state survives helper restarts.

If input release fails, the panel stays blocked and explains the failure.
Quit and reopen the helper before starting another task. The model cannot
resume the helper through MCP or operate its own safety panel.

## Common problems

| What you see | What to do |
| --- | --- |
| Permission stays missing | Confirm the app name in Settings. Quit and reopen after changing Screen Recording. Use a current signed build. |
| Run background check is disabled | Grant both permissions, allow control and wait for the current action to finish. |
| Check is inconclusive | Keep the pointer still and stay in the same app for the next check. The previous trial is not counted as passing isolation. |
| Helper unavailable | Open Computer Use from Applications. Check its panel and log. Reinstall if its path no longer exists. The client will not bypass an installed helper. |
| The menu icon disappeared and reopening a 0.3.0 build does nothing | Quit the orphaned Computer Use helper in Activity Monitor, then reopen the app and allow new sessions yourself. Builds from 0.3.1 retire the helper and recover on reopen; which builds are published is recorded in [CHANGELOG.md](../CHANGELOG.md). |
| App needs shared pointer input | Prefer an advertised accessibility action. Otherwise explicitly authorize foreground use or choose a separate computer. |
| No stable installer available | The updater found no published stable release that passes its checks; release status is recorded in [CHANGELOG.md](../CHANGELOG.md). Build and install from source, or check again later. Being on the newest source commit is not the same as having a published app. |
| Update verification failed | Keep using the installed version. Recheck later; do not disable signature or notarization checks. |
| An update stopped computer sessions | Read the update result in the panel, resolve any installation error and choose Allow new sessions when ready. Updates never resume stopped input automatically. Builds from 0.3.1 source show the apply result after relaunch. |

App log: `~/Library/Logs/Codewhale Computer Use/app.log`.
Update log: `~/Library/Logs/Codewhale Computer Use/update.log`.

## Getting help

Open an issue at
[github.com/Hmbown/codewhale-cu-plugin/issues](https://github.com/Hmbown/codewhale-cu-plugin/issues)
with the plugin version, macOS version, the failed action and the error text.
Remove private app contents, document text and credentials from any log
excerpt. For a suspected vulnerability, follow [SECURITY.md](../SECURITY.md)
instead of filing a public issue. Support is best-effort during the beta.

## Roll back

Updates retain the previous bundle under the installation directory's
`.codewhale-cu-backups/` folder. Quit Computer Use, move the current bundle
aside, and restore the saved bundle as **Codewhale Computer Use.app**. Open
it, check permissions and start a fresh task. Old sessions and stopped input
are not replayed. Backups are kept until you choose to remove them.
