/*---------------------------------------------------------------------------------------------
 *  VS Novel — tests for rebuilding a transcript from the agent's replay.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { foldReplay } from '../history';

/**
 * A recorded replay from `grok 1.0.5`.
 *
 * Copied off the wire after `session/load` on a real two-turn session, with the
 * bookkeeping updates kept in — they are most of what arrives, and dropping them
 * from the fixture would test a stream that never occurs.
 */
const RECORDED = [
	{ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Run the shell command `echo NOVELPROBE`.' }, _meta: { promptIndex: 0 } },
	{ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'The user wants me to run a simple shell command.' } },
	{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: "I'll run that command now." } },
	{ sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'Execute `echo NOVELPROBE`', kind: 'execute', status: 'pending' },
	{ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed' },
	{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '\n\nOutput: NOVELPROBE' } },
	{ sessionUpdate: 'turn_completed', prompt_id: 'p1', stop_reason: 'end_turn' },
	{ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'What was the output?' }, _meta: { promptIndex: 1 } },
	{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Output was NOVELPROBE' } },
	{ sessionUpdate: 'turn_completed', prompt_id: 'p2', stop_reason: 'end_turn' },
	{ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact' }] },
	{ sessionUpdate: 'model_changed', model_id: 'grok-4.6', reasoning_effort: 'high' },
];

describe('foldReplay', () => {

	it('rebuilds a recorded two-turn conversation', () => {
		expect(foldReplay(RECORDED)).toEqual([
			{ kind: 'request', text: 'Run the shell command `echo NOVELPROBE`.' },
			{
				kind: 'response', parts: [
					{ kind: 'markdown', text: "I'll run that command now." },
					{ kind: 'tool', id: 'call-1', title: 'Execute `echo NOVELPROBE`', status: 'completed' },
					{ kind: 'markdown', text: '\n\nOutput: NOVELPROBE' },
				]
			},
			{ kind: 'request', text: 'What was the output?' },
			{ kind: 'response', parts: [{ kind: 'markdown', text: 'Output was NOVELPROBE' }] },
		]);
	});

	it('renders one tool call once, at the point it started', () => {
		// The agent sends `tool_call` and then several `tool_call_update`s for
		// the same call. Appending each would show the same command four times,
		// with only the last one true.
		const turns = foldReplay(RECORDED) as Array<{ kind: string; parts?: Array<{ kind: string }> }>;
		const tools = turns[1].parts!.filter(part => part.kind === 'tool');
		expect(tools).toHaveLength(1);
	});

	it('accumulates a token-by-token stream the same as a coalesced one', () => {
		// Replay arrives as whole messages; the live stream arrives a token at a
		// time. One fold has to serve both, or the transcript written during a
		// session and the one read back after a reload disagree.
		const streamed = [
			{ sessionUpdate: 'user_message_chunk', content: { text: '写' } },
			{ sessionUpdate: 'user_message_chunk', content: { text: '一句' } },
			{ sessionUpdate: 'agent_message_chunk', content: { text: '雪' } },
			{ sessionUpdate: 'agent_message_chunk', content: { text: '停了' } },
			{ sessionUpdate: 'turn_completed' },
		];
		expect(foldReplay(streamed)).toEqual([
			{ kind: 'request', text: '写一句' },
			{ kind: 'response', parts: [{ kind: 'markdown', text: '雪停了' }] },
		]);
	});

	it('drops thoughts', () => {
		const turns = foldReplay(RECORDED);
		expect(JSON.stringify(turns)).not.toContain('simple shell command');
	});

	it('closes an unterminated turn rather than losing it', () => {
		// A session interrupted mid-answer still has an answer worth reading.
		expect(foldReplay([
			{ sessionUpdate: 'user_message_chunk', content: { text: 'q' } },
			{ sessionUpdate: 'agent_message_chunk', content: { text: 'partial' } },
		])).toEqual([
			{ kind: 'request', text: 'q' },
			{ kind: 'response', parts: [{ kind: 'markdown', text: 'partial' }] },
		]);
	});

	it('ignores a kind it has never seen', () => {
		expect(foldReplay([{ sessionUpdate: 'something_a_later_agent_adds' }, undefined, {}])).toEqual([]);
	});
});
