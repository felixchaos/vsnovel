/*---------------------------------------------------------------------------------------------
 *  VS Novel — character file format.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reads a `world/characters/*.md` file into a {@link Character}.
 *
 * Same reasoning as the worldbook: the cast list is part of the manuscript, so
 * it lives in files the author can open, diff and version. The difference is
 * that this file also carries the address relations, which is the one thing in
 * the whole design that must not be inferred — see {@link AddressRelation}.
 *
 * Every dropped field is reported. A character whose aliases silently failed to
 * parse is a character whose drift is silently not detected, and the author
 * would experience that as the feature simply not working.
 */

import { MarkdownNode, parseFrontMatter, YamlNode } from '../../util/vs/base/common/yaml';
import type { LangCode } from '../lang';
import type { Aliases, AddressRelation, Character } from './nameIndex';

const LANG_CODES: readonly LangCode[] = ['zh', 'ja', 'en'];

export interface ParseProblem {
	readonly field: string;
	readonly message: string;
}

export interface ParseCharacterOptions {
	readonly onProblem?: (problem: ParseProblem) => void;
}

/**
 * Parses one character file.
 *
 * `id` is the caller's stable identity — the workspace-relative path — and is
 * what address relations point at. Deriving it from the name instead would make
 * renaming a character break every relation that referenced them, which is
 * exactly the operation this feature exists to make safe.
 *
 * Returns undefined when there is no canonical name, because a character with
 * no real name cannot anchor a drift report and would silently match nothing.
 */
export function parseCharacter(id: string, text: string, options: ParseCharacterOptions = {}): Character | undefined {
	const doc = parseFrontMatter(text) ?? new MarkdownNode(undefined, text);
	const report = (field: string, message: string) => options.onProblem?.({ field, message });

	const canonical = (doc.getStringValue('canonical') ?? doc.getStringValue('name'))?.trim();
	if (!canonical) {
		report('canonical', 'a character needs a canonical name; nothing else can anchor a drift report');
		return undefined;
	}

	return {
		id,
		canonical,
		aliases: readAliases(doc, report),
		addresses: readAddresses(doc, report),
	};
}

function readAliases(doc: MarkdownNode, report: (field: string, message: string) => void): Aliases | undefined {
	const flat = doc.getStringArrayValue('aliases');
	if (flat) {
		const cleaned = flat.filter(a => !!a.trim());
		return cleaned.length > 0 ? cleaned : undefined;
	}

	const node = property(doc, 'aliases');
	if (!node) {
		return undefined;
	}
	if (node.type !== 'map') {
		report('aliases', 'expected a list, or a map of language code to list');
		return undefined;
	}

	const buckets: Partial<Record<LangCode, string[]>> = {};
	for (const { key, value } of node.properties) {
		const lang = key.value.trim() as LangCode;
		if (!LANG_CODES.includes(lang)) {
			report('aliases', `unknown language "${key.value}"; expected one of ${LANG_CODES.join(', ')}`);
			continue;
		}
		if (value.type !== 'sequence') {
			report(`aliases.${lang}`, 'expected a list of surface forms');
			continue;
		}
		const forms = scalars(value).filter(v => !!v.trim());
		if (forms.length > 0) {
			buckets[lang] = forms;
		}
	}
	return Object.keys(buckets).length > 0 ? buckets : undefined;
}

/**
 * Reads the address relations.
 *
 * Shape is a list of maps:
 *
 * ```yaml
 * addresses:
 *   - to: world/characters/li-mubai.md
 *     as: 师父
 *     kind: 师徒
 * ```
 *
 * `to` is a character id, not a name, for the same reason ids exist at all.
 */
function readAddresses(doc: MarkdownNode, report: (field: string, message: string) => void): AddressRelation[] | undefined {
	const node = property(doc, 'addresses');
	if (!node) {
		return undefined;
	}
	if (node.type !== 'sequence') {
		report('addresses', 'expected a list of {to, as} entries');
		return undefined;
	}

	const relations: AddressRelation[] = [];
	for (const [i, item] of node.items.entries()) {
		if (item.type !== 'map') {
			report(`addresses[${i}]`, 'expected an entry with at least "to" and "as"');
			continue;
		}
		const fields = new Map(
			item.properties
				.filter(p => p.value.type === 'scalar')
				.map(p => [p.key.value.trim(), (p.value as Extract<YamlNode, { type: 'scalar' }>).value.trim()]),
		);
		const to = fields.get('to');
		const as = fields.get('as');
		if (!to || !as) {
			report(`addresses[${i}]`, 'both "to" (a character id) and "as" (the surface form) are required');
			continue;
		}
		const lang = fields.get('lang') as LangCode | undefined;
		if (lang && !LANG_CODES.includes(lang)) {
			report(`addresses[${i}].lang`, `unknown language "${lang}"; expected one of ${LANG_CODES.join(', ')}`);
			continue;
		}
		relations.push({ to, as, kind: fields.get('kind') || undefined, lang });
	}
	return relations.length > 0 ? relations : undefined;
}

function scalars(node: Extract<YamlNode, { type: 'sequence' }>): string[] {
	return node.items
		.filter((i): i is Extract<YamlNode, { type: 'scalar' }> => i.type === 'scalar')
		.map(i => i.value);
}

function property(doc: MarkdownNode, name: string): YamlNode | undefined {
	if (doc.header?.type !== 'map') {
		return undefined;
	}
	return doc.header.properties.find(p => p.key.value === name)?.value;
}
