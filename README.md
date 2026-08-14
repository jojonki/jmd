# jmd

A simple, lightweight Markdown editor with source, split, and fully editable
preview views. Built with Electron for macOS and Windows.

![jmd: text editing, live split view, rich-text editing, and colour themes](docs/jmd-demo.gif)

## What it does

- **Tabs.** Several documents in one window, each with its own undo history,
  selection and scroll position. ⌘1…⌘8 jump straight to a tab, ⌘9 to the last
  one, ⌃⇥ / ⌃⇧⇥ walk the neighbours.
- **Live preview** beside the editor, re-rendered as you type. Only the blocks
  that actually changed are replaced in the DOM, so scroll position, image
  decode state and the caret survive a keystroke.
- **Edit in the preview** (⌘E / Ctrl+E). Type in the rendered document and the
  markdown source updates under you — see [below](#editing-in-the-preview) for
  how far that goes.
- **Math** — `$inline$` and `$$display$$`, rendered with KaTeX. `Costs $5 and
  $6` stays prose; a `$` only opens math when it hugs its content.
- **Images**, including relative paths, which resolve against the folder of the
  file you have open.
- **The usual syntax** plus tables, footnotes, definition lists, task lists,
  `==highlight==`, `~sub~`/`^sup^`, and syntax-highlighted code fences.
- **Six colour templates**, covering the editor, the preview and the chrome
  from a single set of CSS variables — plus an accent colour of your own on top
  of any of them.
- **Rebindable keys.** Tab navigation, layouts, in-preview editing, file reveal
  and Settings are listed in Settings › Shortcuts and can be rebound instantly.
- **The file's absolute path** sits in the header directly above its active tab;
  click it to reveal the file in Finder (Explorer on Windows). The status bar
  reports the current Editor / Split / Preview and preview-editing states.
- **Scroll sync** in both directions, anchored on source lines rather than on a
  scroll percentage, so long code blocks and images don't drift.
- **Export to standalone HTML** carrying the current theme.

## Running it

```sh
npm install
npm start          # build, then launch
npm run dev        # vite dev server + electron, with hot reload
npm run smoke      # drive the real app end to end (needs `npm run dev` running)
```

Packaging:

```sh
npm run dist:mac   # dmg + zip in release/
npm run dist:win   # nsis installer
```

## Keyboard shortcuts

| Action | macOS | Windows / Linux | Rebindable |
| --- | --- | --- | :---: |
| New tab / close tab | ⌘T / ⌘W | Ctrl+T / Ctrl+W | Yes |
| Select tab 1–8 / last tab | ⌘1…⌘8 / ⌘9 | Ctrl+1…Ctrl+8 / Ctrl+9 | Yes |
| Next / previous tab | ⌘⇥ or ⌃⇥ / ⌘⇧⇥ or ⌃⇧⇥ | Ctrl+Tab / Ctrl+Shift+Tab | Yes |
| Editor / split / preview | ⌘⌃1 / ⌘⌃2 / ⌘⌃3 | Ctrl+Alt+1 / Ctrl+Alt+2 / Ctrl+Alt+3 | Yes |
| Toggle editing in the preview | ⌘E | Ctrl+E | Yes |
| Reveal in Finder / file manager | ⌘⇧R | Ctrl+Shift+R | Yes |
| Settings | ⌘, | Ctrl+, | Yes |
| New window / open / save | ⌘N / ⌘O / ⌘S | Ctrl+N / Ctrl+O / Ctrl+S | No |
| Save as / find in source | ⌘⇧S / ⌘F | Ctrl+Shift+S / Ctrl+F | No |
| Close window | ⌘⇧W | Platform default | No |
| Undo / redo, from either pane | ⌘Z / ⌘⇧Z | Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z on Linux) | No |

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

## Layout

```
electron/          main process: windows, menus, file dialogs, jmd-file:// scheme
src/
  main.js          wiring: tabs, layout, themes, scroll sync, file access
  tabs.js          the tab strip (selection, closing, drag-reorder)
  shortcuts.js     action ids, key bindings, and how a key event maps to one
  settings-panel.js  the settings dialog: skin, accent colour, shortcuts
  editor/          CodeMirror 6 source pane
  markdown/        markdown-it pipeline + the KaTeX plugin
  preview/         rendering, DOM patching, and the in-preview editor
  styles/          app chrome, preview typography, colour templates
test/smoke.cjs     end-to-end checks against a real Electron window
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

## Adding a shortcut

Add an entry to `ACTION_GROUPS` in `src/shortcuts.js` with a default binding,
then a handler under the same id in the `ACTIONS` table in `src/main.js`. It
shows up in the settings dialog, and in the menu if you also add an
`actionItem()` for it in `electron/main.js`.
