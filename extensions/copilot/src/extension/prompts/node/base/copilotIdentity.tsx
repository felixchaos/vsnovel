/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptElement } from '@vscode/prompt-tsx';
// NOVEL-BUILDER: identity is a writing assistant, not a coding assistant.
import { NovelIdentityRules } from '../../../../novel/prompts/novelRules';

export class CopilotIdentityRules extends PromptElement {
	render() {
		return <NovelIdentityRules />;
	}
}

export class GPT5CopilotIdentityRule extends PromptElement {
	render() {
		return <NovelIdentityRules />;
	}
}

export class Gpt55CopilotIdentityRule extends PromptElement {
	render() {
		return <NovelIdentityRules />;
	}
}
