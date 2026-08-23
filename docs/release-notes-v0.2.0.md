jmd updates itself now. This is the last release you have to install by hand.

## Download

| File | For |
| --- | --- |
| `jmd-0.2.0-arm64.dmg` | macOS — Apple Silicon |
| `jmd.Setup.0.2.0.exe` | Windows — x64 installer |

Apple Silicon only on macOS; the Intel (x64) build has been discontinued. The
macOS build is signed with a Developer ID certificate and notarized by Apple,
so it opens without a Gatekeeper warning. Install from the dmg.

The other files attached here — the zip, its blockmap and `latest-mac.yml` —
are what the updater reads. They are not something to download by hand.

The Windows build is an x64 NSIS installer. It is not code-signed, so Windows
SmartScreen may display a warning. It is built on a separate machine and will
be added to this release when it is ready.

## What changed since v0.1.2

- **In-app updates.** jmd looks for a new release shortly after launch, and
  whenever you ask through Check for Updates… — in the jmd menu on macOS, in
  Help on Windows. When there is nothing new, the on-demand check says so
  rather than staying silent.

  Nothing downloads without asking. The update is around 100 MB, which is not
  a transfer to start on your behalf, so jmd names the new version and waits
  for an answer. Say yes and it downloads in the background, reporting itself
  through the window's progress bar; the editor stays usable throughout.

  Installing asks again. Replacing the app means quitting it, so jmd closes its
  windows the ordinary way first, which is what raises the usual prompt for any
  tab you have not saved. Cancel at either point and nothing is lost: the
  update is already on disk and goes in the next time you quit.

  Should any of this fail — no network, a release that will not verify — the
  error says what happened and offers the releases page, so the manual route is
  always one click away.

- **A selection no longer paints the gutter.** Selecting more than one line
  drew a band of colour to the left of every line after the first, in the gap
  between the line numbers and the text, where there is nothing selected and
  not even a space character.

## Updating from v0.1.2 or earlier

Those builds have no updater in them, so there is nothing to run: download the
dmg and replace the app in `/Applications` one last time. From v0.2.0 onward,
jmd handles it.

## Settings

Settings live outside the app itself: `~/Library/Application Support/jmd` on
macOS and `%APPDATA%\jmd` on Windows. Updating — by hand or through the
updater — keeps them.
