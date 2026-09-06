export interface SettingsGetOutput {
	/**
	 * Installation settings with credential-bearing fields recursively
	 * replaced by "[redacted]" (passwords, secrets, API keys, tokens).
	 */
	settings: Record<string, unknown>;
}
