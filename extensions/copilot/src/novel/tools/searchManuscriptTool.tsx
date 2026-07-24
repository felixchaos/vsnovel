/*---------------------------------------------------------------------------------------------
 *  VS Novel — ranked manuscript search, as a tool the agent calls.
 *--------------------------------------------------------------------------------------------*/

/**
 * The replacement for `copilot_searchCodebase`, which is gated in this product
 * because its tokenizer is built for code identifiers and extracts nothing from
 * Chinese.
 *
 * `copilot_findTextInFiles` is ripgrep and stays the backbone for exact lookups.
 * What it lacks is an order: over a long manuscript, a common word matches in
 * dozens of chapters and arrives in whatever order the walk found them. This
 * ranks them, and refuses to show the ones the author has not written up to yet
 * when they say where they are standing.
 */

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { IFileSystemService } from '../../platform/filesystem/common/fileSystemService';
import { IWorkspaceService } from '../../platform/workspace/common/workspaceService';
import { FileType } from '../../platform/filesystem/common/fileTypes';
import { ToolName } from '../../extension/tools/common/toolNames';
import { ICopilotTool, ToolRegistry } from '../../extension/tools/common/toolsRegistry';
import { URI } from '../../util/vs/base/common/uri';
import { LanguageModelTextPart, LanguageModelToolResult, MarkdownString } from '../../vscodeTypes';
import { SearchableFile, searchManuscript } from '../retrieval/manuscriptSearch';

export interface ISearchManuscriptParams {
	query: string;
	/** The chapter being written. Omitted searches the whole work. */
	currentChapter?: number;
	maxResults?: number;
}

const CHAPTER_EXTENSIONS = ['.md', '.txt'];
/** Directories that are records about the work rather than the work. */
const NOT_PROSE = new Set(['.novel', '.git', '.github', '.vscode', 'node_modules']);

export class SearchManuscriptTool implements ICopilotTool<ISearchManuscriptParams> {
	public static toolName = ToolName.SearchManuscript;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
	) { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<ISearchManuscriptParams>, token: vscode.CancellationToken) {
		const { query, currentChapter, maxResults } = options.input;
		if (!query?.trim()) {
			return new LanguageModelToolResult([new LanguageModelTextPart('No query was given.')]);
		}

		const files = await this.collectChapters(token);
		const { results, withheld } = searchManuscript(files, query, { currentChapter, limit: maxResults });

		const lines: string[] = [];
		if (results.length === 0) {
			lines.push(files.length === 0
				? 'No chapters were found to search. Chapters are .md or .txt files in the workspace.'
				: `Nothing in the manuscript matches "${query}".`);
		} else {
			// Ascending by chapter, which is how twoStageRank presents them: a
			// model reading top to bottom takes earlier passages as history and
			// later ones as consequence, and reversing that invents a plot.
			lines.push(`${results.length} passage(s) for "${query}", in chapter order:`, '');
			for (const result of results) {
				lines.push(`--- ${result.path}${result.chapter === undefined ? '' : ` (chapter ${result.chapter})`}`);
				lines.push(result.text.trim(), '');
			}
		}

		if (withheld > 0) {
			// Never silent. A search that quietly returns less is
			// indistinguishable from a search that found less, and the two call
			// for opposite responses.
			lines.push(`${withheld} passage(s) were withheld because they come after chapter ${currentChapter}. ` +
				`Ask again without currentChapter if you need them.`);
		}

		return new LanguageModelToolResult([new LanguageModelTextPart(lines.join('\n'))]);
	}

	/**
	 * Every chapter in the workspace.
	 *
	 * Walked rather than searched, for the same reason the checker loads records
	 * by listing: a search index does not contain the chapter written one turn
	 * ago, and an agent looking for what it just wrote would be told it is not
	 * there.
	 */
	private async collectChapters(token: vscode.CancellationToken): Promise<SearchableFile[]> {
		const files: SearchableFile[] = [];
		for (const folder of this.workspaceService.getWorkspaceFolders()) {
			await this.walk(folder, '', files, token);
		}
		return files;
	}

	private async walk(directory: URI, prefix: string, out: SearchableFile[], token: vscode.CancellationToken): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}
		let entries: [string, FileType][];
		try {
			entries = await this.fileSystemService.readDirectory(directory);
		} catch {
			return;
		}

		for (const [name, type] of entries) {
			if (name.startsWith('.') && type === FileType.Directory) {
				continue;
			}
			const relative = prefix ? `${prefix}/${name}` : name;
			if (type === FileType.Directory) {
				if (!NOT_PROSE.has(name)) {
					await this.walk(URI.joinPath(directory, name), relative, out, token);
				}
				continue;
			}
			if (!CHAPTER_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext))) {
				continue;
			}
			try {
				const bytes = await this.fileSystemService.readFile(URI.joinPath(directory, name));
				out.push({ path: relative, text: new TextDecoder().decode(bytes) });
			} catch {
				// An unreadable file is not a search result and not an error the
				// agent can act on.
			}
		}
	}

	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ISearchManuscriptParams>): Promise<vscode.PreparedToolInvocation> {
		return {
			invocationMessage: new MarkdownString(l10n.t`Searching the manuscript for "${options.input.query ?? ''}"`),
			pastTenseMessage: new MarkdownString(l10n.t`Searched the manuscript`),
		};
	}
}

ToolRegistry.registerTool(SearchManuscriptTool);
