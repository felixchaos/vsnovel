/*---------------------------------------------------------------------------------------------
 *  VS Novel — the bootstrap endpoints, before any token exists.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { env } from 'vscode';
import { CAPIClientImpl } from '../../platform/endpoint/node/capiClientImpl';
import { IEnvService } from '../../platform/env/common/envService';
import {
	FetchOptions,
	IAbortController,
	IFetcherService,
	PaginationOptions,
	Response,
	WebSocketConnection,
	WebSocketConnectOptions
} from '../../platform/networking/common/fetcherService';

/** The prefix every account route we serve sits under. */
const COPILOT_INTERNAL = '/copilot_internal/';

/** What upstream falls back to when no token has redirected it yet. */
const UPSTREAM_DOTCOM = 'https://api.github.com';

const TOKEN_PATH = '/copilot_internal/v2/token';

/**
 * The rule, on its own so it can be asserted directly.
 *
 * Only account routes move. Everything else on the dotcom host — repository
 * lookups, code search — is genuinely GitHub's and is left where it is.
 */
export function redirectCopilotInternal(url: string, base: string): string {
	if (!url.startsWith(UPSTREAM_DOTCOM)) {
		return url;
	}
	const path = url.slice(UPSTREAM_DOTCOM.length);
	return path.startsWith(COPILOT_INTERNAL) ? `${base}${path}` : url;
}

/**
 * Our deployment's origin, taken from the one value A4 already sets.
 *
 * Derived rather than duplicated so the address stays defined in exactly one
 * place; `defaultChatAgent.tokenEntitlementUrl` minus the path the client
 * appends itself is the origin everything else hangs off.
 */
function novelApiBase(): string | undefined {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const product = require(join(env.appRoot, 'product.json'));
		const url: string | undefined = product?.defaultChatAgent?.tokenEntitlementUrl;
		if (!url || !url.endsWith(TOKEN_PATH)) {
			return undefined;
		}
		return url.slice(0, -TOKEN_PATH.length);
	} catch {
		return undefined;
	}
}

/**
 * Redirects the account requests that happen before a token exists.
 *
 * Everything *after* issuance already moves on its own: the token carries an
 * `endpoints` block, DomainService feeds it to updateDomains(), and chat,
 * completions, telemetry and origin-tracker all follow. That is upstream's own
 * escape hatch, used unchanged.
 *
 * What it cannot redirect is the request that fetches the token. That URL comes
 * from `_dotcomAPIUrl`, which starts at api.github.com and is only reassigned by
 * updateDomains — which needs a token. Left alone the chain never starts: no
 * token, so the token request goes to GitHub, which has never heard of this
 * account, so there is no token.
 *
 * Three routes that looked plausible do not work:
 *
 *  - The GHE setting. `_getDotComAPIUrl` builds `${protocol}//api.${hostname}`
 *    from it, so a gateway on 127.0.0.1:8000 becomes api.127.0.0.1:8000.
 *  - Overriding the URL getters. They live on the package's own domain service,
 *    which CAPIClient holds privately; they are not members of CAPIClient and
 *    cannot be overridden by subclassing it.
 *  - Overriding makeRequest. It resolves the URL from that same private service,
 *    so intercepting it means rebuilding the request ourselves — and the HMAC,
 *    licence and telemetry headers are mixed in by a private method we would
 *    have to reimplement and keep in step forever.
 *
 * So the interception is one level lower, at the fetcher: the package builds the
 * request completely, and only its destination is rewritten.
 *
 * Scoped to /copilot_internal/ deliberately. The dotcom URL also serves genuine
 * GitHub REST calls — repository lookups, code search — and those are not ours
 * to answer. Redirecting them would turn a feature that should simply be absent
 * into a stream of 404s against our server, and would send requests carrying an
 * author's credential somewhere neither party expects.
 */
class NovelRedirectFetcher implements IFetcherService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly _inner: IFetcherService,
		private readonly _base: string
	) { }

	get onDidFetch() { return this._inner.onDidFetch; }
	get onDidCompleteFetch() { return this._inner.onDidCompleteFetch; }

	fetch(url: string, options: FetchOptions): Promise<Response> {
		return this._inner.fetch(this._redirect(url), options);
	}

	private _redirect(url: string): string {
		return redirectCopilotInternal(url, this._base);
	}

	getUserAgentLibrary(): string { return this._inner.getUserAgentLibrary(); }
	createWebSocket(url: string, options?: WebSocketConnectOptions): WebSocketConnection {
		return this._inner.createWebSocket(this._redirect(url), options);
	}
	disconnectAll(): Promise<unknown> { return this._inner.disconnectAll(); }
	makeAbortController(): IAbortController { return this._inner.makeAbortController(); }
	isAbortError(e: unknown): boolean { return this._inner.isAbortError(e); }
	isInternetDisconnectedError(e: unknown): boolean { return this._inner.isInternetDisconnectedError(e); }
	isFetcherError(e: unknown): boolean { return this._inner.isFetcherError(e); }
	isNetworkProcessCrashedError(e: unknown): boolean { return this._inner.isNetworkProcessCrashedError(e); }
	getUserMessageForFetcherError(err: unknown): string { return this._inner.getUserMessageForFetcherError(err); }
	fetchWithPagination<T>(baseUrl: string, options: PaginationOptions<T>): Promise<T[]> {
		return this._inner.fetchWithPagination(this._redirect(baseUrl), options);
	}
}

/**
 * The CAPI client, with pre-token account requests pointed at our deployment.
 *
 * A build whose product.json carries no usable URL gets the unwrapped fetcher
 * and behaves exactly as upstream does, rather than sending requests to a base
 * of `undefined`.
 */
export class NovelCAPIClient extends CAPIClientImpl {
	constructor(
		@IFetcherService fetcherService: IFetcherService,
		@IEnvService envService: IEnvService
	) {
		const base = novelApiBase();
		super(base ? new NovelRedirectFetcher(fetcherService, base) : fetcherService, envService);
	}
}
