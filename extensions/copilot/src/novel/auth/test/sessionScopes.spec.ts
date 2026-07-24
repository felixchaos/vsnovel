/*---------------------------------------------------------------------------------------------
 *  VS Novel — the scope contract a session has to satisfy.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { GITHUB_SCOPE_ALIGNED, GITHUB_SCOPE_READ_USER, GITHUB_SCOPE_USER_EMAIL } from '../../../platform/authentication/common/authentication';
import { GRANTED_SCOPES } from '../novelAuthProvider';

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..');
const product = JSON.parse(readFileSync(join(REPO, 'product.json'), 'utf8'));

/**
 * Two vocabularies reach this provider and a single session has to satisfy both.
 *
 * Core requests what product.json declares. The extension requests GitHub's,
 * because its auth paths were written against GitHub — getAnyAuthSession tries
 * aligned, then user:email, then read:user (session.ts:72-82).
 *
 * The failure this pins down cost several rounds of manual retries to find, and
 * it is invisible from any single log line: sign-in succeeded and returned a
 * session carrying ["novel"], then VS Code immediately asked for all sessions
 * with no scopes, the provider echoed back an empty list, and that empty list is
 * what got cached. Every later request matched nothing and prompted again. The
 * editor showed "sign in", the server showed a successful verification, and
 * neither showed a fault.
 *
 * Echoing the requested scopes cannot fix it, because the caching call passes
 * none. The session has to declare what it actually carries.
 */
describe('the granted scope set', () => {

	it('covers what core asks for', () => {
		const declared: string[] = product.defaultChatAgent.providerScopes[0];
		for (const scope of declared) {
			expect(GRANTED_SCOPES, `product.json declares ${scope}`).toContain(scope);
		}
	});

	it('covers every scope set the extension asks for', () => {
		// The three the extension tries in order, before falling back to a prompt.
		for (const set of [GITHUB_SCOPE_ALIGNED, GITHUB_SCOPE_USER_EMAIL, GITHUB_SCOPE_READ_USER]) {
			for (const scope of set) {
				expect(GRANTED_SCOPES, `session.ts requests ${scope}`).toContain(scope);
			}
		}
	});

	it('is a superset, not an echo', () => {
		// The property that matters: a session built for one caller still
		// satisfies the other. An implementation that returned only what was
		// asked would pass the two tests above and still loop.
		const forCore: string[] = product.defaultChatAgent.providerScopes[0];
		for (const scope of GITHUB_SCOPE_ALIGNED) {
			expect(
				GRANTED_SCOPES.includes(scope),
				`a session created for core's scopes (${forCore.join(',')}) must still satisfy ${scope}`
			).toBe(true);
		}
	});
});
