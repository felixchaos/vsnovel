/*---------------------------------------------------------------------------------------------
 *  VS Novel — tests for the ACP JSON-RPC connection.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { AcpConnection, AcpError, methodNotFound } from '../acp/connection';

function harness(options: {
	onRequest?: (method: string, params: unknown) => Promise<unknown>;
	onNotification?: (method: string, params: unknown) => void;
} = {}) {
	const written: any[] = [];
	const warnings: string[] = [];
	const closed = { count: 0 };
	const connection = new AcpConnection(
		{
			write: line => written.push(JSON.parse(line)),
			close: () => { closed.count++; },
		},
		options.onRequest ?? (method => Promise.reject(methodNotFound(method))),
		options.onNotification ?? (() => { }),
		{ warn: m => warnings.push(m) },
	);
	return { connection, written, warnings, closed };
}

/** Settle the microtasks an answer goes through before it reaches `written`. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('sending', () => {
	it('frames a request as one line of JSON-RPC', async () => {
		const { connection, written } = harness();
		void connection.request('session/new', { cwd: '/work' });
		expect(written).toEqual([
			{ jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/work' } },
		]);
	});

	it('resolves the request its id belongs to, not whichever finished first', async () => {
		// Two in flight is the normal case — a prompt streaming while the editor
		// asks for something else. Matching by arrival order returns the wrong
		// answer to the wrong caller, and the mix-up is silent.
		const { connection } = harness();
		const first = connection.request('a');
		const second = connection.request('b');
		connection.receive(JSON.stringify({ jsonrpc: '2.0', id: 2, result: 'for-b' }) + '\n');
		connection.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'for-a' }) + '\n');
		expect(await first).toBe('for-a');
		expect(await second).toBe('for-b');
	});

	it('turns a JSON-RPC error into a rejection that keeps the code', async () => {
		const { connection } = harness();
		const pending = connection.request('session/prompt');
		connection.receive(JSON.stringify({
			jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'not authenticated' },
		}) + '\n');
		const error = await pending.catch((e: unknown) => e) as AcpError;
		expect(error).toBeInstanceOf(AcpError);
		expect(error.code).toBe(-32000);
		expect(error.message).toBe('not authenticated');
	});
});

describe('receiving', () => {
	it('reassembles messages split across chunks', async () => {
		// stdout arrives in arbitrary pieces. Parsing per chunk passes every
		// small test and fails on the first long tool result.
		const { connection } = harness();
		const pending = connection.request('x');
		const line = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }) + '\n';
		for (const piece of [line.slice(0, 7), line.slice(7, 20), line.slice(20)]) {
			connection.receive(piece);
		}
		expect(await pending).toEqual({ ok: true });
	});

	it('handles several messages arriving in one chunk', async () => {
		const seen: string[] = [];
		const { connection } = harness({ onNotification: method => void seen.push(method) });
		connection.receive(
			JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {} }) + '\n' +
			JSON.stringify({ jsonrpc: '2.0', method: 'x.ai/fs_notify', params: {} }) + '\n'
		);
		expect(seen).toEqual(['session/update', 'x.ai/fs_notify']);
	});

	it('survives a line that is not JSON', async () => {
		// The agent's own diagnostics go to stderr, but a stray line on stdout
		// must cost one message, not the session the author is in the middle of.
		const { connection, warnings } = harness();
		const pending = connection.request('x');
		connection.receive('this is not json\n');
		connection.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'fine' }) + '\n');
		expect(await pending).toBe('fine');
		expect(warnings.some(w => w.includes('not JSON'))).toBe(true);
	});

	it('ignores an answer to a request it never sent', async () => {
		const { connection, warnings } = harness();
		connection.receive(JSON.stringify({ jsonrpc: '2.0', id: 99, result: 'stray' }) + '\n');
		expect(warnings.some(w => w.includes('unknown request'))).toBe(true);
	});
});

describe('requests the agent makes of us', () => {
	it('always answers, even for a method we do not implement', async () => {
		// This is the deadlock. The agent blocks on permission prompts and
		// filesystem reads; a client that stays silent looks slow rather than
		// broken, so the session simply stops with no error anywhere.
		const { connection, written } = harness();
		connection.receive(JSON.stringify({
			jsonrpc: '2.0', id: 7, method: 'fs/read_text_file', params: { path: '/x' },
		}) + '\n');
		await flush();
		expect(written).toHaveLength(1);
		expect(written[0].id).toBe(7);
		expect(written[0].error.code).toBe(-32601);
	});

	it('answers with the handler result when we do implement it', async () => {
		const { connection, written } = harness({
			onRequest: async (method, params) => {
				expect(method).toBe('session/request_permission');
				return { outcome: { outcome: 'selected', optionId: 'allow' }, echoed: params };
			},
		});
		connection.receive(JSON.stringify({
			jsonrpc: '2.0', id: 3, method: 'session/request_permission', params: { toolCall: {} },
		}) + '\n');
		await flush();
		expect(written[0]).toMatchObject({ id: 3, result: { outcome: { outcome: 'selected', optionId: 'allow' } } });
	});

	it('answers with an error when the handler throws', async () => {
		const { connection, written } = harness({
			onRequest: async () => { throw new Error('the author closed the dialog'); },
		});
		connection.receive(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'whatever' }) + '\n');
		await flush();
		expect(written[0].error.message).toBe('the author closed the dialog');
	});

	it('does not let a throwing notification handler take the connection down', async () => {
		const { connection, warnings } = harness({
			onNotification: () => { throw new Error('render failed'); },
		});
		connection.receive(JSON.stringify({ jsonrpc: '2.0', method: 'session/update' }) + '\n');
		const pending = connection.request('still-alive');
		connection.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'yes' }) + '\n');
		expect(await pending).toBe('yes');
		expect(warnings.some(w => w.includes('threw'))).toBe(true);
	});
});

describe('closing', () => {
	it('rejects everything still waiting, naming what it was waiting on', async () => {
		// Otherwise the editor keeps a spinner up forever and the author cannot
		// tell a dead agent from a slow model.
		const { connection, closed } = harness();
		const pending = connection.request('session/prompt');
		connection.close('the grok agent exited');
		const error = await pending.catch((e: unknown) => e) as Error;
		expect(error.message).toContain('the grok agent exited');
		expect(error.message).toContain('session/prompt');
		expect(closed.count).toBe(1);
	});

	it('refuses new requests once closed instead of hanging', async () => {
		const { connection } = harness();
		connection.close('gone');
		await expect(connection.request('session/new')).rejects.toThrow(/closed/);
	});

	it('is safe to close twice', async () => {
		const { connection, closed } = harness();
		connection.close('first');
		connection.close('second');
		expect(closed.count).toBe(1);
	});
});

describe('runaway output', () => {
	it('drops a buffer that grows without a newline instead of eating the heap', async () => {
		const { connection, warnings } = harness();
		const spy = vi.fn();
		connection.receive('x'.repeat(33 * 1024 * 1024));
		expect(warnings.some(w => w.includes('no newline'))).toBe(true);
		expect(spy).not.toHaveBeenCalled();
	});
});
