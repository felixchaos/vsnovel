/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptElement } from '@vscode/prompt-tsx';
// NOVEL-BUILDER: all three variants delegate to one novel-tuned rule set.
// See src/novel/prompts/novelRules.tsx for what changed and why.
import { NovelSafetyRules } from '../../../../novel/prompts/novelRules';

export class SafetyRules extends PromptElement {
	render() {
		return <NovelSafetyRules />;
	}
}

export class Gpt5SafetyRule extends PromptElement {
	render() {
		return <NovelSafetyRules />;
	}
}

export class LegacySafetyRules extends PromptElement {
	render() {
		return <NovelSafetyRules />;
	}
}
