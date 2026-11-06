A small fix: indenting a bulleted list in the preview no longer leaves blank
lines in your document.

## Download

| File | For |
| --- | --- |
| `jmd-0.2.5-arm64.dmg` | macOS — Apple Silicon |

If you are on v0.2.0 or later, there is nothing to download: jmd offers this
update on its own shortly after launch, or from Check for Updates… in the jmd
menu.

Apple Silicon only on macOS; the Intel (x64) build has been discontinued. The
macOS build is signed with a Developer ID certificate and notarized by Apple,
so it opens without a Gatekeeper warning.

The other files attached here — the zip, its blockmap and `latest-mac.yml` —
are what the updater reads. They are not something to download by hand.

No Windows build accompanies this one; it is built on a separate machine and
may be added to this release later.

## What changed since v0.2.4

- **Lists stay tight when you edit them in the preview.** Pressing Tab twice,
  pressing Shift+Tab on a nested item, or pressing Enter at the end of an item
  with children could write a blank line into the source. The list then spread
  out, often only later, when you switched tabs or edited the source. These
  edits now leave the source without the blank line.

- **Tab on the first item of a list now does nothing.** It has no item above to
  nest under, and Markdown cannot express that indent. It used to look indented
  until the next render, then jump back.

- **An empty list item stays out of the source until you type in it.** This now
  applies anywhere in a list, not only at the end.

Blank lines already saved in a file are left as they are, since some may be
intentional. Delete the ones you don't want and the list closes up again.

## Updating from v0.1.2 or earlier

Those builds have no updater in them, so there is nothing to run: download the
dmg and replace the app in `/Applications` one last time.

## Settings

Settings live outside the app itself: `~/Library/Application Support/jmd` on
macOS. Updating — by hand or through the updater — keeps them.
