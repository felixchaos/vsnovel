/*---------------------------------------------------------------------------------------------
 *  VS Novel — the three languages this product is for.
 *--------------------------------------------------------------------------------------------*/

/**
 * Which language a name, alias or entry is written in.
 *
 * Kept in a module of its own because the character record, the name index and
 * the diagnostics all need it and none of them should have to depend on another
 * feature to get it. It previously lived in the worldbook activator, which is
 * how three modules ended up importing a feature they had nothing to do with.
 */
export type LangCode = 'zh' | 'ja' | 'en';
