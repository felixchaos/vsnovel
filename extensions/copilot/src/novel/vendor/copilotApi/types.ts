/*---------------------------------------------------------------------------------------------
 *  VS Novel — replacement for the proprietary @vscode/copilot-api surface.
 *--------------------------------------------------------------------------------------------*/

/**
 * Our own implementation of the API client the extension was built against.
 *
 * The npm package this replaces ships under GitHub's own terms, not an open
 * licence, so it cannot be redistributed inside a commercial product. This
 * module is written from how the extension *uses* the client — the symbols it
 * imports, the methods it calls, the request shapes it passes — rather than
 * from the package's declarations, and it talks to novel-server rather than to
 * GitHub's CAPI.
 *
 * The surface is deliberately no larger than what is actually used. Every type
 * here is reachable from a call site in this repository; nothing was added for
 * completeness.
 */

/**
 * Which endpoint a request is for.
 *
 * A discriminator, not a URL. Keeping the routing in one switch — see
 * {@link CAPIClient.makeRequest} — is what lets the whole product be pointed at
 * a different host by changing one table instead of auditing every caller.
 */
export enum RequestType {
	CopilotToken = 'CopilotToken',
	CopilotNLToken = 'CopilotNLToken',
	CopilotUserInfo = 'CopilotUserInfo',

	ChatCompletions = 'ChatCompletions',
	ChatResponses = 'ChatResponses',
	ChatMessages = 'ChatMessages',
	ProxyCompletions = 'ProxyCompletions',
	ProxyChatCompletions = 'ProxyChatCompletions',

	Models = 'Models',
	ListModel = 'ListModel',
	ModelPolicy = 'ModelPolicy',
	AutoModels = 'AutoModels',
	ModelRouter = 'ModelRouter',
	CCAModelsList = 'CCAModelsList',

	CAPIEmbeddings = 'CAPIEmbeddings',
	DotcomEmbeddings = 'DotcomEmbeddings',
	EmbeddingsModels = 'EmbeddingsModels',
	EmbeddingsIndex = 'EmbeddingsIndex',
	EmbeddingsCodeSearch = 'EmbeddingsCodeSearch',
	Chunks = 'Chunks',

	ListSkills = 'ListSkills',
	SearchSkill = 'SearchSkill',
	ContentExclusion = 'ContentExclusion',
	CodingGuidelines = 'CodingGuidelines',
	OrgCustomInstructions = 'OrgCustomInstructions',
	Telemetry = 'Telemetry',

	SnippyMatch = 'SnippyMatch',
	SnippyFilesForMatch = 'SnippyFilesForMatch',

	RemoteAgent = 'RemoteAgent',
	RemoteAgentChat = 'RemoteAgentChat',
	CodeReviewAgent = 'CodeReviewAgent',
	ChatAttachmentUpload = 'ChatAttachmentUpload',

	CopilotSessions = 'CopilotSessions',
	CopilotSessionLogs = 'CopilotSessionLogs',
	CopilotSessionDetails = 'CopilotSessionDetails',
	CopilotAgentJob = 'CopilotAgentJob',
	CopilotAgentJobEnabled = 'CopilotAgentJobEnabled',
	CopilotAgentMemory = 'CopilotAgentMemory',
	CopilotCustomAgents = 'CopilotCustomAgents',
	CopilotCustomAgentsDetail = 'CopilotCustomAgentsDetail',
	AgentTask = 'AgentTask',
	// NOVEL-BUILDER: added at upstream 1.134.0 by autoV2Fetcher; the usage point
	// is the authority for this enum, and a missing value is a compile error there.
	Auto = 'Auto',
}

/**
 * The per-request discriminated data.
 *
 * Most requests need only a type; the rest carry the one or two path parameters
 * their route interpolates. Declared as a union so a caller that forgets a
 * required parameter is a type error rather than a malformed URL at runtime.
 */
export type RequestMetadata =
	| { readonly type: Exclude<RequestType, RequestType.EmbeddingsIndex | RequestType.CodingGuidelines | RequestType.ContentExclusion | RequestType.SearchSkill | RequestType.RemoteAgentChat | RequestType.ModelPolicy | RequestType.ListModel | RequestType.ChatAttachmentUpload | RequestType.CopilotSessionLogs | RequestType.CopilotSessionDetails | RequestType.CopilotSessions | RequestType.CopilotAgentJob | RequestType.CopilotAgentJobEnabled | RequestType.CopilotAgentMemory | RequestType.CopilotCustomAgents | RequestType.CopilotCustomAgentsDetail | RequestType.OrgCustomInstructions | RequestType.AgentTask>; readonly isModelLab?: boolean }
	| { readonly type: RequestType.EmbeddingsIndex | RequestType.CodingGuidelines; readonly repoWithOwner: string }
	| { readonly type: RequestType.ContentExclusion; readonly repos: string[] } // NOVEL-BUILDER: not readonly — upstream's mock passes these to a `(repos: string[])` responder
	| { readonly type: RequestType.SearchSkill; readonly slug: string }
	| { readonly type: RequestType.RemoteAgentChat; readonly slug?: string }
	| { readonly type: RequestType.ModelPolicy | RequestType.ListModel; readonly modelId: string }
	| { readonly type: RequestType.ChatAttachmentUpload; readonly uploadName: string; readonly mimeType: string }
	| { readonly type: RequestType.CopilotSessionLogs | RequestType.CopilotSessionDetails; readonly sessionId: string }
	| { readonly type: RequestType.CopilotSessions; readonly resourceState?: string; readonly nwo?: string; readonly prId?: string }
	| { readonly type: RequestType.CopilotAgentJob | RequestType.CopilotAgentJobEnabled; readonly owner: string; readonly repo: string; readonly jobId?: string; readonly sessionId?: string; readonly payload?: unknown; readonly apiVersion?: string }
	| { readonly type: RequestType.CopilotAgentMemory; readonly repo: string; readonly action?: string; readonly limit?: number }
	| { readonly type: RequestType.CopilotCustomAgents; readonly owner: string; readonly repo: string; readonly target?: string; readonly exclude_invalid_config?: boolean; readonly dedupe?: boolean; readonly include_sources?: readonly string[] }
	| { readonly type: RequestType.CopilotCustomAgentsDetail; readonly owner: string; readonly repo: string; readonly customAgentName: string; readonly version?: string }
	| { readonly type: RequestType.OrgCustomInstructions; readonly orgLogin: string }
	| { readonly type: RequestType.AgentTask; readonly action: AgentTaskAction; readonly owner?: string; readonly repo?: string; readonly taskId?: string; readonly searchParams?: Record<string, unknown> };

export type AgentTaskAction =
	| 'create' | 'list' | 'list-for-repo' | 'get' | 'events' | 'steer' | 'create-pr' | 'archive' | 'unarchive';

/**
 * What a caller hands to {@link CAPIClient.makeRequest}.
 *
 * Declared as a type alias rather than an interface on purpose. An interface
 * gets no implicit index signature, so it cannot be passed where a
 * `Record<string, unknown>` is expected — which the fetch middleware's
 * `HttpRequest.state` is. A type alias does get one, while still accepting the
 * extension's own option interfaces, which an index-signature-bearing interface
 * would reject. Both directions have to work, and only the alias does both.
 *
 * `signal` is deliberately untyped: the networking layer carries its own
 * `IAbortSignal` abstraction rather than the DOM one, and naming either here
 * would make this module depend on a layer above it.
 */
export type MakeRequestOptions = {
	method?: 'GET' | 'POST' | 'PUT';
	headers?: Record<string, string>;
	json?: unknown;
	body?: string | Uint8Array;
	signal?: unknown;
	/** Telemetry label. Filled in from the request type when the caller omits it. */
	callSite?: string;
	/** Skips stamping Copilot-Integration-Id, for routes that must not carry it. */
	suppressIntegrationId?: boolean;
};

/**
 * What reaches the fetcher.
 *
 * Same shape with `callSite` resolved — the fetcher requires it, and
 * {@link CAPIClient.makeRequest} is the one place that can supply a sensible
 * default, so the distinction is expressed in the type rather than left to a
 * convention nobody can check.
 */
export type FetchOptions = MakeRequestOptions & { callSite: string };

/**
 * The token payload, as far as this client reads it.
 *
 * Only `endpoints` and `sku` are used here — the first to repoint the domains,
 * the second to pick an integration id. Everything else the token carries is the
 * business of the authentication layer, which has its own richer type.
 */
export interface CopilotToken {
	readonly sku?: string;
	readonly endpoints?: {
		readonly api?: string;
		readonly proxy?: string;
		readonly telemetry?: string;
		readonly 'origin-tracker'?: string;
	};
	readonly [key: string]: unknown;
}

/**
 * Which planes moved when the token repointed the domains.
 *
 * Reported per plane rather than as one flag because the consumers drop
 * different caches: a chat endpoint cares that the CAPI host moved, telemetry
 * cares about its own, and only a dotcom change invalidates the identity the
 * endpoints were resolved for.
 */
export interface IDomainChangeResponse {
	readonly domainsChanged: boolean;
	readonly dotcomUrlChanged: boolean;
	readonly capiUrlChanged: boolean;
	readonly proxyUrlChanged: boolean;
	readonly telemetryUrlChanged: boolean;
}

/** One entry of the Copilot CLI model list. */
export interface CCAModel {
	readonly id: string;
	readonly name?: string;
	readonly [key: string]: unknown;
}

/** Body accepted by the remote-agent job endpoints. */
export interface RemoteAgentJobPayload {
	readonly [key: string]: unknown;
}

/**
 * Lifecycle of a remote agent task.
 *
 * The set is taken from the call sites that switch on it rather than guessed —
 * a state missing from this union turns an exhaustive switch upstream into a
 * compile error, and one invented for it makes that switch non-exhaustive. Both
 * mistakes were made here and both were caught by the same switch.
 */
export type AgentTaskState =
	| 'queued' | 'in_progress' | 'idle' | 'waiting_for_user'
	| 'completed' | 'failed' | 'cancelled' | 'timed_out';

export interface AgentTaskSession {
	readonly id: string;
	readonly state?: AgentTaskState;
	readonly [key: string]: unknown;
}

export interface AgentTaskSessionEvent {
	readonly type: string;
	readonly [key: string]: unknown;
}

export interface AgentTaskGetResponse {
	readonly session?: AgentTaskSession;
	readonly [key: string]: unknown;
}

export interface AgentTaskCreatePullRequestResponse {
	readonly url?: string;
	readonly [key: string]: unknown;
}

/** Identity stamped onto every request as headers. */
export interface ExtensionInfo {
	readonly machineId: string;
	readonly deviceId: string;
	readonly sessionId: string;
	readonly vscodeVersion: string;
	readonly buildType: string;
	readonly name: string;
	readonly version: string;
}

/** The subset of the fetcher this client needs. */
export interface Fetcher {
	fetch(url: string, options: FetchOptions): Promise<unknown>;
	createWebSocket?(url: string, options: MakeRequestOptions): unknown;
	fetchWithPagination?(url: string, options: FetchOptions): Promise<unknown>;
}
