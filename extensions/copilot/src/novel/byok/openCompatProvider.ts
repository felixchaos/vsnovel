/*---------------------------------------------------------------------------------------------
 *  VS Novel — one OpenAI-compatible BYOK provider, shared by the open-weight vendors.
 *--------------------------------------------------------------------------------------------*/

/**
 * What every vendor in `catalog.ts` has in common, so each one is left stating
 * only its base URL and its table.
 *
 * Three behaviours live here, each of them the difference between "paste a key
 * and write" and a support conversation.
 */

import { IChatMLFetcher } from '../../platform/chat/common/chatMLFetcher';
import { IConfigurationService } from '../../platform/configuration/common/configurationService';
import { IDomainService } from '../../platform/endpoint/common/domainService';
import { IChatModelInformation } from '../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../platform/log/common/logService';
import { IFetcherService } from '../../platform/networking/common/fetcherService';
import { ICreateEndpointBodyOptions, IEndpointBody } from '../../platform/networking/common/networking';
import { IChatWebSocketManager } from '../../platform/networking/node/chatWebSocketManager';
import { IExperimentationService } from '../../platform/telemetry/common/nullExperimentationService';
import { ITokenizerProvider } from '../../platform/tokenizer/node/tokenizer';
import { IInstantiationService } from '../../util/vs/platform/instantiation/common/instantiation';
import { BYOKKnownModels } from '../../extension/byok/common/byokProvider';
import { OpenAIEndpoint } from '../../extension/byok/node/openAIEndpoint';
import {
	AbstractOpenAICompatibleLMProvider,
	LanguageModelChatConfiguration,
	OpenAICompatibleLanguageModelChatInformation,
} from '../../extension/byok/vscode-node/abstractLanguageModelChatProvider';
import { byokKnownModelsToAPIInfoWithEffort } from '../../extension/byok/vscode-node/byokModelInfo';
import { IBYOKStorageService } from '../../extension/byok/vscode-node/byokStorageService';

/**
 * Sampling parameters a vendor refuses to be sent anything but.
 *
 * `null` deletes the field; a number pins it. Anything unset is left to the
 * caller.
 */
export interface PinnedSampling {
	readonly temperature?: number | null;
	readonly top_p?: number | null;
}

/**
 * An {@link OpenAIEndpoint} that overrides sampling after the body is built.
 *
 * Needed because the ordinary route does not reach this path. `chatEndpoint.ts`
 * force-sets Kimi's temperature, but only inside `ChatEndpoint.createRequestBody`
 * — and the chat-completions branch of `OpenAIEndpoint.createRequestBody`, the
 * one every vendor here takes, builds its body with `createCapiRequestBody`
 * instead of calling `super`. So a Moonshot model reached through BYOK never
 * sees that fix and 400s on every single message.
 *
 * `BYOKModelCapabilities.modelOptions` is not the answer either: its own
 * application step lets a value present on the request win, and the client
 * always sends a temperature (`services.ts` defaults it, and the callers set it
 * explicitly). A configured value can therefore never take effect on the path
 * that needs it. Pinning after the fact is the only place left that the request
 * cannot override.
 */
export class PinnedSamplingEndpoint extends OpenAIEndpoint {
	constructor(
		modelMetadata: IChatModelInformation,
		apiKey: string,
		modelUrl: string,
		private readonly _pinned: PinnedSampling,
		@IDomainService domainService: IDomainService,
		@IChatMLFetcher chatMLFetcher: IChatMLFetcher,
		@ITokenizerProvider tokenizerProvider: ITokenizerProvider,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService,
		@IChatWebSocketManager chatWebSocketService: IChatWebSocketManager,
		@ILogService logService: ILogService
	) {
		super(
			modelMetadata,
			apiKey,
			modelUrl,
			domainService,
			chatMLFetcher,
			tokenizerProvider,
			instantiationService,
			configurationService,
			expService,
			chatWebSocketService,
			logService
		);
	}

	override createRequestBody(options: ICreateEndpointBodyOptions): IEndpointBody {
		const body = super.createRequestBody(options);
		for (const key of ['temperature', 'top_p'] as const) {
			const pinned = this._pinned[key];
			if (pinned === null) {
				delete body[key];
			} else if (pinned !== undefined) {
				body[key] = pinned;
			}
		}
		return body;
	}
}

/**
 * The shared provider.
 *
 * Subclasses supply a base URL, a catalogue and — where the vendor demands it —
 * the sampling it will accept.
 */
export abstract class NovelOpenCompatProvider extends AbstractOpenAICompatibleLMProvider {

	constructor(
		id: string,
		name: string,
		models: BYOKKnownModels,
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			id,
			name,
			models,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	/** The sampling this vendor insists on. Empty for the ones that don't care. */
	protected pinnedSampling(): PinnedSampling | undefined {
		return undefined;
	}

	/**
	 * Ask the vendor which models this key can reach, but never let that
	 * question be the reason the picker is empty.
	 *
	 * The inherited implementation throws when `/models` fails, and a throw here
	 * surfaces as a vendor with no models at all — the same symptom as a wrong
	 * key, from a blocked network, a captive portal, or a vendor having a bad
	 * afternoon. The author has no way to tell those apart and no reason to care
	 * about the difference.
	 *
	 * So a live listing is treated as a refinement, not a precondition: it
	 * filters the catalogue down to what this account may actually call. When it
	 * cannot be had, the catalogue itself is served. The worst case becomes a
	 * model that errors when selected, instead of a product that appears broken
	 * the moment a valid key is pasted.
	 *
	 * The silent, keyless case is left alone deliberately: before a key exists
	 * there is nothing to list and nothing to fall back to.
	 */
	protected override async getAllModels(
		silent: boolean,
		apiKey: string | undefined,
		configuration: LanguageModelChatConfiguration | undefined
	): Promise<OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>[]> {
		const url = this.getModelsBaseUrl(configuration);
		if (!url) {
			return [];
		}
		if (!apiKey) {
			// Matches the base class: nothing to show until a key is configured.
			return silent ? [] : super.getAllModels(silent, apiKey, configuration);
		}

		try {
			const discovered = await super.getAllModels(silent, apiKey, configuration);
			if (discovered.length > 0) {
				return discovered;
			}
			this._logService.warn(
				`${this._name}: the model listing was reachable but matched none of the known models; serving the built-in catalogue instead.`
			);
		} catch (err) {
			this._logService.warn(
				`${this._name}: could not list models (${err instanceof Error ? err.message : String(err)}); serving the built-in catalogue instead.`
			);
		}

		return byokKnownModelsToAPIInfoWithEffort(this._name, this._knownModels).map(model => ({
			...model,
			url,
		}));
	}

	protected override async createOpenAIEndPoint(
		model: OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>
	): Promise<OpenAIEndpoint> {
		const pinned = this.pinnedSampling();
		if (!pinned) {
			return super.createOpenAIEndPoint(model);
		}
		const modelInfo = this.getModelInfo(model.id, model.url);
		return this._instantiationService.createInstance(
			PinnedSamplingEndpoint,
			modelInfo,
			model.configuration?.apiKey ?? '',
			`${model.url}/chat/completions`,
			pinned
		);
	}

}
