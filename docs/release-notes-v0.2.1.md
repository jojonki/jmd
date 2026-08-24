The version number, and nothing else. This release exists so that the updater
that shipped in v0.2.0 has something to find.

## Download

| File | For |
| --- | --- |
| `jmd-0.2.1-arm64.dmg` | macOS — Apple Silicon |

If you are on v0.2.0, there is nothing to download: jmd offers this update on
its own shortly after launch, or from Check for Updates… in the jmd menu.
Taking it is the point of the release.

Apple Silicon only on macOS; the Intel (x64) build has been discontinued. The
macOS build is signed with a Developer ID certificate and notarized by Apple,
so it opens without a Gatekeeper warning.

The other files attached here — the zip, its blockmap and `latest-mac.yml` —
are what the updater reads. They are not something to download by hand.

No Windows build accompanies this one. The Windows updater has not been
exercised yet, and there is no change here to warrant a build.

## What changed since v0.2.0

Nothing but the version.

## Updating from v0.1.2 or earlier

Those builds have no updater in them, so there is nothing to run: download the
dmg and replace the app in `/Applications` one last time.

## Settings

Settings live outside the app itself: `~/Library/Application Support/jmd` on
macOS. Updating — by hand or through the updater — keeps them.
