/*---------------------------------------------------------------------------------------------
 *  VS Novel — the deployment's addresses, read from product.json.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { env } from 'vscode';

/**
 * Where this build's server lives.
 *
 * Read from product.json rather than from constants here, so the deployment's
 * address has one definition and a build pointed at staging talks to staging.
 * Resolved through `env.appRoot`, which is how the rest of the extension reaches
 * product.json (microsoftExperimentationService.ts:167) — a path relative to
 * this file works from source and breaks in a bundle.
 */
function defaultChatAgent(): Record<string, unknown> | undefined {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const product = require(join(env.appRoot, 'product.json'));
		return product?.defaultChatAgent;
	} catch {
		return undefined;
	}
}

function stringField(name: string): string | undefined {
	const value = defaultChatAgent()?.[name];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The entitlement endpoint: account state and the credit balance. */
export function entitlementUrl(): string | undefined {
	return stringField('entitlementUrl');
}

/** The account page an author manages their balance on. */
export function accountUrl(): string | undefined {
	return stringField('accountUrl');
}

/** The server's public origin, derived from the entitlement URL. */
export function serverOrigin(): string | undefined {
	const url = entitlementUrl();
	if (!url) {
		return undefined;
	}
	try {
		return new URL(url).origin;
	} catch {
		return undefined;
	}
}
