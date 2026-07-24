/*---------------------------------------------------------------------------------------------
 *  VS Novel — finding-selection tests.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { findingsFrom, isPositioned } from '../nameFindings';
import { Character, NameIndex } from '../nameIndex';

const LI: Character = { id: 'li', canonical: '李慕白', aliases: ['慕白', '李剑仙'] };

describe('findingsFrom', () => {
	it('reports drift once, carrying the rest as related ranges', () => {
		// Underlining all twenty uses of 慕白 turns the page yellow and says
		// nothing the first one did not.
		const prose = '慕白提剑。慕白转身。慕白走了。';
		const findings = findingsFrom(NameIndex.build([LI]).check(prose));

		expect(findings).toHaveLength(1);
		expect(findings[0].kind).toBe('aliasDrift');
		expect(findings[0].start).toBe(0);
		expect(findings[0].relatedRanges).toHaveLength(2);
	});

	it('offers the canonical name as the replacement', () => {
		const findings = findingsFrom(NameIndex.build([LI]).check('慕白提剑。'));
		expect(findings[0].replaceWith).toBe('李慕白');
		expect(findings[0].canonical).toBe('李慕白');
	});

	it('finds nothing when the canonical name is present', () => {
		expect(findingsFrom(NameIndex.build([LI]).check('李慕白提剑，慕白转身。'))).toEqual([]);
	});

	// An ambiguous form is a mistake in the character files, not in the prose.
	// Anchoring it to a paragraph would send the author to the wrong file, and
	// there is no single correct replacement to offer.
	it('reports ambiguity without a position or a fix', () => {
		const ix = NameIndex.build([
			{ id: 'a', canonical: '甲', aliases: ['小师弟'] },
			{ id: 'b', canonical: '乙', aliases: ['小师弟'] },
		]);
		const [finding] = findingsFrom(ix.check('小师弟来了。'));

		expect(finding.kind).toBe('ambiguous');
		expect(finding.replaceWith).toBeUndefined();
		expect(isPositioned(finding)).toBe(false);
	});

	it('does not report an address form as drift', () => {
		const ix = NameIndex.build([
			LI,
			{ id: 'zhang', canonical: '张小凡', addresses: [{ to: 'li', as: '师父' }] },
		]);
		expect(findingsFrom(ix.check('师父点头。', { pov: 'zhang' }))).toEqual([]);
	});

	it('orders positioned findings by document position', () => {
		const ix = NameIndex.build([LI, { id: 'wang', canonical: '王五', aliases: ['老王'] }]);
		const findings = findingsFrom(ix.check('老王走过来，慕白抬起头。'));
		expect(findings.map(f => f.canonical)).toEqual(['王五', '李慕白']);
	});
});
