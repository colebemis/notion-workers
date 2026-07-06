/**
 * X OAuth 2.0 token management, done in worker code.
 *
 * Notion Workers' built-in `worker.oauth()` fails against X: X requires
 * HTTP Basic auth at its token endpoint for confidential clients, and the
 * Workers backend sends credentials another way ("OAuth refresh failed with
 * status 401"). So this worker owns the token lifecycle itself:
 *
 *   - `scripts/authorize.ts` runs the one-time PKCE consent flow and prints
 *     a refresh token, seeded into the X_REFRESH_TOKEN env var.
 *   - Each sync cycle calls `ensureFreshTokens`; X rotates refresh tokens on
 *     every use, so the live family rides in the sync's persisted state.
 *   - If the family dies (state reset, missed rotation), re-run
 *     scripts/authorize.ts and update X_REFRESH_TOKEN — the seed change is
 *     detected and adopted automatically.
 */

export type TokenState = {
	accessToken: string;
	refreshToken: string;
	accessExpiresAt: number; // epoch ms
	seed: string; // env seed this family grew from, for re-auth detection
};

const TOKEN_ENDPOINT = "https://api.x.com/2/oauth2/token";
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/** Returns a valid token state, refreshing (and rotating) when stale. */
export async function ensureFreshTokens(prev: TokenState | undefined): Promise<TokenState> {
	const seed = process.env.X_REFRESH_TOKEN ?? "";
	if (!seed) {
		throw new Error(
			"X_REFRESH_TOKEN is not set. Run `npx tsx scripts/authorize.ts` and set it with `ntn workers env set`.",
		);
	}

	// A changed env seed means the user re-authorized; it wins over state.
	const current = prev && prev.seed === seed ? prev : undefined;
	if (current && Date.now() < current.accessExpiresAt - EXPIRY_BUFFER_MS) return current;

	const clientId = process.env.X_OAUTH_CLIENT_ID ?? "";
	const clientSecret = process.env.X_OAUTH_CLIENT_SECRET ?? "";
	const res = await fetch(TOKEN_ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: current?.refreshToken ?? seed,
		}),
	});
	if (!res.ok) {
		const body = (await res.text()).slice(0, 300);
		throw new Error(
			`X token refresh failed (${res.status}): ${body} — if this persists, the refresh-token ` +
				"family is dead; re-run `npx tsx scripts/authorize.ts` and update X_REFRESH_TOKEN.",
		);
	}
	const json = (await res.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
	};
	return {
		accessToken: json.access_token,
		refreshToken: json.refresh_token ?? current?.refreshToken ?? seed,
		accessExpiresAt: Date.now() + (json.expires_in ?? 7200) * 1000,
		seed,
	};
}
