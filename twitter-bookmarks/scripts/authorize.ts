/**
 * One-time (or re-auth) X OAuth 2.0 PKCE consent flow, run locally.
 *
 * Default mode — local catcher (X auth codes expire in ~30s, so the exchange
 * must be automatic):
 *
 *   npx tsx scripts/authorize.ts
 *
 * Starts a listener on http://localhost:8787/callback (must be registered as
 * a callback URI on the X app), prints the authorize URL, and waits. Approve
 * in a browser logged into x.com; the redirect lands on the listener, which
 * exchanges the code instantly (HTTP Basic auth, as X requires), verifies it
 * against /2/users/me, and prints the `ntn workers env set X_REFRESH_TOKEN=…`
 * command.
 *
 * Reads X_OAUTH_CLIENT_ID / X_OAUTH_CLIENT_SECRET from .env.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const PORT = 8787;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = "bookmark.read tweet.read users.read offline.access";

function env(name: string): string {
	const line = readFileSync(join(ROOT, ".env"), "utf8")
		.split("\n")
		.find((l) => l.startsWith(`${name}=`));
	const value = line?.slice(name.length + 1).trim() ?? "";
	if (!value) throw new Error(`${name} missing from .env`);
	return value;
}

async function exchange(
	clientId: string,
	clientSecret: string,
	code: string,
	verifier: string,
): Promise<{ access_token: string; refresh_token: string }> {
	const res = await fetch("https://api.x.com/2/oauth2/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
		},
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
		}),
	});
	if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
	return (await res.json()) as { access_token: string; refresh_token: string };
}

async function main() {
	const clientId = env("X_OAUTH_CLIENT_ID");
	const clientSecret = env("X_OAUTH_CLIENT_SECRET");

	const verifier = randomBytes(32).toString("base64url");
	const challenge = createHash("sha256").update(verifier).digest("base64url");
	const state = randomBytes(16).toString("hex");

	const url = new URL("https://x.com/i/oauth2/authorize");
	url.search = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		scope: SCOPE,
		state,
		code_challenge: challenge,
		code_challenge_method: "S256",
	}).toString();

	const code = await new Promise<string>((resolve, reject) => {
		const server = createServer((req, res) => {
			const reqUrl = new URL(req.url ?? "/", REDIRECT_URI);
			if (reqUrl.pathname !== "/callback") {
				res.writeHead(404).end();
				return;
			}
			const gotCode = reqUrl.searchParams.get("code");
			const gotState = reqUrl.searchParams.get("state");
			if (!gotCode || gotState !== state) {
				res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad state or missing code.");
				return;
			}
			res
				.writeHead(200, { "Content-Type": "text/plain" })
				.end("Authorized — you can close this tab.");
			server.close();
			resolve(gotCode);
		});
		server.on("error", reject);
		server.listen(PORT, () => {
			console.log("Waiting for authorization. Open:\n");
			console.log(url.toString());
			console.log();
		});
	});

	const tokens = await exchange(clientId, clientSecret, code, verifier);

	const me = await fetch("https://api.x.com/2/users/me", {
		headers: { Authorization: `Bearer ${tokens.access_token}` },
	});
	const who = me.ok
		? ((await me.json()) as { data: { username: string } }).data.username
		: "(lookup failed)";

	console.log(`\nAuthorized as @${who}. Seed the worker env:\n`);
	console.log(`ntn workers env set X_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
