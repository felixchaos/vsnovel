/*---------------------------------------------------------------------------------------------
 *  VS Novel — the credit balance, in the chat status popup.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shows what the author has left, where they go looking for it.
 *
 * The popup's own quota section cannot say this. It is built around a monthly
 * allowance — it renders "N% used" against an entitlement, and when a plan has
 * no allowance at all it falls back to "Included with your organization's
 * plan", which is what this product produced: the balance travels in every
 * entitlement response and had nowhere to land. This product sells a prepaid
 * pool of credits, so there is no denominator to draw a bar against, and the
 * number an author actually wants is the one the bar cannot express.
 *
 * A contributed status item is the right shape and it is the only shape
 * available: rewriting the quota section means editing
 * workbench/contrib/chat, which this fork does not do. It is the same
 * mechanism the Codebase Semantic Index and Session Sync rows use.
 *
 * The balance is read from the entitlement endpoint rather than from anything
 * core holds: core parses that response too, but keeps the result inside
 * IChatEntitlementService with no extension-facing API, and the one field we
 * need is the one its quota model has no slot for.
 */

import * as vscode from 'vscode';
import { IExtensionContribution } from '../../extension/common/contributions';
import { ILogService } from '../../platform/log/common/logService';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { NOVEL_AUTH_PROVIDER_ID } from '../auth/novelAuthProvider';
import { accountUrl, entitlementUrl } from '../config/product';

/**
 * How often the balance is re-read while the author is at the keyboard.
 *
 * There is no event for "the popup was opened" and none for "a request was
 * billed", so this is a poll. Two minutes is chosen against what it is for: a
 * number that is two minutes stale still tells an author whether they are near
 * the end, and anything faster is a request per author per minute for a display
 * nobody is looking at most of the time.
 */
const REFRESH_INTERVAL_MS = 2 * 60 * 1000;

/** A refresh on focus is skipped if one already happened this recently. */
const FOCUS_REFRESH_FLOOR_MS = 30 * 1000;

/**
 * The shape we read out of the entitlement response.
 *
 * `quota_remaining` is what the editor's own parser reads
 * (chatEntitlementService.ts:887) and therefore what the server is known to
 * publish correctly; `remaining` is the server's older spelling for the same
 * number, still written, and read here so a server that has not been updated
 * yet still shows a balance instead of nothing.
 */
interface QuotaSnapshotBody {
	readonly quota_snapshots?: Record<string, { quota_remaining?: number; remaining?: number } | undefined>;
}

/**
 * The balance in an entitlement response, or undefined if there is not one.
 *
 * Separate from the request so the reading is testable without a server, and
 * because every branch here is a way the row can silently show a wrong number:
 * a missing snapshot, a negative balance from a race between a refund and a
 * charge, a string where a number belongs.
 */
export function balanceFrom(body: QuotaSnapshotBody | undefined): number | undefined {
	// One balance stands behind all three categories on this server, so chat is
	// read and the others are not consulted.
	const chat = body?.quota_snapshots?.['chat'];
	const remaining = chat?.quota_remaining ?? chat?.remaining;
	return typeof remaining === 'number' && Number.isFinite(remaining) && remaining >= 0
		? remaining
		: undefined;
}

export class BalanceStatusContrib extends Disposable implements IExtensionContribution {
	readonly id = 'novel.balanceStatus';

	private readonly _item: vscode.ChatStatusItem;
	private _timer: ReturnType<typeof setInterval> | undefined;
	private _lastRefreshAt = 0;
	private _shown = false;

	constructor(@ILogService private readonly _logService: ILogService) {
		super();

		this._item = this._register(vscode.window.createChatStatusItem('novel.balance'));
		this._item.title = vscode.l10n.t('Balance');
		// Hidden until there is a number. A row that says nothing is worse than
		// no row: it reads as "your balance is unavailable" on every popup.
		this._item.hide();

		this._register(vscode.authentication.onDidChangeSessions(e => {
			if (e.provider.id === NOVEL_AUTH_PROVIDER_ID) {
				void this._refresh();
			}
		}));

		this._register(vscode.window.onDidChangeWindowState(state => {
			if (state.focused && Date.now() - this._lastRefreshAt > FOCUS_REFRESH_FLOOR_MS) {
				void this._refresh();
			}
		}));

		this._timer = setInterval(() => {
			// Only while someone is here. A background window polling a billing
			// endpoint every two minutes for a popup nobody can see is pure cost.
			if (vscode.window.state.focused) {
				void this._refresh();
			}
		}, REFRESH_INTERVAL_MS);
		this._register({ dispose: () => { if (this._timer) { clearInterval(this._timer); this._timer = undefined; } } });

		void this._refresh();
	}

	private async _refresh(): Promise<void> {
		this._lastRefreshAt = Date.now();

		const balance = await this._read();
		if (balance === undefined) {
			// Only the first failure hides the row. After that the last known
			// number stays put: a balance that blinks out whenever the network
			// hiccups looks like an account problem, and it is not one.
			if (!this._shown) {
				this._item.hide();
			}
			return;
		}

		this._item.description = vscode.l10n.t('{0} credits', balance.toLocaleString());

		const account = accountUrl();
		this._item.title = account
			? { label: vscode.l10n.t('Balance'), link: account }
			: vscode.l10n.t('Balance');
		this._item.tooltip = account
			? vscode.l10n.t('Open the account page to see usage and top up.')
			: undefined;

		this._item.show();
		this._shown = true;
	}

	/** The current balance, or undefined if it could not be read. */
	private async _read(): Promise<number | undefined> {
		const url = entitlementUrl();
		if (!url) {
			return undefined;
		}

		// Silent: this runs on a timer, and a sign-in prompt raised by a
		// background poll is an interruption the author did not ask for.
		let session: vscode.AuthenticationSession | undefined;
		try {
			session = await vscode.authentication.getSession(NOVEL_AUTH_PROVIDER_ID, [], { silent: true });
		} catch (err) {
			this._logService.debug(`[novel-balance] no session: ${err}`);
			return undefined;
		}
		if (!session) {
			return undefined;
		}

		try {
			const response = await fetch(url, { headers: { Authorization: `Bearer ${session.accessToken}` } });
			if (!response.ok) {
				this._logService.debug(`[novel-balance] entitlement returned ${response.status}`);
				return undefined;
			}
			return balanceFrom(await response.json() as QuotaSnapshotBody);
		} catch (err) {
			this._logService.debug(`[novel-balance] entitlement request failed: ${err}`);
			return undefined;
		}
	}
}
