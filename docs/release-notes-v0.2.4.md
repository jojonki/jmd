A small fix: clicking a code block in preview-only view no longer drops you
into the split view.

## Download

| File | For |
| --- | --- |
| `jmd-0.2.4-arm64.dmg` | macOS — Apple Silicon |

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

## What changed since v0.2.3

- **Code blocks stay where they are in preview-only view.** Clicking a code
  block, a formula or a block of raw HTML used to switch the window to the
  split view and put the caret in the source. Nothing on screen said why, and
  it made the code awkward to select and copy. Preview-only now stays
  preview-only: click, drag and copy as you would anywhere else.

  In the split view a click still takes the source caret to that line, since
  the source is right there to edit — but not after a drag that selected text,
  so copying works there too.

## Updating from v0.1.2 or earlier

Those builds have no updater in them, so there is nothing to run: download the
dmg and replace the app in `/Applications` one last time.

## Settings

Settings live outside the app itself: `~/Library/Application Support/jmd` on
macOS. Updating — by hand or through the updater — keeps them.
