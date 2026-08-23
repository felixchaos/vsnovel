/*---------------------------------------------------------------------------------------------
 *  VS Novel — the API client.
 *--------------------------------------------------------------------------------------------*/

/**
 * Routes a typed request to a URL and sends it.
 *
 * The class the extension's own `BaseCAPIClientService` extends. Its whole job
 * is the switch in {@link makeRequest}: turn a {@link RequestType} plus its path
 * parameters into a URL, stamp the identity headers, and hand the result to the
 * fetcher. Everything above it — retries, accounting, streaming, cancellation —
 * belongs to the layers that wrap it.
 *
 * One deliberate simplification against the package this replaces: there is no
 * licence-agreement check. That gate existed to decide which integration id
 * GitHub's own service would accept. This client talks to novel-server, which
 * makes that decision from the credential, so carrying a copy of the check would
 * be enforcing someone else's terms against ourselves.
 */

import { DomainService } from './domains';
import {
	ExtensionInfo, Fetcher, FetchOptions, IDomainChangeResponse, MakeRequestOptions, RequestMetadata, RequestType,
	type CopilotToken,
} from './types';

/**
 * Request types that carry the editor identity headers.
 *
 * Not every route wants them: the token endpoints are reached before an identity
 * is established, and the origin tracker is a different service entirely.
 */
const IDENTIFIED: ReadonlySet<RequestType> = new Set([
	RequestType.ChatCompletions, RequestType.ChatResponses, RequestType.ChatMessages,
	RequestType.CAPIEmbeddings, RequestType.Models, RequestType.ListModel, RequestType.ModelPolicy,
	RequestType.AutoModels, RequestType.ModelRouter, RequestType.CCAModelsList,
	RequestType.RemoteAgent, RequestType.RemoteAgentChat, RequestType.CodeReviewAgent,
	RequestType.ListSkills, RequestType.SearchSkill,
	RequestType.CopilotSessions, RequestType.CopilotSessionLogs, RequestType.CopilotSessionDetails,
	RequestType.CopilotAgentJob, RequestType.CopilotCustomAgents, RequestType.CopilotAgentMemory,
]);

export class CAPIClient {
	private readonly _domains = new DomainService();
	private _sku: string | undefined;

	constructor(
		private readonly _extensionInfo: ExtensionInfo,
		_licenseAgreement: string | undefined,
		private readonly _fetcher: Fetcher,
		private readonly _hmacSecret?: string,
		private readonly _integrationId?: string,
	) {
		// Reserved ids identify the first-party editor to GitHub's service. Taking
		// one would be claiming to be that client.
		if (this._integrationId === 'vscode-chat' || this._integrationId === 'code-oss') {
			throw new Error(`Integration ID ${this._integrationId} is reserved and cannot be used.`);
		}
	}

	/** Repoints every endpoint from a freshly minted token. */
	updateDomains(token: CopilotToken | undefined, enterpriseUrl: string | undefined): IDomainChangeResponse {
		if (token?.sku) {
			this._sku = token.sku;
		}
		return this._domains.update(token, enterpriseUrl);
	}

	/**
	 * Sends one request.
	 *
	 * `T` is whatever the fetcher returns — a Response for every current caller.
	 * The cast is at this single boundary rather than at each of the seventy-odd
	 * call sites.
	 */
	async makeRequest<T>(request: MakeRequestOptions, metadata: RequestMetadata): Promise<T> {
		const options: FetchOptions = { ...request, callSite: request.callSite ?? metadata.type };
		this._stampHeaders(options, metadata);
		return this._fetcher.fetch(this._urlFor(metadata), options) as Promise<T>;
	}

	/**
	 * Opens the streaming responses socket.
	 *
	 * Generic in the connection type so the caller keeps the fetcher's concrete
	 * one: this module deliberately does not know what a socket is, and naming
	 * the networking layer's type here would invert the dependency.
	 */
	// NOVEL-BUILDER: upstream 1.134.0 narrowed this from the generic makeRequest
	// shape — `<T>(options: MakeRequestOptions): T` — to a concrete one taking
	// only headers and returning a connection promise, and its subclass both
	// overrides it with that signature and does `return super.…` straight into a
	// `Promise<WebSocketConnection>`.
	//
	// The return type is deliberately loose rather than that concrete type.
	// `WebSocketConnection` belongs to the extension's networking layer, and the
	// note above this method is the reason not to name it here: this module is a
	// stand-in for a package that knows nothing about sockets, and importing the
	// type would point the dependency the wrong way. A supertype will not do
	// either — the subclass assigns the result *to* the concrete type, so the
	// looseness has to sit on this side of the boundary.
	createResponsesWebSocket(options: { headers?: Record<string, string> }): Promise<any> {
		void this._stampHeaders(options as MakeRequestOptions, { type: RequestType.ChatResponses });
		if (!this._fetcher.createWebSocket) {
			throw new Error('this fetcher cannot open a web socket');
		}
		return this._fetcher.createWebSocket(this._domains.capiResponsesURL, options as MakeRequestOptions) as Promise<unknown>;
	}

	get dotcomAPIURL(): string { return this._domains.dotComAPIURL; }
	get proxyBaseURL(): string { return this._domains.proxyBaseURL; }
	get capiPingURL(): string { return this._domains.capiPingURL; }
	get originTrackerURL(): string { return this._domains.originTrackerURL; }
	get copilotTelemetryURL(): string { return this._domains.telemetryURL; }
	get snippyMatchPath(): string { return this._domains.snippyMatchPath; }
	get snippyFilesForMatchPath(): string { return this._domains.snippyFilesForMatchPath; }

	/**
	 * The routing table.
	 *
	 * Kept as one exhaustive switch on purpose: it is the single place that knows
	 * where anything goes, so repointing the product is a diff in one function
	 * rather than an audit of every caller.
	 */
	private _urlFor(m: RequestMetadata): string {
		const d = this._domains;
		switch (m.type) {
			// NOVEL-BUILDER: Auto is fetcher metadata, not a CAPI route — autoV2Fetcher
			// builds its own URL and passes this only for stamping. Throwing rather
			// than inventing a URL keeps the mistake loud if that ever changes.
			case RequestType.Auto: throw new Error('RequestType.Auto does not name a CAPI route');
			case RequestType.CopilotToken: return d.tokenURL;
			case RequestType.CopilotNLToken: return d.tokenNoAuthURL;
			case RequestType.CopilotUserInfo: return d.copilotUserInfoURL;

			case RequestType.ChatCompletions: return d.capiChatURL;
			case RequestType.ChatResponses: return d.capiResponsesURL;
			case RequestType.ChatMessages: return d.capiMessagesURL;
			case RequestType.ProxyCompletions: return `${d.proxyBaseURL}/v1/engines/gpt-4o-copilot/completions`;
			case RequestType.ProxyChatCompletions: return `${d.proxyBaseURL}/chat/completions`;

			case RequestType.Models: return d.capiModelsURL;
			case RequestType.ListModel: return `${d.capiModelsURL}/${m.modelId}`;
			case RequestType.ModelPolicy: return `${d.capiModelsURL}/${m.modelId}/policy`;
			case RequestType.AutoModels: return d.capiAutoModelURL;
			case RequestType.ModelRouter: return d.capiModelRouterURL;
			case RequestType.CCAModelsList: return d.CCAModelsURL;

			case RequestType.CAPIEmbeddings: return d.capiEmbeddingsURL;
			case RequestType.DotcomEmbeddings: return d.embeddingsURL;
			case RequestType.EmbeddingsModels: return d.embeddingsModelURL;
			case RequestType.EmbeddingsCodeSearch: return d.embeddingsCodeSearchURL;
			case RequestType.Chunks: return d.chunksURL;
			case RequestType.EmbeddingsIndex: return `${d.dotComAPIURL}/repos/${m.repoWithOwner}/copilot_internal/embeddings_index`;
			case RequestType.CodingGuidelines: return `${d.dotComAPIURL}/repos/${m.repoWithOwner}/copilot_internal/coding_guidelines`;

			case RequestType.ListSkills: return d.listSkillsURL;
			case RequestType.SearchSkill: return `${d.searchSkillURL}/${m.slug}`;
			case RequestType.Telemetry: return d.telemetryURL;
			case RequestType.OrgCustomInstructions: return `${d.dotComAPIURL}/copilot_internal/org_custom_instructions/${m.orgLogin}`;
			case RequestType.ContentExclusion: {
				const url = new URL(d.contentExclusionURL);
				if (m.repos.length > 0) {
					url.searchParams.set('repos', m.repos.join(','));
				}
				url.searchParams.set('scope', 'repo');
				return url.toString();
			}

			case RequestType.SnippyMatch: return `${d.originTrackerURL}/${d.snippyMatchPath}`;
			case RequestType.SnippyFilesForMatch: return `${d.originTrackerURL}/${d.snippyFilesForMatchPath}`;

			case RequestType.RemoteAgent: return d.remoteAgentsURL;
			case RequestType.CodeReviewAgent: return `${d.remoteAgentsURL}/github-code-review`;
			case RequestType.RemoteAgentChat: return m.slug ? `${d.remoteAgentsURL}/${m.slug}?chat` : `${d.remoteAgentsURL}/chat`;
			case RequestType.ChatAttachmentUpload: {
				const url = new URL(d.chatAttachmentUploadURL);
				url.searchParams.set('name', m.uploadName);
				url.searchParams.set('content_type', m.mimeType);
				return url.toString();
			}

			case RequestType.CopilotSessions: return m.prId
				? `${d.copilotAgentSessionsURL}/resource/pull/${m.prId}`
				: d.copilotAgentSessionsURL;
			case RequestType.CopilotSessionLogs: return `${d.copilotAgentSessionsURL}/${m.sessionId}/logs`;
			case RequestType.CopilotSessionDetails: return `${d.copilotAgentSessionsURL}/${m.sessionId}`;

			case RequestType.CopilotAgentJob: {
				const version = m.apiVersion ?? 'v1';
				const base = `${d.copilotAgentJobsURL}/${version}/jobs/${m.owner}/${m.repo}`;
				if (m.jobId) { return `${base}/${m.jobId}`; }
				if (m.sessionId) { return `${base}/session/${m.sessionId}`; }
				return base;
			}
			case RequestType.CopilotAgentJobEnabled: return `${d.copilotAgentJobsURL}/v1/jobs/${m.owner}/${m.repo}/enabled`;
			case RequestType.CopilotAgentMemory: {
				let url = `${d.copilotAgentMemoryURL}/${m.repo}`;
				if (m.action) {
					url += `/${m.action}`;
					if (m.action === 'recent' && m.limit !== undefined) {
						url += `?limit=${m.limit}`;
					}
				}
				return url;
			}
			case RequestType.CopilotCustomAgents: {
				const url = new URL(`${d.copilotCustomAgentsURL}/${m.owner}/${m.repo}`);
				if (m.target) { url.searchParams.set('target', m.target); }
				if (m.exclude_invalid_config !== undefined) { url.searchParams.set('exclude_invalid_config', String(m.exclude_invalid_config)); }
				if (m.dedupe !== undefined) { url.searchParams.set('dedupe', String(m.dedupe)); }
				if (m.include_sources) { url.searchParams.set('include_sources', m.include_sources.join(',')); }
				return url.toString();
			}
			case RequestType.CopilotCustomAgentsDetail: {
				const url = new URL(`${d.copilotCustomAgentsURL}/${m.owner}/${m.repo}/${m.customAgentName}`);
				if (m.version) { url.searchParams.set('version', m.version); }
				return url.toString();
			}
			case RequestType.AgentTask: return this._agentTaskURL(m);
		}
	}

	private _agentTaskURL(m: Extract<RequestMetadata, { type: RequestType.AgentTask }>): string {
		const requireTask = () => {
			if (!m.taskId) { throw new Error(`taskId is required for AgentTask action "${m.action}"`); }
			return m.taskId;
		};
		const requireRepo = () => {
			if (!m.owner || !m.repo) { throw new Error(`owner and repo are required for AgentTask action "${m.action}"`); }
			return `${m.owner}/${m.repo}`;
		};

		let path: string;
		switch (m.action) {
			case 'create': case 'list-for-repo': path = `/repos/${requireRepo()}/tasks`; break;
			case 'list': path = '/tasks'; break;
			case 'get': path = `/tasks/${requireTask()}`; break;
			case 'events': path = `/tasks/${requireTask()}/events`; break;
			case 'steer': path = `/tasks/${requireTask()}/steer`; break;
			case 'create-pr': path = `/repos/${requireRepo()}/tasks/${requireTask()}/pulls`; break;
			case 'archive': path = `/tasks/${requireTask()}/archive`; break;
			case 'unarchive': path = `/tasks/${requireTask()}/unarchive`; break;
		}

		const url = `${this._domains.copilotAgentTasksURL}${path}`;
		if (!m.searchParams) {
			return url;
		}
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(m.searchParams)) {
			if (value !== undefined && value !== null) {
				params.set(key, String(value));
			}
		}
		const query = params.toString();
		return query ? `${url}?${query}` : url;
	}

	/**
	 * Stamps the editor identity onto a request.
	 *
	 * Only for the routes that need it — see {@link IDENTIFIED}. The integration
	 * id names which client is calling; it is ours, or absent, and never one of
	 * the reserved first-party values (rejected in the constructor).
	 */
	private async _stampHeaders(options: MakeRequestOptions, metadata: RequestMetadata): Promise<void> {
		if (!IDENTIFIED.has(metadata.type)) {
			return;
		}
		const headers = options.headers ?? {};
		headers['X-GitHub-Api-Version'] = '2026-06-01';
		headers['VScode-SessionId'] = this._extensionInfo.sessionId;
		headers['VScode-MachineId'] = this._extensionInfo.machineId;
		headers['Editor-Device-Id'] = this._extensionInfo.deviceId;
		headers['Editor-Plugin-Version'] = `${this._extensionInfo.name}/${this._extensionInfo.version}`;
		headers['Editor-Version'] = `vscode/${this._extensionInfo.vscodeVersion}`;

		if (!options.suppressIntegrationId) {
			const id = this._integrationId ?? (this._sku === 'no_auth_limited_copilot' ? 'vscode-nl' : 'code-oss');
			headers['Copilot-Integration-Id'] = id;
			if (this._hmacSecret) {
				headers['Request-Hmac'] = await hmacStamp(this._hmacSecret);
			}
		}
		options.headers = headers;
	}
}

/**
 * A timestamped HMAC, proving the caller holds the shared secret.
 *
 * Only used when one is configured, which is a development affordance rather
 * than part of the product's own authentication — novel-server authenticates on
 * the credential.
 */
async function hmacStamp(secret: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const stamp = Math.floor(Date.now() / 1000).toString();
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(stamp));
	const hex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
	return `${stamp}.${hex}`;
}
