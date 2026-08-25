The source pane reads like a source pane: text aligned to its line numbers, a
caret position in the status bar, and lists that no longer shout.

## Download

| File | For |
| --- | --- |
| `jmd-0.2.2-arm64.dmg` | macOS — Apple Silicon |

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

## What changed since v0.2.1

- **The source text is aligned to its line numbers.** The editor centred its
  text column in the pane, so opening a window wide — full screen especially —
  left the text stranded in the middle with its line numbers far off to the
  left. It sits against the gutter now, the way every code editor puts it. The
  measure still caps how long a line gets before it wraps; the extra width a
  wide window brings is simply given to the right. The gap between the numbers
  and the text has come down to about what a code editor leaves.

  The preview is unchanged. A rendered document still centres, which is how a
  document is meant to be read.

- **The status bar reports where the caret is.** `Ln 3, Col 7`, beside the word
  and character counts, and the size of the selection when there is one. It
  follows tab switches rather than showing the position in the tab you left.

- **Lists are no longer painted in a colour of their own.** The item's text was
  taking the marker colour — a muddy gold on cream in Paper, hard to read at
  any length. The prose now sits a hair off the ordinary body colour in each
  theme: enough to see at a glance that a block parsed as a list, not enough to
  read as a different kind of text. The marker itself keeps the stronger
  colour, since the marker is what carries the signal.

  The `[x]` of a task item went with it. It had been picking up the colour
  reserved for code keywords — a dark red that stood out from the bullet it
  belongs to — and is now coloured as the list marker it is.

## Updating from v0.1.2 or earlier

Those builds have no updater in them, so there is nothing to run: download the
dmg and replace the app in `/Applications` one last time.

## Settings

Settings live outside the app itself: `~/Library/Application Support/jmd` on
macOS. Updating — by hand or through the updater — keeps them.
