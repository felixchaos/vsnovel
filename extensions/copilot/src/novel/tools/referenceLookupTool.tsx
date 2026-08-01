/*---------------------------------------------------------------------------------------------
 *  VS Novel — encyclopaedia lookup, run from the author's own machine.
 *--------------------------------------------------------------------------------------------*/

/**
 * The product ships no web search, and this is not one. It is the part of
 * research that can actually be served without a key or a bill.
 *
 * Measured 2026-08-01, looking for a keyless search an author's own machine
 * could run:
 *
 *   lite.duckduckgo.com/lite   0 results — answers with an anomaly.js challenge
 *   html.duckduckgo.com/html   0 results — same
 *   searx.be   ?format=json    disabled, returns the HTML page
 *   priv.au    ?format=json    429
 *   Wikipedia action API       works, no key, no scraping
 *
 * So general search is not a money problem, it is a blocked-by-the-engine
 * problem, and the honest answer is a narrower tool that works rather than a
 * broad one that fails intermittently. For this product the narrowing costs
 * little: an author checking a period detail, a place, a custom, a term or a
 * person is asking an encyclopaedia question, and the three language editions
 * here are exactly the three languages this product writes in.
 *
 * The request leaves from the extension host — the author's machine, their
 * network, their proxy — through IFetcherService. Nothing reaches our server,
 * nothing is billed, and an author working offline gets a plain failure rather
 * than a silent empty answer.
 *
 * A summary is a starting point, not a source. The result tells the model to
 * open the page with the fetch tool when the detail matters, because a
 * one-sentence extract is where a confidently wrong detail comes from.
 */

import type * as vscode from 'vscode';
import { IFetcherService } from '../../platform/networking/common/fetcherService';
import { ToolName } from '../../extension/tools/common/toolNames';
import { ICopilotTool, ToolRegistry } from '../../extension/tools/common/toolsRegistry';
import { LanguageModelTextPart, LanguageModelToolResult, MarkdownString } from '../../vscodeTypes';

export interface ILookUpReferenceParams {
	query: string;
	/** Which Wikipedia edition to ask. Defaults to Chinese. */
	language?: 'zh' | 'ja' | 'en';
	maxResults?: number;
}

interface WikiHit {
	readonly title: string;
	readonly snippet: string;
	readonly url: string;
}

const DEFAULT_RESULTS = 5;
const MAX_RESULTS = 10;

/** The editions this product writes in; anything else is rejected rather than guessed at. */
const EDITIONS = new Set(['zh', 'ja', 'en']);

export class ReferenceLookupTool implements ICopilotTool<ILookUpReferenceParams> {
	public static toolName = ToolName.LookUpReference;

	constructor(
		@IFetcherService private readonly fetcherService: IFetcherService,
	) { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ILookUpReferenceParams>, token: vscode.CancellationToken) {
		const query = options.input.query?.trim();
		if (!query) {
			return new LanguageModelToolResult([new LanguageModelTextPart('No query was given.')]);
		}

		const language = EDITIONS.has(options.input.language ?? '') ? options.input.language! : 'zh';
		const limit = Math.min(Math.max(options.input.maxResults ?? DEFAULT_RESULTS, 1), MAX_RESULTS);

		let hits: readonly WikiHit[];
		try {
			hits = await this.search(query, language, limit, token);
		} catch (err) {
			// The failure an author will actually hit is no network, and saying so
			// is the whole value: a lookup that fails quietly is answered from the
			// model's memory, which is the thing the lookup existed to prevent.
			return new LanguageModelToolResult([new LanguageModelTextPart(
				`The lookup could not be made (${err instanceof Error ? err.message : String(err)}). ` +
				`Do not answer this from memory — tell the author the reference could not be reached.`)]);
		}

		if (hits.length === 0) {
			return new LanguageModelToolResult([new LanguageModelTextPart(
				`Nothing in the ${language} encyclopaedia matches "${query}". ` +
				`Try another wording or another language edition before concluding it does not exist.`)]);
		}

		const lines = [`${hits.length} encyclopaedia entries for "${query}" (${language}):`, ''];
		for (const hit of hits) {
			lines.push(`## ${hit.title}`);
			lines.push(hit.url);
			if (hit.snippet) {
				lines.push(hit.snippet);
			}
			lines.push('');
		}
		lines.push('These are extracts. Open a page with the fetch tool before relying on a date, a number or a quotation.');

		return new LanguageModelToolResult([new LanguageModelTextPart(lines.join('\n'))]);
	}

	private async search(query: string, language: string, limit: number, token: vscode.CancellationToken): Promise<readonly WikiHit[]> {
		const url = `https://${language}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&origin=*`;

		const abort = this.fetcherService.makeAbortController();
		const cancellation = token.onCancellationRequested(() => abort.abort());
		try {
			const response = await this.fetcherService.fetch(url, {
				method: 'GET',
				callSite: 'novel.referenceLookup',
				// The API asks callers to identify themselves; an anonymous client
				// is the one they rate-limit first.
				headers: { 'Api-User-Agent': 'VSNovel/1.0 (manuscript research)' },
				signal: abort.signal,
			});
			if (!response.ok) {
				throw new Error(`${response.status} ${response.statusText}`);
			}
			return parseWikipediaSearch(await response.text(), language);
		} finally {
			cancellation.dispose();
		}
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ILookUpReferenceParams>): vscode.PreparedToolInvocation {
		const query = options.input.query ?? '';
		return {
			invocationMessage: new MarkdownString(`Looking up \`${query}\``),
			pastTenseMessage: new MarkdownString(`Looked up \`${query}\``),
		};
	}
}

/**
 * Exported for the tests: the response shape is the contract, and a silently
 * changed one produces an empty answer that reads like "nothing was found".
 */
export function parseWikipediaSearch(body: string, language: string): readonly WikiHit[] {
	let parsed: any;
	try {
		parsed = JSON.parse(body);
	} catch {
		throw new Error('the encyclopaedia returned something that is not JSON');
	}

	const results = parsed?.query?.search;
	if (!Array.isArray(results)) {
		return [];
	}

	return results.flatMap((entry: any): WikiHit[] => {
		const title = typeof entry?.title === 'string' ? entry.title : '';
		if (!title) {
			return [];
		}
		return [{
			title,
			// Snippets arrive as HTML with the matched words wrapped for
			// highlighting; the model wants the sentence, not the markup.
			snippet: stripHtml(typeof entry?.snippet === 'string' ? entry.snippet : ''),
			url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
		}];
	});
}

function stripHtml(value: string): string {
	return value
		.replace(/<[^>]*>/g, '')
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ')
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/\s+/g, ' ')
		.trim();
}

ToolRegistry.registerTool(ReferenceLookupTool);
