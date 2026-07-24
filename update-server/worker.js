// VS Novel — update server.
//
// A stateless Cloudflare Worker that speaks VS Code's update protocol and
// answers it from the open-source project's GitHub Releases. The editor polls
//
//     GET {updateUrl}/api/update/{platform}/{quality}/{commit}
//
// and expects either 204 (already current) or 200 with an IUpdate body
// { version, productVersion, timestamp, url, sha256hash }
// (src/vs/platform/update/common/update.ts). `version` is the build commit;
// the editor treats a response whose version equals its own running commit as
// "up to date", so returning the latest unconditionally is safe.
//
// The truth lives in the release, not here: the release CI attaches an
// `update-manifest.json` asset keyed by platform, so this Worker only routes.
// Nothing is persisted and nothing is signed here — the macOS updater verifies
// the Developer ID signature and the Windows updater verifies sha256hash, so a
// tampered asset is rejected downstream regardless of what this returns.

const REPO = 'felixchaos/vsnovel';
const GH_HEADERS = { 'User-Agent': 'vsnovel-update-server', 'Accept': 'application/vnd.github+json' };
const EDGE_TTL = 60; // seconds; a new release is visible within a minute.

export default {
	async fetch(request) {
		const url = new URL(request.url);

		if (url.pathname === '/' || url.pathname === '/health') {
			return new Response('vsnovel update server', { status: 200 });
		}

		// /api/update/{platform}/{quality}/{commit}
		const m = url.pathname.match(/^\/api\/update\/([^/]+)\/([^/]+)\/([^/]+)\/?$/);
		if (!m) {
			return new Response('not found', { status: 404 });
		}
		const platform = m[1];
		const commit = m[3];

		const manifest = await latestManifest();
		// No release yet, or the manifest names no build for this platform: the
		// editor treats 204 as "nothing to do", which is the honest answer.
		const entry = manifest?.platforms?.[platform];
		if (!entry) {
			return new Response(null, { status: 204 });
		}
		if (entry.version === commit) {
			return new Response(null, { status: 204 });
		}

		return Response.json({
			version: entry.version,
			productVersion: entry.productVersion ?? manifest.productVersion,
			timestamp: entry.timestamp ?? manifest.timestamp,
			url: entry.url,
			sha256hash: entry.sha256hash,
		});
	},
};

// latestManifest fetches update-manifest.json from the repo's latest release.
// Both hops are edge-cached briefly so a burst of editors polling at once costs
// the GitHub API at most one request per minute.
async function latestManifest() {
	const rel = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
		headers: GH_HEADERS,
		cf: { cacheTtl: EDGE_TTL, cacheEverything: true },
	});
	if (!rel.ok) {
		return null;
	}
	const release = await rel.json();
	const asset = (release.assets || []).find(a => a.name === 'update-manifest.json');
	if (!asset) {
		return null;
	}
	const mf = await fetch(asset.browser_download_url, {
		headers: { 'User-Agent': 'vsnovel-update-server' },
		cf: { cacheTtl: EDGE_TTL, cacheEverything: true },
	});
	if (!mf.ok) {
		return null;
	}
	return mf.json();
}
