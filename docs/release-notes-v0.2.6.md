jmd opens faster: the window now appears about 40% sooner.

## Download

| File | For |
| --- | --- |
| `jmd-0.2.6-arm64.dmg` | macOS — Apple Silicon |

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

## What changed since v0.2.5

- **The window appears straight away.** jmd used to keep its window hidden
  until the page had finished its first paint. It now shows the window as soon
  as it exists, in your theme's background colour, and the editor fills in a
  moment later. jmd remembers the colour from the last time it ran, so the
  first launch after this update opens in white; after that, it uses your
  theme's colour.

- **Less to load at startup.** Math (KaTeX) and code highlighting
  (highlight.js) were a third of what jmd parsed before drawing anything, and a
  new blank document needs neither. They now load just after the window
  appears, or as soon as a document needs them. If a document you open shows
  its formulas as plain TeX or its code uncoloured, that lasts only until they
  arrive. An HTML export always waits for them.

## Updating from v0.1.2 or earlier

Those builds have no updater in them, so there is nothing to run: download the
dmg and replace the app in `/Applications` one last time.

## Settings

Settings live outside the app itself: `~/Library/Application Support/jmd` on
macOS. Updating — by hand or through the updater — keeps them.
