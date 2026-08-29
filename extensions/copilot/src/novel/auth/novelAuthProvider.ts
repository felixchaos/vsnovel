/*---------------------------------------------------------------------------------------------
 *  VS Novel — the product's own authentication provider.
 *--------------------------------------------------------------------------------------------*/

import {
	AuthenticationProvider,
	AuthenticationProviderAuthenticationSessionsChangeEvent,
	AuthenticationSession,
	CancellationToken,
	Disposable,
	EventEmitter,
	ProgressLocation,
	Uri,
	authentication,
	env,
	window
} from 'vscode';
import type { ExtensionContext, LogOutputChannel } from 'vscode';
import { entitlementUrl, serverOrigin } from '../config/product';

/**
 * Must equal `defaultChatAgent.provider.default.id` in product.json.
 *
 * VS Code core resolves the provider by this string and activates whichever
 * extension contributes it (authenticationService.ts:313), so a mismatch is not
 * a type error — it is a sign-in that reports "no authentication provider is
 * currently registered" at runtime. `trustedExtensionAuthAccess` is keyed by the
 * same value, so it has to move with it.
 */
export const NOVEL_AUTH_PROVIDER_ID = 'novel-builder';
const NOVEL_AUTH_PROVIDER_LABEL = 'VS Novel';

/**
 * Every scope any caller asks this provider for.
 *
 * Two vocabularies reach us and neither is negotiable. Core requests what
 * product.json declares in `providerScopes` — `novel`. The extension requests
 * GitHub's, because its own auth paths were written against GitHub and ask for
 * `read:user`, `user:email`, `repo` and `workflow` (session.ts:72-82).
 *
 * A session reports the scopes it carries, and VS Code matches a request
 * against that list. One session cannot satisfy both vocabularies by echoing
 * whichever was asked: the list is also what gets cached when VS Code asks for
 * all sessions with no scopes at all, and that cached list is what later
 * queries are matched against. Echoing produced exactly that failure — sign-in
 * succeeded, the very next `getSessions(undefined)` reported an empty scope
 * list, and every subsequent request found no match and prompted again.
 *
 * So the session declares the superset. That is honest rather than convenient:
 * the credential is not scoped at all. The server decides what it may do per
 * route — the account endpoint accepts it, streaming does not — and that
 * decision reads nothing the client says about scopes. There is no narrower
 * truth being hidden here.
 *
 * When a real scope model exists, this stops being a constant and starts being
 * what the server granted.
 */
export const GRANTED_SCOPES = ['novel', 'read:user', 'user:email', 'repo', 'workflow'];

/** Where the credential is kept. SecretStorage, never globalState. */
const SECRET_KEY = 'novel-builder.credential';
const ACCOUNT_KEY = 'novel-builder.account';

interface StoredAccount {
	readonly id: string;
	readonly label: string;
}

/**
 * Authenticates an author against novel-server.
 *
 * Sign-in is browser-assisted: the editor opens the account page, the author
 * signs in there through the identity provider, and the server hands a
 * credential back to the editor, which stores it in SecretStorage. The editor
 * never shows a password box and never sees the provider token — it starts a
 * link, opens the browser, and polls for the credential (see `_browserSignIn`).
 * Pasting a key by hand is kept as a fallback, for a machine principal or an
 * author behind something the browser flow cannot cross.
 *
 * The session's `accessToken` is the credential itself, not a short-lived token.
 * That is deliberate and is what the server's contract expects: VS Code core
 * reads the entitlement URL with `Bearer <session.accessToken>` and has no way
 * to mint a session token first, while the extension exchanges the same string
 * at /copilot_internal/v2/token for the token it uses on the streaming path.
 * The server accepts the credential on the account endpoint and refuses it
 * everywhere else, so handing it out here does not widen what it can do.
 */
export class NovelAuthenticationProvider implements AuthenticationProvider {

	private readonly _onDidChangeSessions =
		new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	private readonly _disposables: Disposable[] = [];

	/**
	 * Plain constructor, no dependency injection.
	 *
	 * This provider has to be registered before the extension's DI container
	 * exists. `$ensureProvider` on the main thread activates the extension that
	 * declares a provider id and waits for that activation to finish; if the
	 * registration happens inside a contribution, the wait is on an activation
	 * that is itself blocked waiting for the auth service, and neither side ever
	 * moves. Registering first, from the raw ExtensionContext, is what breaks
	 * that cycle — so the injected services are not available here by
	 * construction.
	 */
	constructor(
		private readonly _context: ExtensionContext,
		private readonly _log: LogOutputChannel,
	) {
		this._disposables.push(
			authentication.registerAuthenticationProvider(
				NOVEL_AUTH_PROVIDER_ID,
				NOVEL_AUTH_PROVIDER_LABEL,
				this,
				{ supportsMultipleAccounts: false }
			)
		);

		// Logged at registration rather than at first use. The packaged smoke test
		// needs evidence that this provider exists, and every other line in this
		// file waits for core to ask us something — which is timing, not a fact
		// about the build. An assertion that fails on a correct build is worse
		// than no assertion: it teaches you to ignore it.
		this._log.info(`[novel-auth] registered provider '${NOVEL_AUTH_PROVIDER_ID}' (${NOVEL_AUTH_PROVIDER_LABEL})`);

		// A credential removed in another window is gone here too. Without this
		// the two windows disagree about whether the author is signed in, and
		// the stale one keeps making calls that 401.
		this._disposables.push(
			this._context.secrets.onDidChange(async e => {
				if (e.key !== SECRET_KEY) {
					return;
				}
				const stored = await this._context.secrets.get(SECRET_KEY);
				if (!stored) {
					this._onDidChangeSessions.fire({ added: [], removed: [], changed: [] });
				}
			})
		);
	}

	/**
	 * The session is reported as carrying whatever scopes were asked for.
	 *
	 * Core filters the returned sessions against the requested scopes, so a
	 * session declaring an empty list never matches anything and every caller
	 * falls through to createSession — the author is asked to sign in again on
	 * each request while a perfectly good credential sits in storage.
	 *
	 * Claiming the requested scopes is honest here because there are none to
	 * withhold: the credential is not scoped. The server decides what it may do,
	 * and it makes that decision per route rather than from anything the client
	 * says. When a real scope model exists this has to narrow to what was
	 * actually granted.
	 */
	async getSessions(scopes: readonly string[] | undefined): Promise<AuthenticationSession[]> {
		const credential = await this._context.secrets.get(SECRET_KEY);
		// Only the scoped queries are logged. The unscoped one is core polling for
		// accounts several times a second, and a line each time buries everything
		// else; the scoped ones happen a handful of times per sign-in and are the
		// ones that decide whether a caller finds a session.
		this._log.info(`[novel-auth] getSessions(${JSON.stringify(scopes)}) -> ${credential ? 'one' : 'none'}`);
		if (!credential) {
			return [];
		}
		return [this._session(credential, this._readAccount(), scopes)];
	}

	async createSession(scopes: readonly string[]): Promise<AuthenticationSession> {
		this._log.info(`[novel-auth] createSession(${JSON.stringify(scopes)}) - prompting`);

		const pick = await window.showQuickPick(
			[
				{ label: '$(globe) 用浏览器登录', description: '推荐', method: 'browser' as const },
				{ label: '$(key) 粘贴访问密钥', method: 'paste' as const }
			],
			{ title: NOVEL_AUTH_PROVIDER_LABEL, placeHolder: '选择登录方式' }
		);
		if (!pick) {
			throw new Error('Cancelled');
		}

		const credential = pick.method === 'browser'
			? await this._browserSignIn()
			: await this._pasteKey();

		this._log.info(`[novel-auth] got credential (${pick.method}), length=${credential.length}, verifying`);
		const account = await this._verify(credential);
		this._log.info(`[novel-auth] verified: ${JSON.stringify(account)}`);

		await this._context.secrets.store(SECRET_KEY, credential);
		const readBack = await this._context.secrets.get(SECRET_KEY);
		this._log.info(`[novel-auth] stored; read-back ${readBack ? 'OK' : 'FAILED - secret storage did not keep it'}`);
		await this._context.globalState.update(ACCOUNT_KEY, account);

		const session = this._session(credential, account, scopes);
		this._log.info(`[novel-auth] createSession OK id=${session.id} scopes=${JSON.stringify(session.scopes)}`);
		this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
		return session;
	}

	/** The fallback: paste an `nvl_` key. Kept for machine principals. */
	private async _pasteKey(): Promise<string> {
		const credential = await window.showInputBox({
			title: NOVEL_AUTH_PROVIDER_LABEL,
			prompt: 'Paste your VS Novel access key',
			placeHolder: 'nvl_…',
			ignoreFocusOut: true,
			password: true,
			validateInput: value => value.trim() ? undefined : 'An access key is required'
		});
		if (!credential) {
			// Cancellation, not failure. Throwing anything else surfaces an error
			// notification for someone who simply pressed Escape.
			throw new Error('Cancelled');
		}
		return credential.trim();
	}

	/**
	 * The browser-assisted flow.
	 *
	 * The editor asks the server to open a pending sign-in, opens the account
	 * page pointed at it, and polls until the page — having signed the author in —
	 * leaves a credential there. Nothing here handles a provider token or a
	 * redirect: all of that stays in the browser and on the server, which is what
	 * lets this work in a rebranded build without an OAuth client of its own.
	 *
	 * The link id is the only secret and it never leaves this machine and the
	 * author's browser. The poll uses global fetch for the same reason `_verify`
	 * does: this provider is created before the DI container that owns the
	 * fetcher service.
	 */
	private async _browserSignIn(): Promise<string> {
		const origin = this._serverOrigin();
		if (!origin) {
			throw new Error('This build has no server URL configured, so it cannot open sign-in.');
		}

		let linkId: string;
		let verifyPath: string;
		try {
			const res = await fetch(`${origin}/account/api/link/start`, { method: 'POST' });
			if (!res.ok) {
				throw new Error(`start responded ${res.status}`);
			}
			const body = await res.json() as { link_id?: string; verify_path?: string };
			if (!body.link_id || !body.verify_path) {
				throw new Error('start returned no link');
			}
			linkId = body.link_id;
			verifyPath = body.verify_path;
		} catch (err) {
			this._log.error('[novel-auth] link/start failed', err);
			throw new Error('Could not reach VS Novel to start sign-in. Check your connection and try again.');
		}

		await env.openExternal(Uri.parse(`${origin}${verifyPath}`));

		return await window.withProgress(
			{ location: ProgressLocation.Notification, title: '在浏览器中登录 VS Novel…', cancellable: true },
			async (_progress, token) => {
				// The account page's link has its own, longer, expiry; the editor
				// gives up first so a walked-away sign-in does not spin forever.
				const deadline = Date.now() + 5 * 60 * 1000;
				while (Date.now() < deadline) {
					if (token.isCancellationRequested) {
						throw new Error('Cancelled');
					}
					await delay(2000, token);
					let status: string | undefined;
					let credential: string | undefined;
					try {
						const res = await fetch(`${origin}/account/api/link/poll?id=${encodeURIComponent(linkId)}`);
						if (!res.ok) {
							continue; // transient; keep polling
						}
						const body = await res.json() as { status?: string; credential?: string };
						status = body.status;
						credential = body.credential;
					} catch {
						continue; // network blip; keep polling
					}
					if (status === 'approved' && credential) {
						return credential;
					}
					if (status === 'expired') {
						throw new Error('登录已超时，请重试。');
					}
				}
				throw new Error('登录已超时，请重试。');
			}
		);
	}

	/** The server's public origin, derived from the entitlement URL. */
	private _serverOrigin(): string | undefined {
		return serverOrigin();
	}

	async removeSession(sessionId: string): Promise<void> {
		const credential = await this._context.secrets.get(SECRET_KEY);
		if (!credential) {
			return;
		}
		const removed = this._session(credential, this._readAccount());
		if (removed.id !== sessionId) {
			return;
		}
		await this._context.secrets.delete(SECRET_KEY);
		await this._context.globalState.update(ACCOUNT_KEY, undefined);
		this._onDidChangeSessions.fire({ added: [], removed: [removed], changed: [] });
	}

	dispose(): void {
		this._onDidChangeSessions.dispose();
		for (const d of this._disposables) {
			d.dispose();
		}
	}

	/**
	 * Confirms the credential before storing it.
	 *
	 * Storing first and discovering later produces the worst state to be in: the
	 * editor believes the author is signed in, every request 401s, and nothing
	 * offers to sign in again because a session already exists.
	 */
	private async _verify(credential: string): Promise<StoredAccount> {
		const url = entitlementUrl();
		this._log.info(`[novel-auth] entitlementUrl = ${url ?? '(none - product.json unreadable)'}`);
		if (!url) {
			throw new Error('This build has no entitlement URL configured, so the key cannot be checked.');
		}

		// Through the fetcher service, not global fetch: it carries the proxy and
		// certificate configuration an author behind a corporate network depends
		// on, and it is what the rest of the extension is exercised against.
		let response: { readonly status: number; readonly ok: boolean; json(): Promise<unknown> };
		try {
			// Global fetch, not IFetcherService: that service lives in the DI
			// container this provider is deliberately created before. One request,
			// once per sign-in. An author behind a proxy that only IFetcherService
			// knows about would fail here — recorded as a known gap rather than
			// hidden, because fixing it means finding another way to break the
			// activation cycle.
			response = await fetch(url, { headers: { Authorization: `Bearer ${credential}` } });
		} catch (err) {
			this._log.error('[novel-auth] entitlement request failed', err);
			throw new Error('Could not reach VS Novel. Check your connection and try again.');
		}

		this._log.info(`[novel-auth] entitlement responded ${response.status}`);
		if (response.status === 401 || response.status === 403) {
			throw new Error('That access key was not accepted.');
		}
		if (!response.ok) {
			// Distinguished from a bad key on purpose. Telling an author their
			// key is wrong when the service is down sends them to reissue a
			// perfectly good one.
			this._log.warn(`[novel-auth] entitlement returned ${response.status}`);
			throw new Error('VS Novel is not responding right now. Try again shortly.');
		}

		// The account view is presentation only here; a body we cannot read is not
		// a reason to reject a key the server just accepted.
		let body: { analytics_tracking_id?: string; copilot_plan?: string } = {};
		try {
			body = await response.json() as typeof body;
		} catch (err) {
			this._log.warn(`[novel-auth] entitlement body unreadable: ${err}`);
		}
		const id = body.analytics_tracking_id ?? 'novel-builder';
		return { id, label: body.copilot_plan ? `VS Novel (${body.copilot_plan})` : NOVEL_AUTH_PROVIDER_LABEL };
	}

	private _readAccount(): StoredAccount {
		return this._context.globalState.get<StoredAccount>(ACCOUNT_KEY)
			?? { id: 'novel-builder', label: NOVEL_AUTH_PROVIDER_LABEL };
	}

	/**
	 * The session id is derived from the account rather than randomised, so the
	 * same credential yields the same id across windows and restarts. A fresh id
	 * per call makes removeSession unable to match, and core's session
	 * bookkeeping treats every read as a different account.
	 */
	private _session(credential: string, account: StoredAccount, scopes?: readonly string[]): AuthenticationSession {
		// Always the superset, never the requested list. See GRANTED_SCOPES.
		const declared = [...new Set([...GRANTED_SCOPES, ...(scopes ?? [])])];
		return {
			id: `${NOVEL_AUTH_PROVIDER_ID}:${account.id}`,
			accessToken: credential,
			account: { id: account.id, label: account.label },
			scopes: declared
		};
	}
}

/** A cancellable sleep, so a polling loop wakes early when the author cancels. */
function delay(ms: number, token?: CancellationToken): Promise<void> {
	return new Promise<void>(resolve => {
		const timer = setTimeout(resolve, ms);
		if (token) {
			token.onCancellationRequested(() => {
				clearTimeout(timer);
				resolve();
			});
		}
	});
}
