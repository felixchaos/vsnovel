/*---------------------------------------------------------------------------------------------
 *  VS Novel — where each family of request goes.
 *--------------------------------------------------------------------------------------------*/

/**
 * Derives every endpoint URL from four bases.
 *
 * The bases move at runtime: the token issued at sign-in carries an `endpoints`
 * block, and {@link DomainService.update} repoints everything from it. That
 * indirection is the whole reason this product can serve its own completions —
 * one token field moves chat, embeddings and telemetry together, with no call
 * site aware that anything changed.
 *
 * Defaults are GitHub's public hosts. They are the honest default rather than
 * our own: before a token exists there is nothing to point at, and a request
 * that reaches this state is a bug that should be visible rather than silently
 * routed somewhere plausible.
 */

import type { CopilotToken, IDomainChangeResponse } from './types';

const DEFAULT_DOTCOM_API = 'https://api.github.com';
const DEFAULT_CAPI = 'https://api.githubcopilot.com';
const DEFAULT_PROXY = 'https://copilot-proxy.githubusercontent.com';
const DEFAULT_TELEMETRY = 'https://copilot-telemetry.githubusercontent.com';
const DEFAULT_ORIGIN_TRACKER = 'https://origin-tracker.githubusercontent.com';

export class DomainService {
	private _dotcomApi = DEFAULT_DOTCOM_API;
	private _capi = DEFAULT_CAPI;
	private _proxy = DEFAULT_PROXY;
	private _telemetry = DEFAULT_TELEMETRY;
	private _originTracker = DEFAULT_ORIGIN_TRACKER;

	/**
	 * Repoints the bases from a freshly minted token.
	 *
	 * Reports both whether anything moved and whether the dotcom host in
	 * particular moved, because the two have different consequences: any change
	 * invalidates cached endpoints, but a dotcom change also invalidates the
	 * identity those endpoints were resolved for.
	 */
	update(token: CopilotToken | undefined, enterpriseUrl: string | undefined): IDomainChangeResponse {
		const before = { dotcom: this._dotcomApi, capi: this._capi, proxy: this._proxy, telemetry: this._telemetry, tracker: this._originTracker };

		if (enterpriseUrl) {
			// An enterprise host replaces the dotcom API only. The Copilot planes
			// are still named by the token, which is issued by that host.
			this._dotcomApi = `${trimSlash(enterpriseUrl)}/api/v3`;
		}
		const endpoints = token?.endpoints;
		if (endpoints) {
			this._capi = trimSlash(endpoints.api) ?? this._capi;
			this._proxy = trimSlash(endpoints.proxy) ?? this._proxy;
			this._telemetry = trimSlash(endpoints.telemetry) ?? this._telemetry;
			this._originTracker = trimSlash(endpoints['origin-tracker']) ?? this._originTracker;
		}

		const dotcomUrlChanged = before.dotcom !== this._dotcomApi;
		const capiUrlChanged = before.capi !== this._capi;
		const proxyUrlChanged = before.proxy !== this._proxy;
		const telemetryUrlChanged = before.telemetry !== this._telemetry;
		return {
			dotcomUrlChanged, capiUrlChanged, proxyUrlChanged, telemetryUrlChanged,
			domainsChanged:
				dotcomUrlChanged || capiUrlChanged || proxyUrlChanged || telemetryUrlChanged ||
				before.tracker !== this._originTracker,
		};
	}

	get dotComAPIURL(): string { return this._dotcomApi; }
	get capiBaseURL(): string { return this._capi; }
	get proxyBaseURL(): string { return this._proxy; }
	get telemetryURL(): string { return `${this._telemetry}/telemetry`; }
	get originTrackerURL(): string { return this._originTracker; }

	get tokenURL(): string { return `${this._dotcomApi}/copilot_internal/v2/token`; }
	get tokenNoAuthURL(): string { return `${this._dotcomApi}/copilot_internal/v2/token/nl`; }
	get copilotUserInfoURL(): string { return `${this._dotcomApi}/copilot_internal/user`; }
	get contentExclusionURL(): string { return `${this._dotcomApi}/copilot_internal/content_exclusion`; }

	get capiChatURL(): string { return `${this._capi}/chat/completions`; }
	get capiResponsesURL(): string { return `${this._capi}/responses`; }
	get capiMessagesURL(): string { return `${this._capi}/v1/messages`; }
	get capiEmbeddingsURL(): string { return `${this._capi}/embeddings`; }
	get capiModelsURL(): string { return `${this._capi}/models`; }
	/** The auto-mode session handshake. See internal/copilotapi/session.go. */
	get capiAutoModelURL(): string { return `${this.capiModelsURL}/session`; }
	get capiModelRouterURL(): string { return `${this.capiAutoModelURL}/intent`; }
	get capiPingURL(): string { return `${this._capi}/_ping`; }

	get embeddingsURL(): string { return `${this._dotcomApi}/copilot_internal/embeddings`; }
	get embeddingsModelURL(): string { return `${this._dotcomApi}/copilot_internal/embeddings/models`; }
	get embeddingsCodeSearchURL(): string { return `${this._capi}/search/code`; }
	get chunksURL(): string { return `${this._capi}/chunks`; }

	get listSkillsURL(): string { return `${this._capi}/agents/skills`; }
	get searchSkillURL(): string { return `${this._capi}/search/skills`; }
	get remoteAgentsURL(): string { return `${this._capi}/agents`; }
	get chatAttachmentUploadURL(): string { return `${this._capi}/chat/attachments`; }
	get CCAModelsURL(): string { return `${this._capi}/agents/models`; }

	get copilotAgentSessionsURL(): string { return `${this._dotcomApi}/agents/sessions`; }
	get copilotAgentJobsURL(): string { return `${this._dotcomApi}/agents/swe`; }
	get copilotAgentTasksURL(): string { return `${this._dotcomApi}/agents/tasks`; }
	get copilotAgentMemoryURL(): string { return `${this._dotcomApi}/agents/memory`; }
	get copilotCustomAgentsURL(): string { return `${this._dotcomApi}/copilot_internal/custom_agents`; }

	get snippyMatchPath(): string { return 'twirp/github.snippy.v1.SnippyAPI/Match'; }
	get snippyFilesForMatchPath(): string { return 'twirp/github.snippy.v1.SnippyAPI/FilesForMatch'; }
}

function trimSlash(url: string | undefined): string | undefined {
	return url ? url.replace(/\/+$/, '') : undefined;
}
