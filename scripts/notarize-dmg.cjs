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

  // Re-signing invalidates the sha512 electron-builder recorded for the dmg,
  // which it writes into latest-mac.yml after this hook has run. Correcting it
  // from here is not possible; scripts/prune-dmg-update-info.cjs does it once
  // electron-builder has finished.

  return [];
};
