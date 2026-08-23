/**
 * Signs, notarizes and staples the macOS dmg.
 *
 * electron-builder notarizes the .app and only then wraps it in a dmg, so the
 * dmg itself ships unsigned. The dmg is what users actually download, so it
 * needs the same treatment. Wired in as electron-builder's
 * afterAllArtifactBuild hook; runs only when notarization credentials are in
 * the environment, which is what keeps `npm run dist:mac:local` fast.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const IDENTITY = process.env.CSC_NAME || 'Developer ID Application';

// Mirrors the credential lookup in electron-builder's macPackager.
function credentialArgs() {
  const { APPLE_KEYCHAIN_PROFILE, APPLE_KEYCHAIN } = process.env;
  if (APPLE_KEYCHAIN_PROFILE) {
    const args = ['--keychain-profile', APPLE_KEYCHAIN_PROFILE];
    return APPLE_KEYCHAIN ? [...args, '--keychain', APPLE_KEYCHAIN] : args;
  }
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID) {
    return ['--apple-id', APPLE_ID, '--password', APPLE_APP_SPECIFIC_PASSWORD, '--team-id', APPLE_TEAM_ID];
  }
  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env;
  if (APPLE_API_KEY && APPLE_API_KEY_ID && APPLE_API_ISSUER) {
    return ['--key', APPLE_API_KEY, '--key-id', APPLE_API_KEY_ID, '--issuer', APPLE_API_ISSUER];
  }
  return null;
}

/**
 * Submits the dmg for notarization, retrying a connection that drops.
 *
 * The dmg is well over 100 MB and `notarytool submit` uploads the whole thing
 * before Apple looks at it, so a connection that stalls halfway costs the
 * entire transfer (`HTTPClientError.connectTimeout`). Nothing is lost by asking
 * again: a submission that did reach Apple keeps its own id and finishes on
 * their side regardless, and the answer this hook needs comes from whichever
 * attempt survives the upload.
 */
function submitForNotarization(dmg, credentials, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync('xcrun', ['notarytool', 'submit', dmg, ...credentials, '--wait'], { stdio: 'inherit' });
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.log(`  • notarization attempt failed, retrying  attempt=${attempt}/${attempts}`);
    }
  }
}

/**
 * Drops the dmg from `latest-mac.yml`.
 *
 * electron-builder records each artifact's sha512 and size in that file, but it
 * does so before this hook runs — and signing and stapling the dmg rewrites it,
 * so both values describe a file that no longer exists. The auto-updater reads
 * the yml and would reject the download.
 *
 * The entry is removed rather than corrected because nothing consumes it:
 * Squirrel.Mac updates through the zip, which this hook never touches, and
 * which stays the file `path:` points at. The dmg remains in the release for
 * people installing by hand.
 */
function dropDmgFromUpdateInfo(dmgs, outDir) {
  const yml = path.join(outDir, 'latest-mac.yml');
  if (!fs.existsSync(yml)) return;

  const names = new Set(dmgs.map(dmg => path.basename(dmg)));
  const lines = fs.readFileSync(yml, 'utf8').split('\n');
  const kept = [];
  let dropping = false;

  for (const line of lines) {
    const entry = line.match(/^\s*-\s+url:\s*(.+?)\s*$/);
    if (entry) dropping = names.has(entry[1]);
    // The url line opens an entry; its sha512 and size are indented under it.
    else if (dropping && !/^\s+\S/.test(line)) dropping = false;
    if (!dropping) kept.push(line);
  }

  fs.writeFileSync(yml, kept.join('\n'));
  console.log(`  • pruned stale dmg entries  file=${yml}`);
}

exports.default = async function notarizeDmg(context) {
  const dmgs = (context.artifactPaths || []).filter(file => file.endsWith('.dmg'));
  if (process.platform !== 'darwin' || dmgs.length === 0) {
    return [];
  }

  const credentials = credentialArgs();
  if (!credentials) {
    console.log('  • skipped dmg notarization  reason=no credentials in the environment');
    return [];
  }

  for (const dmg of dmgs) {
    console.log(`  • signing dmg     file=${dmg}`);
    execFileSync('codesign', ['--sign', IDENTITY, '--timestamp', '--force', dmg], { stdio: 'inherit' });

    console.log(`  • notarizing dmg  file=${dmg}`);
    submitForNotarization(dmg, credentials);

    execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });
    console.log(`  • dmg notarization successful  file=${dmg}`);
  }

  dropDmgFromUpdateInfo(dmgs, context.outDir || path.dirname(dmgs[0]));

  return [];
};
