/*---------------------------------------------------------------------------------------------
 *  VS Novel — reading the balance out of an entitlement response.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { balanceFrom } from '../balanceStatus';

describe('balanceFrom', () => {
	it('prefers quota_remaining, which is the key the editor itself reads', () => {
		expect(balanceFrom({ quota_snapshots: { chat: { quota_remaining: 640, remaining: 999 } } })).toBe(640);
	});

	it('falls back to remaining, so a server not yet updated still shows a number', () => {
		expect(balanceFrom({ quota_snapshots: { chat: { remaining: 99266675 } } })).toBe(99266675);
	});

	it('reads zero as a balance rather than as nothing', () => {
		// The one number an author most needs to see. `??` and `>= 0` are both
		// load-bearing here: `||` or `> 0` would hide the row exactly when the
		// account has run out.
		expect(balanceFrom({ quota_snapshots: { chat: { quota_remaining: 0 } } })).toBe(0);
	});

	it('has nothing to show when the response has no chat snapshot', () => {
		expect(balanceFrom({})).toBeUndefined();
		expect(balanceFrom({ quota_snapshots: {} })).toBeUndefined();
		expect(balanceFrom(undefined)).toBeUndefined();
	});

	it('refuses a value that is not a finite, non-negative number', () => {
		// A negative balance is reachable — a refund racing a charge — and
		// rendering "-3 credits" reads as a debt this product does not have.
		expect(balanceFrom({ quota_snapshots: { chat: { quota_remaining: -3 } } })).toBeUndefined();
		expect(balanceFrom({ quota_snapshots: { chat: { quota_remaining: Number.NaN } } })).toBeUndefined();
		expect(balanceFrom({ quota_snapshots: { chat: { quota_remaining: '640' as unknown as number } } })).toBeUndefined();
	});
});
