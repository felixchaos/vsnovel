/*---------------------------------------------------------------------------------------------
 *  VS Novel — replacement for @vscode/copilot-api.
 *--------------------------------------------------------------------------------------------*/

/**
 * Re-exports the surface the extension imports.
 *
 * Import sites say `.../novel/vendor/copilotApi` instead of the npm package
 * name. Keeping the module shape identical is what made that a path rewrite
 * rather than a change at each of the forty-odd call sites.
 */

export { CAPIClient } from './capiClient';
export { DomainService } from './domains';
export {
	RequestType,
	type AgentTaskAction,
	type AgentTaskCreatePullRequestResponse,
	type AgentTaskGetResponse,
	type AgentTaskSession,
	type AgentTaskSessionEvent,
	type AgentTaskState,
	type CCAModel,
	type CopilotToken,
	type ExtensionInfo,
	type Fetcher,
	type FetchOptions,
	type IDomainChangeResponse,
	type MakeRequestOptions,
	type RemoteAgentJobPayload,
	type RequestMetadata,
} from './types';
