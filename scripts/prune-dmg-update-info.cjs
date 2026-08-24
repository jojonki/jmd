/**
 * Drops the dmg from `latest-mac.yml`.
 *
 * electron-builder records an artifact's sha512 and size when it builds it, and
 * writes them out at the very end. `scripts/notarize-dmg.cjs` signs and staples
 * the dmg in between, which rewrites the file — so the values that land in the
 * yml describe a dmg that no longer exists. The auto-updater reads that file
 * and would refuse the download.
 *
 * The entry is removed rather than corrected because nothing reads it:
 * Squirrel.Mac updates through the zip, which is never touched after the fact
 * and stays the file `path:` points at. The dmg is still in the release, for
 * people installing by hand.
 *
 * This runs after electron-builder rather than from its `afterAllArtifactBuild`
 * hook because that hook fires before the yml is written — anything it does to
 * the file is overwritten moments later.
 *
 * Run with `node scripts/prune-dmg-update-info.cjs [outDir]`; wired into the
 * `dist:mac` scripts in package.json.
 */
const fs = require('node:fs');
const path = require('node:path');

function prune(outDir) {
  const yml = path.join(outDir, 'latest-mac.yml');
  if (!fs.existsSync(yml)) {
    console.log(`  • no update info to prune  file=${yml}`);
    return;
  }

  const lines = fs.readFileSync(yml, 'utf8').split('\n');
  const kept = [];
  let dropping = false;

  for (const line of lines) {
    const entry = line.match(/^\s*-\s+url:\s*(.+?)\s*$/);
    // A url line opens an entry; its sha512 and size are indented under it.
    if (entry) dropping = entry[1].endsWith('.dmg');
    else if (dropping && !/^\s+\S/.test(line)) dropping = false;
    if (!dropping) kept.push(line);
  }

  if (kept.length === lines.length) {
    console.log(`  • no dmg entry in update info  file=${yml}`);
    return;
  }

  fs.writeFileSync(yml, kept.join('\n'));
  console.log(`  • pruned the dmg from update info  file=${yml}`);
}

prune(process.argv[2] || path.join(__dirname, '..', 'release'));
