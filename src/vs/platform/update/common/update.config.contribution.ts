/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWeb, isWindows } from '../../../base/common/platform.js';
import { PolicyCategory } from '../../../base/common/policy.js';
import { localize } from '../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../configuration/common/configurationRegistry.js';
import { Registry } from '../../registry/common/platform.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'update',
	order: 15,
	title: localize('updateConfigurationTitle', "Update"),
	type: 'object',
	properties: {
		'update.mode': {
			type: 'string',
			enum: ['none', 'manual', 'start', 'default'],
			default: 'default',
			scope: ConfigurationScope.APPLICATION,
			description: localize('updateMode', "Configure whether you receive automatic updates. The updates are fetched from a Microsoft online service."),
			tags: ['usesOnlineServices'],
			enumDescriptions: [
				localize('none', "Disable updates."),
				localize('manual', "Disable automatic background update checks. Updates will be available if you manually check for updates."),
				localize('start', "Check for updates only on startup. Disable automatic background update checks."),
				localize('default', "Enable automatic update checks. Code will check for updates automatically and periodically.")
			],
			policy: {
				name: 'UpdateMode',
				category: PolicyCategory.Update,
				minimumVersion: '1.67',
				localization: {
					description: { key: 'updateMode', value: localize('updateMode', "Configure whether you receive automatic updates. The updates are fetched from a Microsoft online service."), },
					enumDescriptions: [
						{
							key: 'none',
							value: localize('none', "Disable updates."),
						},
						{
							key: 'manual',
							value: localize('manual', "Disable automatic background update checks. Updates will be available if you manually check for updates."),
						},
						{
							key: 'start',
							value: localize('start', "Check for updates only on startup. Disable automatic background update checks."),
						},
						{
							key: 'default',
							value: localize('default', "Enable automatic update checks. Code will check for updates automatically and periodically."),
						}
					]
				},
			}
		},
		'update.channel': {
			type: 'string',
			default: 'default',
			scope: ConfigurationScope.APPLICATION,
			description: localize('updateMode', "Configure whether you receive automatic updates. The updates are fetched from a Microsoft online service."),
			deprecationMessage: localize('deprecated', "This setting is deprecated, please use '{0}' instead.", 'update.mode')
		},
		// NOVEL-BUILDER: one default value. Windows background updates go off.
		// The background path installs into {app}\_ and then has inno_updater
		// rename the running exe out of the way, the new one into place, and
		// roll back if that fails (code.iss GetDestDir/GetExeBasename, gated on
		// the /update= flag doApplyUpdate passes). All three renames can lose to
		// a virus scanner holding a handle on a freshly written exe, and this
		// product's Windows chain is unsigned end to end, so that is not a rare
		// race. When it loses, the old exe is already gone and the new one never
		// lands: the install directory is left with no executable at all, the
		// Start-menu shortcut reports that the item it points to has been
		// changed or moved, and the editor cannot start to report anything. Seen
		// on 1.129.1 -> 1.134.0. With this off the pending update goes to Ready
		// instead, and doQuitAndInstall runs the installer with /silent and no
		// /update= -- IsBackgroundUpdate() is then false, Inno installs into
		// {app} directly, and inno_updater is never invoked. Slower (the author
		// restarts into a visible installer) but a failure is visible and
		// recoverable rather than silently unbootable. Not movable into an
		// extension's configurationDefaults: this property is APPLICATION-scoped
		// and configurationExtensionPoint.ts drops defaults for that scope with
		// only a warning, exactly as for security.workspace.trust.enabled.
		'update.enableWindowsBackgroundUpdates': {
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.APPLICATION,
			title: localize('enableWindowsBackgroundUpdatesTitle', "Enable Background Updates"),
			description: localize('enableWindowsBackgroundUpdates', "Enable to download and install new VS Code versions in the background."),
			included: isWindows && !isWeb
		},
		'update.showReleaseNotes': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('showReleaseNotes', "Show Release Notes after an update. The Release Notes are fetched from a Microsoft online service."),
			tags: ['usesOnlineServices'],
			agentsWindow: { default: false, readOnly: true },
		},
		'update.showPostInstallInfo': {
			type: 'boolean',
			default: false,
			experiment: { mode: 'auto' },
			scope: ConfigurationScope.APPLICATION,
			description: localize('showPostInstallInfo', "Show a post-install update tooltip in the title bar instead of opening the release notes editor."),
			tags: ['usesOnlineServices']
		},
		'update.titleBar': {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('updateTitleBar', "Show the update indicator in the title bar."),
			included: !isWeb
		}
	}
});
