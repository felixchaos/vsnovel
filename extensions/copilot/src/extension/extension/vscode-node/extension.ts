/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Must be the first import to ensure it evaluates before other imports.
import './disableProcessReport';

import { ExtensionContext, window } from 'vscode';
import { resolve } from '../../../util/vs/base/common/path';
import { baseActivate } from '../vscode/extension';
import { vscodeNodeContributions } from './contributions';
import { registerServices } from './services';
import { NovelAuthenticationProvider } from '../../../novel/auth/novelAuthProvider';

// ###############################################################################################
// ###                                                                                         ###
// ###                 Node extension that runs ONLY in node.js extension host.                ###
// ###                                                                                         ###
// ### !!! Prefer to add code in ../vscode/extension.ts to support all extension runtimes !!!  ###
// ###                                                                                         ###
// ###############################################################################################

//#region TODO@bpasero this needs cleanup
import '../../intents/node/allIntents';

function configureDevPackages() {
	try {
		const sourceMapSupport = require('source-map-support');
		sourceMapSupport.install();
		const dotenv = require('dotenv');
		dotenv.config({ path: [resolve(__dirname, '../.env')] });
	} catch (err) {
		console.error(err);
	}
}
//#endregion

export function activate(context: ExtensionContext, forceActivation?: boolean) {
	// NOVEL-BUILDER: before everything, including the DI container.
	//
	// $ensureProvider on the main thread activates the extension that declares a
	// provider id and waits for that activation to complete. Registering from a
	// contribution puts the registration behind the activation blockers — so the
	// main thread waits for an activation that is itself waiting for the auth
	// service, and neither moves. Observed as a sign-in that succeeds and a
	// session that nothing can then read: getAccounts() entered three times and
	// never once got past ensureProvider.
	//
	// Registering here makes isAuthenticationProviderRegistered true before
	// anything can ask, so $ensureProvider returns without activating anything.
	context.subscriptions.push(
		new NovelAuthenticationProvider(context, window.createOutputChannel('VS Novel Auth', { log: true }))
	);

	return baseActivate({
		context,
		registerServices,
		contributions: vscodeNodeContributions,
		configureDevPackages,
		forceActivation
	});
}
