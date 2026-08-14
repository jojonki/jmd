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
    execFileSync('xcrun', ['notarytool', 'submit', dmg, ...credentials, '--wait'], { stdio: 'inherit' });

    execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });
    console.log(`  • dmg notarization successful  file=${dmg}`);
  }

  return [];
};
