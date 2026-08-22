/*---------------------------------------------------------------------------------------------
 *  VS Novel — one BYOK vendor for any OpenAI-compatible relay.
 *--------------------------------------------------------------------------------------------*/

/**
 * The five vendors in `providers.ts` each hard-code the host they answer at,
 * because there is exactly one. A relay has no such host: it is whichever
 * address the author bought access from, and there are hundreds of them.
 *
 * So this provider is the same machine with the base URL moved into the
 * author's hands, plus the one thing that makes an unknown listing usable —
 * `resolveModelCapabilities`, the hook the base class calls for ids it has no
 * entry for. Left unimplemented it returns `undefined`, and the loop in
 * `getModelsFromEndpoint` skips the model. That default is right for a vendor
 * with a curated table and exactly wrong here: it would show the author an
 * empty picker after a key that works, which reads as a broken product.
 *
 * Deliberately *not* built on the relay's own metadata. New API — the stack
 * most of these hosts run — publishes an unauthenticated `/api/pricing` listing
 * models, prices and endpoint types, and it is tempting. But it is one stack's
 * convention, it carries no context window or output ceiling (the two figures
 * that actually matter), and depending on it would make this vendor work on the
 * relays that happen to run New API and fail confusingly on the rest. `/v1/models`
 * is the only listing every OpenAI-compatible relay has, so it is the only one
 * this asks for.
 */

import { IConfigurationService } from '../../platform/configuration/common/configurationService';
import { ILogService } from '../../platform/log/common/logService';
import { IFetcherService } from '../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../util/vs/platform/instantiation/common/instantiation';
import { IChatModelInformation } from '../../platform/endpoint/common/endpointProvider';
import { BYOKModelCapabilities, resolveModelInfo } from '../../extension/byok/common/byokProvider';
import {
	AbstractOpenAICompatibleLMProvider,
	LanguageModelChatConfiguration,
} from '../../extension/byok/vscode-node/abstractLanguageModelChatProvider';
import { IBYOKStorageService } from '../../extension/byok/vscode-node/byokStorageService';
import { relayModelCapabilities } from './relayCatalog';

/** What the author fills in: where the relay answers, and the key it wants. */
export interface RelayConfig extends LanguageModelChatConfiguration {
	readonly url?: string;
}

/**
 * Bring an address a human typed to the form the rest of the code expects: no
 * trailing slash, and an API version segment.
 *
 * Relays publish their base URL both ways — `https://host` and `https://host/v1`
 * are the same relay in two docs pages — and the author copies whichever they
 * were shown. Appending `/v1` only when no version segment is present is the
 * same rule `resolveCustomOAIUrl` already applies for the Custom OAI provider,
 * kept identical so the two do not disagree about the same string.
 *
 * An explicit API path is left alone: someone who typed `/chat/completions`
 * meant it, and rewriting it would silently point them somewhere else.
 */
export function normalizeRelayBaseUrl(raw: string | undefined): string | undefined {
	const trimmed = raw?.trim();
	if (!trimmed) {
		return undefined;
	}

	const url = trimmed.replace(/\/+$/, '');
	if (!url) {
		return undefined;
	}

	// Everything downstream appends its own path, so a base that already carries
	// one has to be cut back rather than built on: otherwise the request goes to
	// `.../chat/completions/chat/completions`.
	for (const path of ['/chat/completions', '/responses']) {
		const at = url.indexOf(path);
		if (at !== -1) {
			return url.slice(0, at) || undefined;
		}
	}

	return /\/v\d+$/.test(url) ? url : `${url}/v1`;
}

export class RelayLMProvider extends AbstractOpenAICompatibleLMProvider<RelayConfig> {
	public static readonly providerName = 'API Relay';
	public static readonly providerId = 'novelrelay';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			RelayLMProvider.providerId,
			RelayLMProvider.providerName,
			// No table. Every id this vendor serves is resolved below, at the
			// moment the relay names it.
			undefined,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected override getModelsBaseUrl(configuration: RelayConfig | undefined): string | undefined {
		// Returning undefined rather than a placeholder host is what makes the
		// pre-configuration state quiet: the base class answers with an empty
		// model list instead of failing a fetch against somewhere real.
		return normalizeRelayBaseUrl(configuration?.url);
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		const id = (modelData as { id?: unknown } | undefined)?.id;
		if (typeof id !== 'string') {
			return undefined;
		}
		return relayModelCapabilities(id);
	}

	/**
	 * Answer for a model even when nothing has listed it this session.
	 *
	 * The five vendors with a fixed table are handed it in their constructor, so
	 * they can always answer. This one learns its table during discovery, and
	 * `_knownModels` is empty until that runs. Whenever it has not, the inherited
	 * path falls through to `resolveModelInfo`'s defaults — and those include
	 * `tool_calls: false`.
	 *
	 * That is the failure worth guarding: a model the author already picked comes
	 * back after a restart from `chat.cachedLanguageModels.v2` with no tool calling
	 * at all. The agent then cannot read or edit a single file, reports nothing
	 * wrong, and the author has no way to connect it to a listing that did not
	 * happen. Resolving the id here costs a regex match and removes the window
	 * entirely.
	 */
	protected override getModelInfo(modelId: string, modelUrl: string): IChatModelInformation {
		if (this._knownModels?.[modelId]) {
			return super.getModelInfo(modelId, modelUrl);
		}
		return resolveModelInfo(modelId, this._name, this._knownModels, relayModelCapabilities(modelId));
	}
}
