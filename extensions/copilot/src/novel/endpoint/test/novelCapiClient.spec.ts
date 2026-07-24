/*---------------------------------------------------------------------------------------------
 *  VS Novel — the pre-token redirect rule.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { redirectCopilotInternal } from '../novelCapiClient';

const BASE = 'http://127.0.0.1:8000';

describe('the pre-token redirect', () => {

	it('moves the token request off GitHub', () => {
		// The one that matters. Left pointing at GitHub the chain never starts:
		// no token, so the token request goes to a host that has never heard of
		// this account, so there is no token.
		expect(redirectCopilotInternal('https://api.github.com/copilot_internal/v2/token', BASE))
			.toBe(`${BASE}/copilot_internal/v2/token`);
	});

	it('moves the account request', () => {
		expect(redirectCopilotInternal('https://api.github.com/copilot_internal/user', BASE))
			.toBe(`${BASE}/copilot_internal/user`);
	});

	it('leaves genuine GitHub API calls alone', () => {
		// Repository lookups and code search are GitHub's and are not ours to
		// answer. Redirecting them turns a feature that should simply be absent
		// into 404s against our server, and sends requests carrying an author's
		// credential somewhere neither party expects.
		for (const url of [
			'https://api.github.com/repos/owner/name',
			'https://api.github.com/search/code?q=x',
			'https://api.github.com/user',
		]) {
			expect(redirectCopilotInternal(url, BASE)).toBe(url);
		}
	});

	it('leaves everything not on the dotcom host alone', () => {
		// Chat and completions are already redirected by the token's endpoints
		// block. Touching them here would override that with a stale value.
		for (const url of [
			'https://api.githubcopilot.com/chat/completions',
			'https://copilot-proxy.githubusercontent.com/v1/engines/x/completions',
			`${BASE}/chat/completions`,
		]) {
			expect(redirectCopilotInternal(url, BASE)).toBe(url);
		}
	});

	it('does not match a host that merely starts the same way', () => {
		// A prefix test on a URL string treats api.github.com.evil.example as a
		// match unless the path boundary is checked.
		const url = 'https://api.github.com.evil.example/copilot_internal/v2/token';
		expect(redirectCopilotInternal(url, BASE)).toBe(url);
	});
});
