A colour-contrast fix release: no new features, just legibility fixes across
all six themes.

## Download

| File | For |
| --- | --- |
| `jmd-0.1.1-arm64.dmg` | macOS — Apple Silicon |
| `jmd-0.1.1-x64.dmg` | macOS — Intel |
| `jmd.Setup.0.1.1.exe` | Windows — x64 installer |

The macOS builds are signed with a Developer ID certificate and notarized by
Apple, so they open without a Gatekeeper warning. Install from the dmg; the
zips are there for a future auto-updater.

The Windows build is an x64 NSIS installer. It is not code-signed, so Windows
SmartScreen may display a warning. SHA-256:
`e2024e37bc31db3490916f59dfa5c0919cf068e9d362bb0fbf6d931ea6a0aa31`.

## What changed since v0.1.0

- **Selection was invisible on the current line, in every theme.** The
  active-line highlight painted in front of the selection layer, not behind
  it, so selecting text on the line the cursor was already on showed no
  highlight at all — for a single-line drag or a multi-line selection alike.
  `--active-line` is now translucent in every theme, matching the layering
  CodeMirror itself expects, so the selection shows through as before.
- **The editor's find/replace panel (⌘F) had unreadable button labels on the
  dark themes.** `next`, `previous`, `all`, `replace` and `replace all` used
  CodeMirror's built-in light-grey button chrome regardless of the active
  theme, putting light label text on a light background in Nord, Dracula and
  Gruvbox Dark.
- **Contrast pass across all six themes**: the current-search-match colour,
  the dimmest text tier (line numbers, tab close, status bar), and — most
  notably in Solarized Light — secondary text and the colour used for text
  sitting on the accent colour.

See the [README](https://github.com/jojonki/jmd/blob/main/README.md) for the
full feature list, unchanged since v0.1.0.

## Settings

Settings live outside the app itself: `~/Library/Application Support/jmd` on
macOS and `%APPDATA%\jmd` on Windows. Replacing the app with a newer build
keeps them.
