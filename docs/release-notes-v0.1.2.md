Vim mode. The source pane can be modal now, if you ask for it.

## Download

| File | For |
| --- | --- |
| `jmd-0.1.2-arm64.dmg` | macOS — Apple Silicon |
| `jmd.Setup.0.1.2.exe` | Windows — x64 installer |

Apple Silicon only on macOS; the Intel (x64) build has been discontinued. The
macOS build is signed with a Developer ID certificate and notarized by Apple,
so it opens without a Gatekeeper warning. Install from the dmg; the zip is
there for a future auto-updater.

The Windows build is an x64 NSIS installer. It is not code-signed, so Windows
SmartScreen may display a warning. It is built on a separate machine and will
be added to this release when it is ready.

## What changed since v0.1.1

- **Vim mode for the source pane** (⌘⌃V / Ctrl+Alt+V, or Settings › Editor).
  Off until you turn it on, and once on it applies to every tab, this session
  and the next. The status bar grows a badge reading NORMAL, INSERT, VISUAL,
  V-LINE, V-BLOCK or REPLACE, with a half-typed command shown beside it the way
  vim's own `showcmd` does.

  The editing model is CodeMirror's vim keymap, so it composes rather than
  enumerates: operators (`d c y > <`), motions (`w b e f t % gg G { }`), counts,
  text objects, registers, marks, macros, `.`, `/` and `?` with `n` / `N`, and
  `:%s/old/new/g`.

  Four ex commands act on the document in front of you rather than on a file
  vim picked out: `:w` saves, `:wq` / `:x` save and close the tab, `:q` / `:q!`
  close the tab, `:qa` / `:qa!` close the window.

  It is the **source pane's** mode alone. The preview is a contenteditable
  surface with its own idea of what a keystroke means, so turning vim on leaves
  preview-only for the split, switches in-preview editing off and puts the caret
  back on the left; the badge disappears along with the pane it describes.
  Application shortcuts are matched before the editor sees the key, so ⌘S saves
  in insert mode just as it does anywhere else.
- **Settings remembers which section you were in.** The dialog has three
  sections now — Appearance, Editor, Shortcuts — and reopens on whichever one
  you used last instead of always landing on Appearance.
- **Windows showed the app's description instead of its name.** In the "Open
  with" list, jmd appeared as "A simple, lightweight markdown editor with live
  preview", because the Windows shell uses the executable's `FileDescription`
  as the friendly name and electron-builder had filled it from `description`.
  The installer now writes `jmd`.

See the [README](https://github.com/jojonki/jmd/blob/main/README.md) for the
full feature list and the [vim mode
section](https://github.com/jojonki/jmd/blob/main/README.md#vim-mode) for the
details.

## Settings

Settings live outside the app itself: `~/Library/Application Support/jmd` on
macOS and `%APPDATA%\jmd` on Windows. Replacing the app with a newer build
keeps them.
