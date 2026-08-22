/*---------------------------------------------------------------------------------------------
 *  VS Novel — tests for the grok agent session.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { GrokAgentProcess } from '../agentProcess';
import { GrokAgentSession, GrokNotAuthenticated, ResponseSink } from '../session';

/**
 * A process that answers scripted replies.
 *
 * `replies` maps a method to what the agent sends back; anything unscripted is
 * left unanswered on purpose, so a test that expects an answer hangs visibly
 * rather than passing on a wrong assumption.
 */
function fakeProcess(replies: Record<string, unknown>) {
	let lineListener: ((chunk: string) => void) | undefined;
	let exitListener: ((reason: string) => void) | undefined;
	const sent: any[] = [];

	const emit = (message: unknown) => lineListener?.(JSON.stringify(message) + '\n');

	const process: GrokAgentProcess = {
		onLine: listener => { lineListener = listener; },
		onExit: listener => { exitListener = listener; },
		write: line => {
			const message = JSON.parse(line);
			sent.push(message);
			if (message.id !== undefined && message.method in replies) {
				const reply = replies[message.method];
				queueMicrotask(() => emit(
					reply instanceof Error
						? { jsonrpc: '2.0', id: message.id, error: { code: -32000, message: reply.message } }
						: { jsonrpc: '2.0', id: message.id, result: reply }
				));
			}
		},
		kill: () => { },
	};

	return { process, sent, emit, exit: (reason: string) => exitListener?.(reason) };
}

const log = { info: () => { }, warn: () => { } };
const denyAll = async () => undefined;

function sink() {
	const text: string[] = [];
	const thoughts: string[] = [];
	const progress: string[] = [];
	const s: ResponseSink = {
		text: v => void text.push(v),
		thought: v => void thoughts.push(v),
		progress: v => void progress.push(v),
	};
	return { sink: s, text, thoughts, progress };
}

const HANDSHAKE = {
	initialize: { protocolVersion: 1, authMethods: [{ id: 'grok.com', name: 'Grok' }] },
	'session/new': {
		sessionId: 'sess-1',
		models: { currentModelId: 'grok-4.6', availableModels: [{ modelId: 'grok-4.6', name: 'Grok 4.6' }] },
	},
};

describe('starting', () => {
	it('opens a session and reports the models the agent offered', async () => {
		const { process, sent } = fakeProcess(HANDSHAKE);
		const session = await GrokAgentSession.start({ process, cwd: '/work', log, onPermission: denyAll });
		expect(session.sessionId).toBe('sess-1');
		expect(session.currentModelId).toBe('grok-4.6');
		expect(session.models.map(m => m.modelId)).toEqual(['grok-4.6']);
		expect(sent.map(m => m.method)).toEqual(['initialize', 'session/new']);
	});

	it('advertises no capability it has not implemented', async () => {
		// Claiming filesystem support makes the agent delegate reads to us and
		// then wait for an answer that never comes.
		const { process, sent } = fakeProcess(HANDSHAKE);
		await GrokAgentSession.start({ process, cwd: '/work', log, onPermission: denyAll });
		expect(sent[0].params.clientCapabilities).toEqual({ fs: { readTextFile: false, writeTextFile: false } });
	});

	it('tells a missing sign-in apart from every other failure', async () => {
		// The only failure with an action attached. Conflating it with the rest
		// puts a sign-in button in front of someone whose wifi dropped.
		const { process } = fakeProcess({ ...HANDSHAKE, 'session/new': new Error('authentication required') });
		const error = await GrokAgentSession.start({ process, cwd: '/work', log, onPermission: denyAll })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(GrokNotAuthenticated);
		expect((error as GrokNotAuthenticated).authMethods.map(m => m.id)).toEqual(['grok.com']);
	});

	it('refuses a session the agent opened without an id', async () => {
		const { process } = fakeProcess({ ...HANDSHAKE, 'session/new': { models: {} } });
		await expect(GrokAgentSession.start({ process, cwd: '/work', log, onPermission: denyAll }))
			.rejects.toThrow(/without giving it an id/);
	});
});

describe('streaming a turn', () => {
	it('reads the kind and the text from where the agent actually puts them', async () => {
		// `params.update.sessionUpdate`, not `params.sessionUpdate`. The second
		// is what the documented table reads like, matches nothing, and produces
		// an empty answer with no error anywhere.
		const { process, emit } = fakeProcess(HANDSHAKE);
		const session = await GrokAgentSession.start({ process, cwd: '/work', log, onPermission: denyAll });
		const out = sink();

		const turn = session.prompt('写一句', out.sink, () => false);
		for (const [kind, text] of [['agent_thought_chunk', 'The'], ['agent_message_chunk', '我'], ['agent_message_chunk', '是']] as const) {
			emit({
				jsonrpc: '2.0', method: 'session/update',
				params: { sessionId: 'sess-1', update: { sessionUpdate: kind, content: { type: 'text', text } } },
			});
		}
		emit({ jsonrpc: '2.0', id: 3, result: { stopReason: 'end_turn' } });

		expect(await turn).toBe('end_turn');
		expect(out.text.join('')).toBe('我是');
		expect(out.thoughts.join('')).toBe('The');
	});

	it('takes the title the agent assigns after the turn', async () => {
		const titles: string[] = [];
		const { process, emit } = fakeProcess(HANDSHAKE);
		const session = await GrokAgentSession.start({
			process, cwd: '/work', log, onPermission: denyAll, onTitle: t => void titles.push(t),
		});
		emit({
			jsonrpc: '2.0', method: 'session/update',
			params: { sessionId: 'sess-1', update: { sessionUpdate: 'session_info_update', title: '银月庭章程' } },
		});
		await new Promise(r => setTimeout(r, 0));
		expect(titles).toEqual(['银月庭章程']);
		expect(session.title).toBe('银月庭章程');
	});

	it('ignores update kinds it has no place to put', async () => {
		// `user_message_chunk`, `available_commands_update`, `plan`, and whatever
		// a later agent version adds. An unknown kind must stay harmless.
		const { process, emit } = fakeProcess(HANDSHAKE);
		const session = await GrokAgentSession.start({ process, cwd: '/work', log, onPermission: denyAll });
		const out = sink();
		const turn = session.prompt('x', out.sink, () => false);
		for (const kind of ['user_message_chunk', 'available_commands_update', 'plan', 'something_from_2027']) {
			emit({
				jsonrpc: '2.0', method: 'session/update',
				params: { sessionId: 'sess-1', update: { sessionUpdate: kind, content: { text: 'noise' } } },
			});
		}
		emit({ jsonrpc: '2.0', id: 3, result: { stopReason: 'end_turn' } });
		await turn;
		expect(out.text).toEqual([]);
	});

	it('fails the turn when the agent dies mid-stream', async () => {
		// Otherwise the editor keeps a spinner up and the author cannot tell a
		// dead agent from a slow model.
		const { process, exit } = fakeProcess(HANDSHAKE);
		const session = await GrokAgentSession.start({ process, cwd: '/work', log, onPermission: denyAll });
		const turn = session.prompt('x', sink().sink, () => false);
		exit('the grok agent exited with code 1');
		await expect(turn).rejects.toThrow(/exited with code 1/);
	});
});

describe('permission', () => {
	it('answers with the option the author picked', async () => {
		const { process, emit, sent } = fakeProcess(HANDSHAKE);
		const seen: string[] = [];
		await GrokAgentSession.start({
			process, cwd: '/work', log,
			onPermission: async request => { seen.push(request.title); return 'allow-once'; },
		});
		emit({
			jsonrpc: '2.0', id: 100, method: 'session/request_permission',
			params: { toolCall: { title: '写入 第一章.md' }, options: [{ optionId: 'allow-once', name: '允许一次' }] },
		});
		await new Promise(r => setTimeout(r, 0));
		expect(seen).toEqual(['写入 第一章.md']);
		expect(sent.find(m => m.id === 100)?.result).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } });
	});

	it('answers cancelled when the author declines, rather than staying silent', async () => {
		// Silence here is the deadlock: the agent waits on this reply forever.
		const { process, emit, sent } = fakeProcess(HANDSHAKE);
		await GrokAgentSession.start({ process, cwd: '/work', log, onPermission: denyAll });
		emit({
			jsonrpc: '2.0', id: 101, method: 'session/request_permission',
			params: { toolCall: { title: '删除文件' }, options: [] },
		});
		await new Promise(r => setTimeout(r, 0));
		expect(sent.find(m => m.id === 101)?.result).toEqual({ outcome: { outcome: 'cancelled' } });
	});

	it('answers method-not-found for anything else it is asked', async () => {
		const { process, emit, sent } = fakeProcess(HANDSHAKE);
		await GrokAgentSession.start({ process, cwd: '/work', log, onPermission: denyAll });
		emit({ jsonrpc: '2.0', id: 102, method: 'fs/read_text_file', params: { path: '/x' } });
		await new Promise(r => setTimeout(r, 0));
		expect(sent.find(m => m.id === 102)?.error?.code).toBe(-32601);
	});
});
