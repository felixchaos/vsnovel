/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// NOVEL-BUILDER: Grok and Kimi are claimed upstream by `matchesModel` predicates
// (xAIPrompts, kimiPrompts). The registry checks predicate resolvers before any
// prefix and, among predicates, the first registered wins — so ours must be
// imported before those two files to shadow their coding prompts with the shared
// writing prompt. Order is asserted by grokPrompt.spec.ts / kimiPrompt.spec.ts.
import '../../../../novel/prompts/grokPrompt';
import '../../../../novel/prompts/kimiPrompt';
import './anthropicPrompts';
import './familyHPrompts';
import './geminiPrompts';
import './kimiPrompts';
import './minimaxPrompts';
import './vscModelPrompts';
// vscModelPrompts must be imported before gpt5Prompt to ensure VSC model prompt resolvers are registered first.
import './openai/defaultOpenAIPrompt';
import './openai/gpt51CodexPrompt';
import './openai/gpt51Prompt';
import './openai/gpt52Prompt';
import './openai/gpt53CodexPrompt';
import './openai/gpt54Prompt';
import './openai/gpt55Prompt';
import './openai/gpt56Prompt';
import './openai/gpt5CodexPrompt';
import './openai/gpt5Prompt';
import './xAIPrompts';
import './zaiPrompts';
// NOVEL-BUILDER: DeepSeek is the product's own model family and has no upstream
// prompt, so without this registration `family: 'deepseek'` matches no prefix and
// falls through to DefaultAgentPrompt — a prompt that assumes a codebase
// throughout. Imported last so it cannot be shadowed by a prefix registered above.
import '../../../../novel/prompts/deepseekPrompt';
