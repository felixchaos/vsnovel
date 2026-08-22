/*---------------------------------------------------------------------------------------------
 *  VS Novel — the open-weight vendors an author can bring a key to.
 *--------------------------------------------------------------------------------------------*/

/**
 * One class per vendor, each stating only what makes it different: where it
 * answers, what it offers, and what it refuses to be sent.
 *
 * Every base URL below was verified against the live host with a deliberately
 * invalid key. All five answered 401, not 404 — which is the only cheap way to
 * tell "the path is right and the credential was rejected" from "we are posting
 * into a hole". That distinction is exactly what cost an author a support thread
 * before this file existed.
 */

import { IConfigurationService } from '../../platform/configuration/common/configurationService';
import { ILogService } from '../../platform/log/common/logService';
import { IFetcherService } from '../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../util/vs/platform/instantiation/common/instantiation';
import { IBYOKStorageService } from '../../extension/byok/vscode-node/byokStorageService';
import { DEEPSEEK_MODELS, GLM_MODELS, KIMI_MODELS, MINIMAX_MODELS, QWEN_MODELS } from './catalog';
import { NovelOpenCompatProvider, PinnedSampling } from './openCompatProvider';
import { RelayLMProvider } from './relayProvider';

export class DeepSeekLMProvider extends NovelOpenCompatProvider {
	public static readonly providerName = 'DeepSeek';
	public static readonly providerId = 'deepseek';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			DeepSeekLMProvider.providerId,
			DeepSeekLMProvider.providerName,
			DEEPSEEK_MODELS,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected getModelsBaseUrl(): string {
		// `/v1` is a compatibility path here, not a version — DeepSeek's own docs
		// say so. Either form works; this is the one their OpenAI examples use.
		return 'https://api.deepseek.com/v1';
	}
}

export class KimiLMProvider extends NovelOpenCompatProvider {
	public static readonly providerName = 'Kimi';
	public static readonly providerId = 'kimi';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			KimiLMProvider.providerId,
			KimiLMProvider.providerName,
			KIMI_MODELS,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected getModelsBaseUrl(): string {
		return 'https://api.moonshot.ai/v1';
	}

	/**
	 * Moonshot rejects any temperature but 1 and any top_p but 0.95 outright:
	 * "invalid temperature: only 1 is allowed for this model", HTTP 400, every
	 * request. The client always sends a temperature, so without this every
	 * single message through a Kimi key fails.
	 *
	 * The values are Moonshot's own recommendation rather than a guess at a
	 * neutral setting. Temperature 0 in particular makes these models loop.
	 */
	protected override pinnedSampling(): PinnedSampling {
		return { temperature: 1, top_p: 0.95 };
	}
}

export class GLMLMProvider extends NovelOpenCompatProvider {
	public static readonly providerName = 'Zhipu GLM';
	public static readonly providerId = 'zhipu';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			GLMLMProvider.providerId,
			GLMLMProvider.providerName,
			GLM_MODELS,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected getModelsBaseUrl(): string {
		return 'https://open.bigmodel.cn/api/paas/v4';
	}
}

export class QwenLMProvider extends NovelOpenCompatProvider {
	public static readonly providerName = 'Qwen';
	public static readonly providerId = 'qwen';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			QwenLMProvider.providerId,
			QwenLMProvider.providerName,
			QWEN_MODELS,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected getModelsBaseUrl(): string {
		// Alibaba publishes a per-region host, and the Beijing one is where a
		// key bought on the Chinese console works. An author outside China whose
		// key lives in another region can still reach it through the Custom
		// Endpoint provider; hard-coding a region here is what keeps the common
		// case to pasting a key.
		return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
	}
}

export class MiniMaxLMProvider extends NovelOpenCompatProvider {
	public static readonly providerName = 'MiniMax';
	public static readonly providerId = 'minimax';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			MiniMaxLMProvider.providerId,
			MiniMaxLMProvider.providerName,
			MINIMAX_MODELS,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected getModelsBaseUrl(): string {
		// `.com` is the mainland host; `.io` serves the international console.
		// Both speak the same API, and this is the one that answered.
		return 'https://api.minimaxi.com/v1';
	}
}

/**
 * Everything this file contributes, in the order the picker should show it.
 *
 * The relay goes last on purpose. An author who holds a vendor's own key is
 * better served by the entry above that names it — those carry measured
 * capabilities — and should not have to scroll past a generic option to find it.
 * The relay is the answer for everyone the five named vendors do not cover.
 */
export const NOVEL_BYOK_PROVIDERS = [
	DeepSeekLMProvider,
	KimiLMProvider,
	GLMLMProvider,
	QwenLMProvider,
	MiniMaxLMProvider,
	RelayLMProvider,
] as const;
