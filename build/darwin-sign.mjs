// Sign a built VS Novel .app with Developer ID + hardened runtime, applying the
// per-helper entitlements the app needs to pass notarization. Run from the repo
// root after the darwin build:
//
//   node build/darwin-sign.mjs "../VSCode-darwin-arm64/VS Novel.app"
//
// @electron/osx-sign auto-detects the single Developer ID Application identity
// in the keychain, signs inside-out (helpers first), and applies the plist that
// matches each helper — mirroring the local signing flow. Notarization and
// stapling happen in the workflow after this, with the app zipped.

import { sign } from '@electron/osx-sign';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const app = process.argv[2];
if (!app) {
	process.stderr.write('usage: node build/darwin-sign.mjs <app-path>\n');
	process.exit(2);
}

// Entitlements live under build/azure-pipelines/darwin/ in the tree.
const entDir = join(dirname(fileURLToPath(import.meta.url)), 'azure-pipelines', 'darwin');

const optionsForFile = (filePath) => {
	let entitlements = join(entDir, 'app-entitlements.plist');
	if (filePath.endsWith('(GPU).app') || filePath.includes('(GPU).app/')) {
		entitlements = join(entDir, 'helper-gpu-entitlements.plist');
	} else if (filePath.endsWith('(Plugin).app') || filePath.includes('(Plugin).app/')) {
		entitlements = join(entDir, 'helper-plugin-entitlements.plist');
	} else if (filePath.endsWith('(Renderer).app') || filePath.includes('(Renderer).app/')) {
		entitlements = join(entDir, 'helper-renderer-entitlements.plist');
	} else if (filePath.includes('Helper')) {
		entitlements = join(entDir, 'helper-entitlements.plist');
	}
	return { entitlements, hardenedRuntime: true };
};

await sign({
	app,
	optionsForFile,
	// Auto-detect the Developer ID Application identity from the keychain.
	// gatekeeperAssess must be off in CI (no user session to assess against).
	gatekeeperAssess: false,
});

process.stderr.write(`darwin-sign: signed ${app}\n`);
