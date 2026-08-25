Twelve colour templates instead of six, and an updater that asks once a day
rather than on every launch — with a way to turn a release down for good.

## Download

| File | For |
| --- | --- |
| `jmd-0.2.3-arm64.dmg` | macOS — Apple Silicon |

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

## What changed since v0.2.2

- **Six more colour templates.** **Catppuccin Latte** for a light desk,
  **Tokyo Night** and **Rosé Pine** for a dark one, and **Midnight**, which is
  nearly black — for an OLED display, or a room with the lights off.

  Two of them are there for the fun of it: **Sakura**, pale petal pink with a
  rounded body face, and **Synthwave**, neon on deep indigo the way a 1984
  sunset never actually looked. Both are readable enough to work in, which is
  the only thing that kept them in.

  Twelve skins in all — five light, seven dark — in Settings › Appearance or
  the View › Theme menu. An accent colour of your own still sits on top of
  whichever one you pick.

- **The update check runs once a day, not on every launch.** Opening jmd twenty
  times in an afternoon asked GitHub twenty times about a release that had not
  changed. It now looks at most once every 24 hours, so coming back to jmd
  after a week away still gets you the news on the launch you came back on.
  Check for Updates… asks immediately, as it always has.

- **A version can be turned down.** The offer now reads **Download**, **Later**
  and **Skip This Version**. Later asks again another day, as before. Skip
  drops that release from the automatic check for good — the release after it
  is still offered, and Check for Updates… brings a skipped one back if you
  change your mind.

  Nothing else about updating has changed: nothing is downloaded before you say
  so, and the install still waits for you to agree to a restart, or for the
  next time you quit.

## Updating from v0.1.2 or earlier

Those builds have no updater in them, so there is nothing to run: download the
dmg and replace the app in `/Applications` one last time.

## Settings

Settings live outside the app itself: `~/Library/Application Support/jmd` on
macOS. Updating — by hand or through the updater — keeps them, including the
skin you are using.
