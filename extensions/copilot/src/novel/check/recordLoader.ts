/*---------------------------------------------------------------------------------------------
 *  VS Novel — reading the story bible off disk.
 *--------------------------------------------------------------------------------------------*/

/**
 * Loads what the checks need, from `.novel/`.
 *
 * Directory listing rather than a glob search, for a reason worth stating: a
 * search service answers with what its index knows, and a record the agent wrote
 * one turn ago may not be in it yet. Checking your own work against a stale index
 * is worse than not checking, because it reports success.
 *
 * A file that fails to parse costs that file and is reported. It never stops the
 * others loading — the same rule the record parsers themselves follow, for the
 * same reason: a story bible that refuses to load looks exactly like a
 * manuscript with nothing wrong in it.
 */

import { FileType } from '../../platform/filesystem/common/fileTypes';
import type { IFileSystemService } from '../../platform/filesystem/common/fileSystemService';
import type { IWorkspaceService } from '../../platform/workspace/common/workspaceService';
import { URI } from '../../util/vs/base/common/uri';
import { parseFactsFile, parseForeshadowFile } from '../facts/factFile';
import { parseCharacter } from '../names/characterFile';
import { glossaryOf, parseGlossaryFile } from '../glossary/glossaryFile';
import type { CheckInputs } from './manuscriptCheck';

export interface LoadedRecords extends CheckInputs {
	/** Files that could not be read or parsed, in the author's terms. */
	readonly problems: readonly string[];
}

const DIRECTORIES = {
	characters: '.novel/characters',
	facts: '.novel/facts',
	foreshadow: '.novel/foreshadow',
	glossary: '.novel/glossary',
} as const;

export async function loadRecords(
	fileSystem: IFileSystemService,
	workspace: IWorkspaceService,
): Promise<LoadedRecords> {
	const problems: string[] = [];
	const characters = [];
	const facts = [];
	const threads = [];
	const glossaryTerms = [];

	for (const folder of workspace.getWorkspaceFolders()) {
		for (const [path, text] of await readAll(fileSystem, folder, DIRECTORIES.characters, problems)) {
			const character = parseCharacter(path, text);
			if (character) {
				characters.push(character);
			} else {
				problems.push(`${path}: not a usable character record`);
			}
		}

		for (const [path, text] of await readAll(fileSystem, folder, DIRECTORIES.facts, problems)) {
			const parsed = parseFactsFile(text);
			facts.push(...parsed.entries);
			problems.push(...parsed.problems.map(p => `${path} entry ${p.at}: ${p.message}`));
		}

		for (const [path, text] of await readAll(fileSystem, folder, DIRECTORIES.foreshadow, problems)) {
			const parsed = parseForeshadowFile(text);
			threads.push(...parsed.entries);
			problems.push(...parsed.problems.map(p => `${path} entry ${p.at}: ${p.message}`));
		}

		for (const [path, text] of await readAll(fileSystem, folder, DIRECTORIES.glossary, problems)) {
			const parsed = parseGlossaryFile(text);
			glossaryTerms.push(...parsed.entries);
			problems.push(...parsed.problems.map(p => `${path} entry ${p.at}: ${p.message}`));
		}
	}

	return { characters, facts, threads, glossary: glossaryOf(glossaryTerms), problems };
}

/**
 * Every readable file directly under one record directory.
 *
 * A missing directory is not a problem to report — most manuscripts keep some of
 * these and not others, and saying so on every check would train the author to
 * ignore the output.
 */
async function readAll(
	fileSystem: IFileSystemService,
	folder: URI,
	relative: string,
	problems: string[],
): Promise<[string, string][]> {
	const directory = URI.joinPath(folder, relative);
	let entries: [string, FileType][];
	try {
		entries = await fileSystem.readDirectory(directory);
	} catch {
		return [];
	}

	const out: [string, string][] = [];
	for (const [name, type] of entries) {
		if (type !== FileType.File || name.startsWith('.')) {
			continue;
		}
		try {
			const bytes = await fileSystem.readFile(URI.joinPath(directory, name));
			out.push([`${relative}/${name}`, new TextDecoder().decode(bytes)]);
		} catch (err) {
			problems.push(`${relative}/${name}: could not be read (${err instanceof Error ? err.message : String(err)})`);
		}
	}
	return out;
}
