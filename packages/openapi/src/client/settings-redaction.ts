/** Marker used when settings credentials are redacted for safe display. */
export const SETTINGS_REDACTED_VALUE = "[redacted]";

const CREDENTIAL_QUERY_NAME_SUFFIX =
	/(?:^|_)(?:key|apikey|access_key|access_key_id|api_key_id|secret_key_id|key_id|key_pair_id|session_id|id_token_hint|client_assertion|assertion_token|saml_assertion|assertion|auth|authorization|credential|credentials|hmac|jwt|login|pass|password|passphrase|passwd|pwd|secret|sessid|session|sessionid|sig|signature|token|user|username)$/;

/** Match whole credential parameter names while preserving unrelated metadata. */
export function isSettingsCredentialQueryParameter(
	encodedName: string,
): boolean {
	let decodedName = encodedName;
	try {
		decodedName = decodeURIComponent(encodedName.replace(/\+/g, " "));
	} catch {
		// Keep malformed parameter names visible to the exact token matcher.
	}
	const normalizedName = decodedName
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_|_$/g, "");
	return CREDENTIAL_QUERY_NAME_SUFFIX.test(normalizedName);
}
