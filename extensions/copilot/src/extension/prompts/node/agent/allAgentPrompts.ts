/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
// NOVEL-BUILDER: this product's own instructions, registered into the registry's
// additive slot rather than as a family resolver. Nothing here competes with the
// imports above — it is appended after whichever of them wins, so every model
// keeps Copilot's per-family tuning and also hears about the story bible, the
// chapter-scoped search and the translation glossary. Import order is therefore
// irrelevant, which is the point: the three family registrations this replaced
// had to be ordered against xAIPrompts and kimiPrompts to shadow them.
//
// DeepSeek still matches no prefix here and resolves to DefaultAgentPrompt. That
// is now correct rather than a fallback to be avoided: that prompt was rewritten
// for a novelist on 2026-08-22, which is what made the shadowing obsolete.
import '../../../../novel/prompts/novelInstructions';
