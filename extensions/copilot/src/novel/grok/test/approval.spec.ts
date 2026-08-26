/*---------------------------------------------------------------------------------------------
 *  VS Novel — tests for how a Grok permission request is answered.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { permissionOutcome, planApproval, readPermissionRequest } from '../approval';

/** A shell approval, recorded verbatim from `grok 1.0.5`. */
const RECORDED = {
	sessionId: '01a03978-f342-72a2-8bc4-adb6e2ba1f06',
	toolCall: {
		toolCallId: 'call-1',
		kind: 'execute',
		title: 'Execute `echo NOVELPROBE`',
		rawInput: { variant: 'Bash', command: 'echo NOVELPROBE', description: 'Echo NOVELPROBE to stdout', is_background: false },
	},
	options: [
		{ optionId: 'allow-once', name: 'Yes, proceed', kind: 'allow_once' },
		{ optionId: 'reject-once', name: 'No, and tell Grok what to do differently', kind: 'reject_once' },
	],
};

describe('readPermissionRequest', () => {
	it('reads a recorded request', () => {
		expect(readPermissionRequest(RECORDED, 'fallback')).toEqual({
			title: 'Execute `echo NOVELPROBE`',
			options: RECORDED.options,
			toolKind: 'execute',
			command: 'echo NOVELPROBE',
			description: 'Echo NOVELPROBE to stdout',
		});
	});
});

describe('planApproval', () => {

	it('shows a shell command as a terminal confirmation', () => {
		// Not cosmetic: the terminal confirmation is the one the editor's own
		// terminal auto-approve list applies to.
		const plan = planApproval(readPermissionRequest(RECORDED, ''), false);
		expect(plan).toEqual({
			kind: 'ask',
			approveId: 'allow-once',
			rejectId: 'reject-once',
			confirmation: {
				title: 'Execute `echo NOVELPROBE`',
				message: 'Echo NOVELPROBE to stdout',
				confirmationType: 'terminal',
				terminalCommand: 'echo NOVELPROBE',
			},
		});
	});

	it('passes no custom buttons, so the editor may auto-confirm', () => {
		// Core sets `allowAutoConfirm: false` the moment a tool passes custom
		// buttons, because it cannot know which one means yes. Forwarding the
		// agent's own option labels would therefore disable every auto-approve
		// setting the author has — which is exactly what the first version did
		// by asking in a quick pick instead.
		const plan = planApproval(readPermissionRequest(RECORDED, ''), false);
		expect(plan.kind === 'ask' && 'buttons' in plan.confirmation).toBe(false);
	});

	it('answers allow-once itself when autopilot is on', () => {
		expect(planApproval(readPermissionRequest(RECORDED, ''), true)).toEqual({ kind: 'auto', optionId: 'allow-once' });
	});

	it('still asks under autopilot when the agent offers no allow-once', () => {
		// The agent withholds `allow_once` for steps it considers irreversible.
		// Picking `allow_always` on the author's behalf would outlive the turn,
		// which is a decision autopilot was not given.
		const irreversible = {
			toolCall: { kind: 'edit', title: 'Delete 12 files' },
			options: [
				{ optionId: 'allow-always', name: 'Always', kind: 'allow_always' },
				{ optionId: 'reject-once', name: 'No', kind: 'reject_once' },
			],
		};
		expect(planApproval(readPermissionRequest(irreversible, ''), true).kind).toBe('ask');
	});

	it('falls back to a basic confirmation for a tool that is not a command', () => {
		const plan = planApproval(readPermissionRequest({
			toolCall: { kind: 'fetch', title: 'Fetch https://example.com' },
			options: [{ optionId: 'ok', name: 'Yes', kind: 'allow_once' }],
		}, ''), false);
		expect(plan).toMatchObject({ kind: 'ask', confirmation: { confirmationType: 'basic' }, approveId: 'ok' });
	});

	it('cancels a request that offers nothing to choose', () => {
		expect(planApproval({ title: 't', options: [] }, false)).toEqual({ kind: 'cancel' });
	});

	it('is still answerable if a later agent renames its kinds', () => {
		// Silence is the one outcome that must never happen: the agent blocks
		// on this reply, with no error anywhere.
		const plan = planApproval({ title: 't', options: [{ optionId: 'first', name: 'Go' }] }, false);
		expect(plan).toMatchObject({ kind: 'ask', approveId: 'first' });
	});
});

describe('permissionOutcome', () => {
	it('reports a choice and a refusal in the shapes ACP defines', () => {
		expect(permissionOutcome('allow-once')).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } });
		expect(permissionOutcome(undefined)).toEqual({ outcome: { outcome: 'cancelled' } });
	});
});
