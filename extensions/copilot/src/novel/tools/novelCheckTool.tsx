/*---------------------------------------------------------------------------------------------
 *  VS Novel — the checker, as a tool the agent calls.
 *--------------------------------------------------------------------------------------------*/

/**
 * The counterpart of running the test suite.
 *
 * `get_errors` reports what the author's Problems panel holds, which is the
 * right answer to "what is the author looking at" and the wrong one to "is what
 * I just wrote correct": the panel follows the author's own settings, its
 * default mode publishes nothing so a new manuscript is not covered in
 * squiggles, and it only covers open files. This tool re-runs the checks
 * instead, over whatever files it is asked about.
 *
 * Findings are returned as text rather than as a structured payload because the
 * consumer is a language model that has to act on them, and "第三章.md:120
 * 「穆雷利亚」should be 「穆蕾莉亚」" is already the instruction.
 */

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { IFileSystemService } from '../../platform/filesystem/common/fileSystemService';
import { IPromptPathRepresentationService } from '../../platform/prompts/common/promptPathRepresentationService';
import { IWorkspaceService } from '../../platform/workspace/common/workspaceService';
import { ToolName } from '../../extension/tools/common/toolNames';
import { ICopilotTool, ToolRegistry } from '../../extension/tools/common/toolsRegistry';
import { LanguageModelTextPart, LanguageModelToolResult, MarkdownString } from '../../vscodeTypes';
import { CheckedFile, checkManuscript, ManuscriptFinding } from '../check/manuscriptCheck';
import { loadRecords } from '../check/recordLoader';

export interface INovelCheckParams {
	/** Absolute paths. Omitted means every chapter the records mention nothing about — see below. */
	filePaths?: string[];
}

export class NovelCheckTool implements ICopilotTool<INovelCheckParams> {
	public static toolName = ToolName.NovelCheck;

	constructor(
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
	) { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<INovelCheckParams>, _token: vscode.CancellationToken) {
		const records = await loadRecords(this.fileSystemService, this.workspaceService);
		const files = await this.readRequested(options.input.filePaths ?? []);
		const findings = checkManuscript(files, records);

		return new LanguageModelToolResult([
			new LanguageModelTextPart(this.report(findings, files, records.problems)),
		]);
	}

	private async readRequested(paths: readonly string[]): Promise<CheckedFile[]> {
		const files: CheckedFile[] = [];
		for (const path of paths) {
			const uri = this.promptPathRepresentationService.resolveFilePath(path);
			if (!uri) {
				continue;
			}
			try {
				const bytes = await this.fileSystemService.readFile(uri);
				files.push({ path: this.workspaceService.asRelativePath(uri), text: new TextDecoder().decode(bytes) });
			} catch {
				// A path the agent guessed wrong is not a finding about the
				// manuscript, and reporting it as one would send it editing.
			}
		}
		return files;
	}

	/**
	 * Says what was checked even when nothing was wrong.
	 *
	 * "No problems found" and "the checker never ran" are the same string
	 * otherwise, and the agent cannot tell a clean chapter from an empty story
	 * bible — the second of which it should probably mention to the author.
	 */
	private report(findings: readonly ManuscriptFinding[], files: readonly CheckedFile[], problems: readonly string[]): string {
		const lines: string[] = [];

		if (problems.length) {
			lines.push('Records that could not be used:');
			lines.push(...problems.map(p => `- ${p}`), '');
		}

		if (findings.length === 0) {
			lines.push(files.length
				? `No problems found in ${files.map(f => f.path).join(', ')}.`
				: 'No problems found. No chapter was given to check, so this covers the story bible only.');
			return lines.join('\n');
		}

		const inFiles = findings.filter(f => f.file);
		const acrossWork = findings.filter(f => !f.file);

		if (inFiles.length) {
			lines.push('In the chapters checked:');
			lines.push(...inFiles.map(f => `- ${f.file}${f.start === undefined ? '' : ` @${f.start}`} [${f.kind}] ${f.message}`));
		}
		if (acrossWork.length) {
			if (inFiles.length) {
				lines.push('');
			}
			// Kept separate because they are not fixed by editing the chapter that
			// was checked; the agent needs to know it is being told about the work.
			lines.push('Across the work:');
			lines.push(...acrossWork.map(f => `- [${f.kind}] ${f.message}`));
		}

		return lines.join('\n');
	}

	async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<INovelCheckParams>): Promise<vscode.PreparedToolInvocation> {
		const count = options.input.filePaths?.length ?? 0;
		return {
			invocationMessage: new MarkdownString(count === 1
				? l10n.t`Checking the chapter`
				: l10n.t`Checking the manuscript`),
			pastTenseMessage: new MarkdownString(l10n.t`Checked the manuscript`),
		};
	}
}

ToolRegistry.registerTool(NovelCheckTool);
