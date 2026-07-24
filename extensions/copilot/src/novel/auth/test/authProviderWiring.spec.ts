/*---------------------------------------------------------------------------------------------
 *  VS Novel — the provider id has to agree in four places.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { AuthProviderId } from '../../../platform/configuration/common/configurationService';
import { NOVEL_AUTH_PROVIDER_ID } from '../novelAuthProvider';

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..');
const product = JSON.parse(readFileSync(join(REPO, 'product.json'), 'utf8'));

/**
 * Four places name the authentication provider, and none of them check each
 * other. Every mismatch fails at sign-in, at runtime, with a message about a
 * provider that "is not currently registered" — nothing about it is a type
 * error, and nothing about it shows up in a build.
 *
 * The pieces:
 *   - the id our provider registers under (novelAuthProvider.ts)
 *   - the enum member authProviderId() returns (configurationService.ts)
 *   - product.json's defaultChatAgent.provider.default.id, which is what core
 *     passes to createSession
 *   - the key of trustedExtensionAuthAccess, which is what suppresses a consent
 *     prompt for the product's own account
 */
describe('the authentication provider id', () => {

	it('is the same string in the provider and the enum', () => {
		expect(AuthProviderId.NovelBuilder).toBe(NOVEL_AUTH_PROVIDER_ID);
	});

	it('is what core will ask for', () => {
		// core: authentication.createSession(provider.default.id, scopes)
		expect(product.defaultChatAgent?.provider?.default?.id).toBe(NOVEL_AUTH_PROVIDER_ID);
	});

	it('is the key trustedExtensionAuthAccess is stored under', () => {
		// Keyed by provider id (authenticationAccessService.ts:51). Left on the
		// old key, the extension is prompted for consent to reach its own
		// product's account.
		const trusted = product.trustedExtensionAuthAccess;
		expect(Array.isArray(trusted)).toBe(false);
		expect(Object.keys(trusted)).toContain(NOVEL_AUTH_PROVIDER_ID);
		expect(trusted[NOVEL_AUTH_PROVIDER_ID]).toContain(product.defaultChatAgent.chatExtensionId);
	});

	it('is not GitHub any more', () => {
		// The point of A2. If this ever reads 'github' again, the extension is
		// asking a provider we do not implement for a session we cannot issue.
		expect(NOVEL_AUTH_PROVIDER_ID).not.toBe(AuthProviderId.GitHub);
		expect(product.defaultChatAgent.provider.default.id).not.toBe('github');
		expect(Object.keys(product.trustedExtensionAuthAccess)).not.toContain('github');
	});
});

/**
 * The provider sub-objects core dereferences without a guard.
 *
 * chatSetupRunner.ts:265 reads provider.google.name, and the `??` fallback one
 * line above fires only when the whole `provider` object is missing. Deleting a
 * sub-object that nothing can select therefore throws a TypeError and takes the
 * setup dialog with it, rather than quietly hiding a button.
 */
describe('product.json chat agent configuration', () => {

	it('keeps all four provider sub-objects', () => {
		expect(Object.keys(product.defaultChatAgent.provider).sort())
			.toEqual(['apple', 'default', 'enterprise', 'google']);
		for (const key of ['default', 'enterprise', 'google', 'apple']) {
			expect(product.defaultChatAgent.provider[key]?.name).toBeTruthy();
		}
	});

	it('points every entitlement URL at one origin', () => {
		// The client uses `api` for both /models and /chat/completions, which sit
		// on different planes. One origin fronting both is the only shape that
		// works; two origins here means one of them is a plane, and half the
		// requests 404.
		const urls = [
			product.defaultChatAgent.entitlementUrl,
			product.defaultChatAgent.tokenEntitlementUrl,
			product.defaultChatAgent.entitlementSignupLimitedUrl,
			product.defaultChatAgent.mcpRegistryDataUrl,
			product.defaultChatAgent.managedSettingsUrl,
		];
		for (const u of urls) {
			expect(u, 'every entitlement URL must be set').toBeTruthy();
			expect(u, `${u} still points at GitHub`).not.toContain('github.com');
		}
		const origins = new Set(urls.map(u => new URL(u).origin));
		expect(origins.size, `expected one origin, got ${[...origins].join(', ')}`).toBe(1);
	});

	it('still lists the chat extension as a built-in with auto-updates', () => {
		// Absent, chatSetupController's unconditional install() resolves nothing
		// and the setup dialog retries forever
		// (extensionsWorkbenchService.ts:2650-2727).
		expect(product.builtInExtensionsEnabledWithAutoUpdates)
			.toContain(product.defaultChatAgent.chatExtensionId);
	});
});
