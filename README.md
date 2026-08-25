# jmd

A simple, lightweight Markdown editor with source, split, and fully editable
preview views. Built with Electron for macOS and Windows.

![jmd: text editing, live split view, rich-text editing, and colour themes](docs/jmd-demo.gif)

## What it does

- **Tabs.** Several documents in one window, each with its own undo history,
  selection and scroll position. ⌘1…⌘8 jump straight to a tab, ⌘9 to the last
  one, ⌃⇥ / ⌃⇧⇥ walk the neighbours. Drag a tab to reorder it, or out of the
  window to move that document — unsaved text included — onto another jmd
  window, or into one of its own.
- **Live preview** beside the editor, re-rendered as you type. Only the blocks
  that actually changed are replaced in the DOM, so scroll position, image
  decode state and the caret survive a keystroke.
- **Edit in the preview** (⌘E / Ctrl+E). Type in the rendered document and the
  markdown source updates under you — see [below](#editing-in-the-preview) for
  how far that goes.
- **Find in the preview** (⌘F / ⌘⇧F). Searches the rendered document and paints
  the hits through the CSS Custom Highlight API, so the preview DOM is left
  alone and the matches keep up while you edit.
- **Math** — `$inline$` and `$$display$$`, rendered with KaTeX. `Costs $5 and
  $6` stays prose; a `$` only opens math when it hugs its content.
- **Images**, including relative paths, which resolve against the folder of the
  file you have open.
- **The usual syntax** plus tables, footnotes, definition lists, task lists,
  `==highlight==`, `~sub~`/`^sup^`, and syntax-highlighted code fences.
- **Twelve colour templates**, covering the editor, the preview and the chrome
  from a single set of CSS variables — plus an accent colour of your own on top
  of any of them. Five light, seven dark, two of them (Sakura and Synthwave)
  more playful than the rest.
- **Two column widths.** A normal measure and a wide one, toggled with ⌘⌃W or
  from the status bar; both are set in rem in Settings › Appearance.
- **Vim mode** for the source pane (⌘⌃V), off unless you turn it on. Operators,
  motions, counts, text objects, registers, marks, macros, `/` search and a `:`
  line that knows about jmd's own documents — see [below](#vim-mode).
- **Rebindable keys.** Tab navigation, layouts, in-preview editing, file reveal
  and Settings are listed in Settings › Shortcuts and can be rebound instantly.
- **The file's absolute path** sits in the header directly above its active tab;
  click it to reveal the file in Finder (Explorer on Windows). The status bar
  reports the current Editor / Split / Preview and preview-editing states.
- **Follows the disk.** When an open file is rewritten by something else, a tab
  with no unsaved work reloads it where you were reading; a tab with unsaved
  work keeps your version and says so in the status bar.
- **Scroll sync** in both directions, anchored on source lines rather than on a
  scroll percentage, so long code blocks and images don't drift.
- **Export to standalone HTML** carrying the current theme.

## Getting it

Built apps for macOS (Apple Silicon) and Windows are on the
[releases page](https://github.com/jojonki/jmd/releases/latest). The macOS dmg
is signed and notarized, so it opens without a Gatekeeper warning.

From 0.2.0 on, jmd keeps itself current: it looks for a new release shortly
after launch — at most once a day, so twenty launches cost one check — and
Check for Updates… asks on demand. When there is one, the offer comes with
three answers: **Download**, **Later**, which asks again another day, and
**Skip This Version**, which drops that release for good. A skipped version is
never raised by the automatic check again; the release after it still is, and
Check for Updates… brings the skipped one back if you change your mind.
Nothing is downloaded without saying so first, and the install waits for you to
agree to a restart — or for the next time you quit. Coming from 0.1.2 or
earlier means one last manual swap, since those builds have no updater to run.

## Running it

```sh
npm install
npm start          # build, then launch
npm run dev        # vite dev server + electron, with hot reload
npm run smoke      # drive the real app end to end (needs `npm run dev` running)
npm run smoke:dist # the same checks, against the built dist
npm run demo       # re-record docs/jmd-demo.gif from the real app (needs ffmpeg)
```

Packaging:

```sh
npm run dist:mac        # dmg + zip in release/ (for distribution, notarized)
npm run dist:mac:local  # local-only mac build, no notarization
npm run dist:win        # nsis installer
```

### Signing and notarization on macOS

Signing needs no configuration: electron-builder picks up the Developer ID Application
certificate from the keychain. Notarization only runs when credentials are passed through
the environment; without them it logs a warning and skips.

Store the credentials in the keychain once:

```sh
# after issuing an app-specific password at https://appleid.apple.com
xcrun notarytool store-credentials jmd-notary \
  --apple-id <Apple ID> --team-id W2Z92AW32J
```

From then on a single environment variable is enough:

```sh
APPLE_KEYCHAIN_PROFILE=jmd-notary npm run dist:mac
```

electron-builder notarizes the `.app` only, and the dmg wrapped around it ships unsigned.
The dmg is what people actually download, so `scripts/notarize-dmg.cjs` is hooked into
`afterAllArtifactBuild` to sign, notarize and staple it too. That hook likewise runs only
when credentials are present in the environment.

Verify both with the following. `accepted` on each means it opens without a warning on a
user's machine.

```sh
spctl -a -vvv -t install release/mac-arm64/jmd.app
spctl -a -vvv -t open --context context:primary-signature release/jmd-0.2.0-arm64.dmg
```

Signing is also what makes the updater work at all: macOS refuses to install an update
over an unsigned app, so a `dist:mac:local` build fails the check rather than updating.

Re-signing the dmg invalidates the hash electron-builder took of it for `latest-mac.yml`,
which is written out after the hook has run — so `scripts/prune-dmg-update-info.cjs` drops
that entry once the build is over. Updates go through the zip, which is never touched
after the fact.

The whole path from bumping the version to publishing on GitHub Releases is written up in
[docs/release.md](docs/release.md) (in Japanese).

## Keyboard shortcuts

| Action | macOS | Windows / Linux | Rebindable |
| --- | --- | --- | :---: |
| New tab / close tab | ⌘T / ⌘W | Ctrl+T / Ctrl+W | Yes |
| Select tab 1–8 / last tab | ⌘1…⌘8 / ⌘9 | Ctrl+1…Ctrl+8 / Ctrl+9 | Yes |
| Next / previous tab | ⌘⇥ or ⌃⇥ / ⌘⇧⇥ or ⌃⇧⇥ | Ctrl+Tab / Ctrl+Shift+Tab | Yes |
| Editor / split / preview | ⌘⌃1 / ⌘⌃2 / ⌘⌃3 | Ctrl+Alt+1 / Ctrl+Alt+2 / Ctrl+Alt+3 | Yes |
| Toggle wide width | ⌘⌃W | Ctrl+Alt+W | Yes |
| Toggle editing in the preview | ⌘E | Ctrl+E | Yes |
| Toggle vim mode | ⌘⌃V | Ctrl+Alt+V | Yes |
| Find in the preview | ⌘⇧F | Ctrl+Shift+F | Yes |
| Reveal in Finder / file manager | ⌘⇧R | Ctrl+Shift+R | Yes |
| Settings | ⌘, | Ctrl+, | Yes |
| New window / open / save | ⌘N / ⌘O / ⌘S | Ctrl+N / Ctrl+O / Ctrl+S | No |
| Save as / find | ⌘⇧S / ⌘F | Ctrl+Shift+S / Ctrl+F | No |
| Close window | ⌘⇧W | Platform default | No |
| Undo / redo, from either pane | ⌘Z / ⌘⇧Z | Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z on Linux) | No |

⌘F searches whichever side you are working in: the rendered document when the
preview holds the caret or is alone on screen, the source otherwise. ⌘⇧F always
searches the rendered document.

Rebindable commands live in **Settings › Shortcuts**. Click a shortcut and
press a new combination; the change applies immediately and the application
menu updates with it. A binding needs at least one of ⌘, ⌃ or ⌥ on macOS, or
Ctrl or Alt on Windows and Linux (function keys also work), so ordinary typing
is never captured. Each action can have more than one binding.

macOS keeps ⌘⇥ for its own application switcher, so an app never sees it: the
bindings are there as asked, and **⌃⇥ / ⌃⇧⇥ are bound alongside them** as the
combination that actually reaches jmd. Rebind whichever pair you prefer.

Drag the divider to resize the panes; double-click it to reset to 50/50.
Double-click any preview block to jump the source caret to that line.
Preview-only (⌘⌃3) turns on in-preview editing for you, since editing is the only
thing that pane is there for; ⌘⌃1 turns it back off.

The text column has two widths rather than one. ⌘⌃W switches between them, as
does the width reading in the status bar and Settings › Appearance. Wide earns
its keep on a large display or a table-heavy document; the normal measure is
where prose belongs. Both widths are yours to set — 46rem and 72rem by default —
and the editor and the preview read the same one, so they widen together.

## Moving tabs between windows

Let a tab go outside its window and the document moves to wherever you dropped
it. Over another jmd window, it joins that window's tabs and the window comes
forward; over nothing, a new window opens on the spot. Either way the unsaved
text and the saved-or-not state travel with it, so a half-written document
stays half-written on the other side.

A window with no tabs left closes itself. The one gesture that does nothing is
dragging a window's only tab onto empty space, which would close that window
and open an identical one.

## Editing in the preview

The markdown source stays the single source of truth. When you type in the
preview, jmd waits for a pause, converts **only the blocks you touched** back to
markdown, and splices those lines into the source. Everything you didn't touch
keeps its exact original formatting — your choice of `*` vs `_`, your line
wrapping, your raw HTML. A whole-document round trip would normalise all of it,
which is why it doesn't do that.

Blocks whose markup cannot survive an HTML round trip are read-only in this
mode and marked as such: **math, code fences and raw HTML**. Clicking one jumps
the source caret to it so you can edit it on the left.

Everything else — paragraphs, headings, lists, tables, links, emphasis — is
editable in place, and pressing Enter creates real new blocks.

## Vim mode

Off by default. Turn it on in **Settings › Editor** or with ⌘⌃V, and the source
pane becomes modal: the status bar grows a badge reading NORMAL, INSERT, VISUAL,
V-LINE, V-BLOCK or REPLACE, with a half-typed command shown beside it the way
vim's own `showcmd` does. The setting is remembered, and it applies to every
tab, including the ones already open.

The editing model is CodeMirror's vim keymap, so it composes rather than
enumerates: operators (`d c y > <`), motions (`w b e f t % gg G { }`), counts
(`d2w`, `5dd`), text objects (`iw`, `a"`, `ip`), registers, marks, macros, `.`,
`/` and `?` with `n` / `N`, and `:%s/old/new/g`. Settings › Editor lists the
common ground as a reminder.

Four ex commands act on the document in front of you rather than on a file vim
picked out:

| Command | What it does |
| --- | --- |
| `:w` | Save, the same as ⌘S. Untitled documents get the usual Save dialog. |
| `:wq`, `:x` | Save, then close the tab. |
| `:q`, `:q!` | Close the tab; `!` skips the question about unsaved work. |
| `:qa`, `:qa!` | Close the window, tab by tab. |

Vim mode is the **source pane's** mode, and only the source pane's. The preview
is a contenteditable surface with its own idea of what a keystroke means, so
neither in-preview editing (⌘E) nor preview-only (⌘⌃3) is modal — the badge
disappears along with the pane it describes rather than reporting a mode nothing
is listening in.

Turning vim on therefore hands the keyboard back to the source: it leaves
preview-only for the split, switches in-preview editing off, and puts the caret
on the left. ⌘E and ⌘⌃3 stay yours to press afterwards, and vim is still waiting
in the source when you come back.

Application shortcuts keep working throughout — they are matched before the
editor sees the key — so ⌘S saves in insert mode just as it does anywhere else.

## Layout

```
electron/          main process: windows, menus, file dialogs, file watching,
                   the jmd-file:// scheme
src/
  main.js          wiring: tabs, layout, themes, scroll sync, file access
  tabs.js          the tab strip (selection, closing, drag to reorder or detach)
  shortcuts.js     action ids, key bindings, and how a key event maps to one
  settings-panel.js  the settings dialog: skin, accent colour, editor, shortcuts
  about-panel.js   the about dialog: version, developer, repository, sponsorship
  editor/          CodeMirror 6 source pane, and the vim mode layered over it
  markdown/        markdown-it pipeline + the KaTeX plugin
  preview/         rendering, DOM patching, the in-preview editor, and find
  styles/          app chrome, preview typography, colour templates
test/smoke.cjs     end-to-end checks against a real Electron window
scripts/record-demo.cjs  drives the app to re-record the README's demo GIF
```

The renderer is sandboxed with context isolation; rendered HTML goes through
DOMPurify before it reaches the DOM, and local files are served over a
dedicated `jmd-file://` scheme rather than by relaxing the CSP.

Key bindings live in the renderer, not in the menu: the application menu shows
the current accelerator but (on macOS) does not register it, so a rebind takes
effect immediately without rebuilding anything.

## Adding a theme

Add a block of CSS variables to `src/styles/themes.css` (copy an existing one —
every theme sets the same token vocabulary) and one entry to the list in
`src/themes.js`. Nothing else needs to change; the settings dialog builds its
swatch from the theme's own tokens.

Selected text takes two of those tokens: `--selection` for the band behind it
and `--selection-fg` for the text itself. The preview is full of coloured text
(links, code, emphasis), so a band alone does not settle how readable a
selection is — pick the foreground too.

## Adding a shortcut

Add an entry to `ACTION_GROUPS` in `src/shortcuts.js` with a default binding,
then a handler under the same id in the `ACTIONS` table in `src/main.js`. It
shows up in the settings dialog, and in the menu if you also add an
`actionItem()` for it in `electron/main.js`.

## License

MIT — see [LICENSE](LICENSE).
