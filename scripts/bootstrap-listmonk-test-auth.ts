import {
	appendFileSync,
	chmodSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";

const EXPECTED_LISTMONK_VERSION = "6.2.0";
const apiUrl = (
	process.env.LISTMONK_API_URL || "http://localhost:9000/api"
).replace(/\/$/, "");
const bootstrapUsername =
	process.env.LISTMONK_BOOTSTRAP_USERNAME || "api-bootstrap";
const bootstrapToken =
	process.env.LISTMONK_BOOTSTRAP_TOKEN || "listmonk-ops-bootstrap-token";
const targetUsername = process.env.LISTMONK_TEST_API_USERNAME || "api-admin";
const tokenFile =
	process.env.LISTMONK_TEST_TOKEN_FILE || "/tmp/listmonk-ops-api-token";

const parsedApiUrl = new URL(apiUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsedApiUrl.hostname)) {
	throw new Error(
		`Refusing to bootstrap credentials for non-local URL ${apiUrl}`,
	);
}

type ApiUser = {
	id: number;
	username: string;
	type: string;
	password?: string;
};

function authHeader(username: string, token: string): string {
	return `token ${username}:${token}`;
}

async function requestJson<T>(
	path: string,
	init: RequestInit = {},
	username = bootstrapUsername,
	token = bootstrapToken,
): Promise<T> {
	const response = await fetch(`${apiUrl}${path}`, {
		...init,
		headers: {
			Authorization: authHeader(username, token),
			...(init.body ? { "Content-Type": "application/json" } : {}),
			...init.headers,
		},
	});

	if (!response.ok) {
		const detail = await response.text();
		throw new Error(
			`${init.method || "GET"} ${path} failed (${response.status}): ${detail}`,
		);
	}

	return (await response.json()) as T;
}

async function tokenIsValid(token: string): Promise<boolean> {
	try {
		await requestJson("/lists?page=1&per_page=1", {}, targetUsername, token);
		return true;
	} catch {
		return false;
	}
}

function persistToken(token: string): void {
	writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
	chmodSync(tokenFile, 0o600);

	if (process.env.GITHUB_ACTIONS === "true") {
		console.log(`::add-mask::${token}`);
	}

	if (process.env.GITHUB_ENV) {
		appendFileSync(
			process.env.GITHUB_ENV,
			`LISTMONK_API_URL=${apiUrl}\nLISTMONK_USERNAME=${targetUsername}\nLISTMONK_API_TOKEN=${token}\n`,
		);
	}
}

const suppliedToken = process.env.LISTMONK_API_TOKEN?.trim();
if (suppliedToken && (await tokenIsValid(suppliedToken))) {
	persistToken(suppliedToken);
	console.log(`Validated Listmonk API token for ${targetUsername}`);
	process.exit(0);
}

if (existsSync(tokenFile)) {
	const cachedToken = readFileSync(tokenFile, "utf8").trim();
	if (cachedToken && (await tokenIsValid(cachedToken))) {
		persistToken(cachedToken);
		console.log(`Reused local Listmonk API token for ${targetUsername}`);
		process.exit(0);
	}
}

const about = await requestJson<{ version?: string }>("/about");
if (about.version?.replace(/^v/, "") !== EXPECTED_LISTMONK_VERSION) {
	throw new Error(
		`Expected Listmonk ${EXPECTED_LISTMONK_VERSION}, received ${about.version || "unknown"}`,
	);
}

const usersResponse = await requestJson<{ data?: ApiUser[] }>("/users");
const existingUser = usersResponse.data?.find(
	(user) => user.username === targetUsername && user.type === "api",
);
if (existingUser) {
	await requestJson(`/users/${existingUser.id}`, { method: "DELETE" });
}

const createResponse = await requestJson<{ data?: ApiUser }>("/users", {
	method: "POST",
	body: JSON.stringify({
		username: targetUsername,
		name: "listmonk-ops local test API",
		type: "api",
		status: "enabled",
		user_role_id: 1,
	}),
});
const generatedToken = createResponse.data?.password;
if (!generatedToken) {
	throw new Error("Listmonk did not return the one-time API token");
}
if (!(await tokenIsValid(generatedToken))) {
	throw new Error("Listmonk rejected the newly generated API token");
}

persistToken(generatedToken);
console.log(
	`Provisioned ${targetUsername} for Listmonk ${EXPECTED_LISTMONK_VERSION}; token saved to ${tokenFile}`,
);
