/*---------------------------------------------------------------------------------------------
 *  VS Novel — API client tests.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { CAPIClient } from '../capiClient';
import { DomainService } from '../domains';
import { ExtensionInfo, Fetcher, RequestMetadata, RequestType } from '../types';

const INFO: ExtensionInfo = {
	machineId: 'machine', deviceId: 'device', sessionId: 'session',
	vscodeVersion: '1.129.1', buildType: 'dev', name: 'novel-builder', version: '0.1.0',
};

/** A fetcher that records the URL and options it was given. */
function recorder() {
	const calls: { url: string; options: Record<string, unknown> }[] = [];
	const fetcher: Fetcher = {
		fetch: vi.fn(async (url, options) => { calls.push({ url, options: options as Record<string, unknown> }); return { ok: true }; }),
		createWebSocket: vi.fn((url, options) => { calls.push({ url, options: options as Record<string, unknown> }); return { socket: true }; }),
	};
	return { fetcher, calls };
}

function client(integrationId?: string, hmac?: string) {
	const { fetcher, calls } = recorder();
	return { client: new CAPIClient(INFO, undefined, fetcher, hmac, integrationId), calls };
}

/** The URL a metadata value routes to. */
async function urlFor(metadata: RequestMetadata): Promise<string> {
	const { client: c, calls } = client();
	await c.makeRequest({}, metadata);
	return calls[0].url;
}

describe('routing', () => {
	it('routes the endpoints this product actually serves', async () => {
		expect(await urlFor({ type: RequestType.CopilotToken })).toMatch(/\/copilot_internal\/v2\/token$/);
		expect(await urlFor({ type: RequestType.CopilotUserInfo })).toMatch(/\/copilot_internal\/user$/);
		expect(await urlFor({ type: RequestType.Models })).toMatch(/\/models$/);
		expect(await urlFor({ type: RequestType.ChatCompletions })).toMatch(/\/chat\/completions$/);
	});

	// The session handshake sits under /models, which is easy to get wrong and
	// fails as an empty model picker rather than as an error. See session.go.
	it('routes the auto-mode session handshake under models', async () => {
		expect(await urlFor({ type: RequestType.AutoModels })).toMatch(/\/models\/session$/);
		expect(await urlFor({ type: RequestType.ModelRouter })).toMatch(/\/models\/session\/intent$/);
	});

	it('interpolates path parameters', async () => {
		expect(await urlFor({ type: RequestType.ListModel, modelId: 'deepseek-v4-pro' })).toMatch(/\/models\/deepseek-v4-pro$/);
		expect(await urlFor({ type: RequestType.ModelPolicy, modelId: 'x' })).toMatch(/\/models\/x\/policy$/);
		expect(await urlFor({ type: RequestType.SearchSkill, slug: 'find' })).toMatch(/\/find$/);
	});

	it('builds query strings rather than concatenating them', async () => {
		const url = new URL(await urlFor({ type: RequestType.ChatAttachmentUpload, uploadName: 'a b.png', mimeType: 'image/png' }));
		expect(url.searchParams.get('name')).toBe('a b.png');
		expect(url.searchParams.get('content_type')).toBe('image/png');
	});

	it('omits the repos parameter when there are none to exclude', async () => {
		const none = new URL(await urlFor({ type: RequestType.ContentExclusion, repos: [] }));
		expect(none.searchParams.has('repos')).toBe(false);
		expect(none.searchParams.get('scope')).toBe('repo');

		const some = new URL(await urlFor({ type: RequestType.ContentExclusion, repos: ['a/b', 'c/d'] }));
		expect(some.searchParams.get('repos')).toBe('a/b,c/d');
	});

	it('picks the right agent-task shape for each action', async () => {
		expect(await urlFor({ type: RequestType.AgentTask, action: 'list' })).toMatch(/\/tasks$/);
		expect(await urlFor({ type: RequestType.AgentTask, action: 'get', taskId: 't1' })).toMatch(/\/tasks\/t1$/);
		expect(await urlFor({ type: RequestType.AgentTask, action: 'create', owner: 'o', repo: 'r' })).toMatch(/\/repos\/o\/r\/tasks$/);
	});

	// A missing parameter must fail where it is missing, not produce a URL with
	// "undefined" in it that 404s somewhere unrelated.
	it('throws on a missing path parameter instead of building a broken URL', async () => {
		const { client: c } = client();
		await expect(c.makeRequest({}, { type: RequestType.AgentTask, action: 'get' })).rejects.toThrow(/taskId is required/);
		await expect(c.makeRequest({}, { type: RequestType.AgentTask, action: 'create' })).rejects.toThrow(/owner and repo/);
	});
});

describe('headers', () => {
	it('stamps the editor identity on an identified route', async () => {
		const { client: c, calls } = client();
		await c.makeRequest({}, { type: RequestType.ChatCompletions });
		const headers = calls[0].options.headers as Record<string, string>;
		expect(headers['Editor-Version']).toBe('vscode/1.129.1');
		expect(headers['VScode-SessionId']).toBe('session');
	});

	// The token endpoint is reached before an identity exists; stamping it there
	// would be claiming one we do not have yet.
	it('leaves the token endpoint unstamped', async () => {
		const { client: c, calls } = client();
		await c.makeRequest({}, { type: RequestType.CopilotToken });
		expect(calls[0].options.headers).toBeUndefined();
	});

	it('honours suppressIntegrationId', async () => {
		const { client: c, calls } = client('novel-builder');
		await c.makeRequest({ suppressIntegrationId: true }, { type: RequestType.ChatCompletions });
		expect((calls[0].options.headers as Record<string, string>)['Copilot-Integration-Id']).toBeUndefined();
	});

	it('defaults the telemetry label to the request type', async () => {
		const { client: c, calls } = client();
		await c.makeRequest({}, { type: RequestType.Models });
		expect(calls[0].options.callSite).toBe(RequestType.Models);
	});

	it('keeps a caller-supplied telemetry label', async () => {
		const { client: c, calls } = client();
		await c.makeRequest({ callSite: 'custom' }, { type: RequestType.Models });
		expect(calls[0].options.callSite).toBe('custom');
	});
});

describe('integration id', () => {
	// These name the first-party editor to GitHub's service. Taking one would be
	// claiming to be that client.
	it('refuses the reserved ids', () => {
		const { fetcher } = recorder();
		expect(() => new CAPIClient(INFO, undefined, fetcher, undefined, 'vscode-chat')).toThrow(/reserved/);
		expect(() => new CAPIClient(INFO, undefined, fetcher, undefined, 'code-oss')).toThrow(/reserved/);
	});

	it('accepts our own', () => {
		const { fetcher } = recorder();
		expect(() => new CAPIClient(INFO, undefined, fetcher, undefined, 'novel-builder')).not.toThrow();
	});
});

describe('updateDomains', () => {
	it('repoints every plane from the token endpoints', async () => {
		const { client: c } = client();
		const changed = c.updateDomains({ endpoints: { api: 'http://127.0.0.1:8000' } }, undefined);
		expect(changed.capiUrlChanged).toBe(true);
		expect(changed.dotcomUrlChanged).toBe(false);

		const { client: c2, calls } = client();
		c2.updateDomains({ endpoints: { api: 'http://127.0.0.1:8000' } }, undefined);
		await c2.makeRequest({}, { type: RequestType.ChatCompletions });
		expect(calls[0].url).toBe('http://127.0.0.1:8000/chat/completions');
	});

	// The consumers drop different caches, so one flag per plane is the useful
	// answer rather than a single "something moved".
	it('reports per plane', () => {
		const { client: c } = client();
		const changed = c.updateDomains({ endpoints: { telemetry: 'http://t' } }, undefined);
		expect(changed).toMatchObject({ telemetryUrlChanged: true, capiUrlChanged: false, proxyUrlChanged: false });
		expect(changed.domainsChanged).toBe(true);
	});

	it('reports nothing changed when the token repeats the same endpoints', () => {
		const { client: c } = client();
		c.updateDomains({ endpoints: { api: 'http://a' } }, undefined);
		expect(c.updateDomains({ endpoints: { api: 'http://a' } }, undefined).domainsChanged).toBe(false);
	});

	it('tolerates a trailing slash', () => {
		const d = new DomainService();
		d.update({ endpoints: { api: 'http://127.0.0.1:8000/' } }, undefined);
		expect(d.capiChatURL).toBe('http://127.0.0.1:8000/chat/completions');
	});
});

describe('web socket', () => {
	it('opens against the responses endpoint and keeps the fetcher connection type', () => {
		const { client: c, calls } = client();
		// Upstream 1.134.0 made this concrete: no type argument, and the result is
		// the fetcher's connection promise rather than the connection itself.
		const connection = c.createResponsesWebSocket({ headers: {} }) as unknown as { socket: boolean };
		expect(connection.socket).toBe(true);
		expect(calls[0].url).toMatch(/\/responses$/);
	});

	it('fails loudly when the fetcher cannot open one', () => {
		const c = new CAPIClient(INFO, undefined, { fetch: async () => ({}) }, undefined, undefined);
		expect(() => c.createResponsesWebSocket({})).toThrow(/cannot open a web socket/);
	});
});
