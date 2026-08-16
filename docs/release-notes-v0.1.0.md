The first release of jmd, a lightweight Markdown editor with source, split and
fully editable preview views.

## Download

| File | For |
| --- | --- |
| `jmd-0.1.0-arm64.dmg` | Apple Silicon |
| `jmd-0.1.0-x64.dmg` | Intel |

Both builds are signed with a Developer ID certificate and notarized by Apple,
so they open without a Gatekeeper warning. Install from the dmg; the zips are
there for a future auto-updater.

## What it does

- **Tabs.** Several documents in one window, each with its own undo history,
  selection and scroll position. Drag a tab to reorder it, or out of the window
  to move that document, unsaved text included, into a window of its own.
- **Live preview** beside the editor, re-rendered as you type. Only the blocks
  that actually changed are replaced in the DOM, so scroll position, image
  decode state and the caret survive a keystroke.
- **Edit in the preview** (⌘E). Type in the rendered document and the markdown
  source updates under you.
- **Find in the preview** (⌘⇧F). Paints hits through the CSS Custom Highlight
  API, so the preview DOM is left alone and the matches keep up while you edit.
- **Math.** `$inline$` and `$$display$$`, rendered with KaTeX. `Costs $5 and $6`
  stays prose; a `$` only opens math when it hugs its content.
- **The usual syntax** plus tables, footnotes, definition lists, task lists,
  `==highlight==`, `~sub~`/`^sup^`, and syntax-highlighted code fences.
- **Six colour templates**, covering the editor, the preview and the chrome from
  a single set of CSS variables, plus an accent colour of your own on top.
- **Two column widths.** A normal measure and a wide one, toggled with ⌘⌃W or
  from the status bar; both are set in rem in Settings › Appearance.
- **Rebindable keys**, listed in Settings › Shortcuts and rebound instantly.
- **Follows the disk.** When an open file is rewritten by something else, a tab
  with no unsaved work reloads it where you were reading; a tab with unsaved
  work keeps your version and says so in the status bar.
- **Scroll sync** in both directions, anchored on source lines rather than on a
  percentage, so long code blocks and images do not throw it off.
- **HTML export** as a single file carrying the current theme.

See the [README](https://github.com/jojonki/jmd/blob/main/README.md) for the
full description.

## Settings

Settings live in `~/Library/Application Support/jmd`, outside the app bundle, so
replacing the app with a newer build keeps them.
