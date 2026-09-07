import type { tags } from "typia";
import type { NonEmptyString } from "./primitives";

/** One SMTP server configuration under test. Passwords are accepted
 * for credential verification and are never persisted or logged. */
export interface SettingsTestSmtpServer {
	/** Display name for the pool under test. */
	name?: string | undefined;
	/** SMTP hostname. */
	host: NonEmptyString;
	/** SMTP port. */
	port: number & tags.Minimum<1>;
	/** Hello hostname announced to the server. */
	hello_hostname?: string | undefined;
	/** Auth protocol: none, plain, cram-md5, login. */
	auth_protocol?: ("none" | "plain" | "cram-md5" | "login") | undefined;
	/** Username for authenticated protocols. */
	username?: string | undefined;
	/** Password for authenticated protocols; never persisted. */
	password?: string | undefined;
	/** TLS strategy. */
	tls_type?: ("none" | "STARTTLS" | "TLS" | "SSL") | undefined;
	tls_skip_verify?: boolean | undefined;
	/** Maximum concurrent connections the pool may open. */
	max_conns?: (number & tags.Minimum<1>) | undefined;
	/** Message delivery retry limit. */
	max_msg_retries?: (number & tags.Minimum<0>) | undefined;
	/** Delay between retries as a Go duration string (e.g. "1s"). */
	msg_retry_delay?: string | undefined;
	/** Idle connection timeout as a Go duration string. */
	idle_timeout?: string | undefined;
	/** Pool wait timeout as a Go duration string. */
	wait_timeout?: string | undefined;
	/** Custom headers applied to test messages. */
	email_headers?: Record<string, string>[] | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

export type SettingsTestSmtpInput = {
	/** Recipient of the real test message. */
	email: NonEmptyString & tags.Format<"email"> & tags.MaxLength<254>;
	/** SMTP server configuration under test. */
	server: SettingsTestSmtpServer;
};

export interface SettingsTestSmtpOutput {
	/** Whether the test message was accepted for delivery. */
	sent: boolean;
	/** Server log-buffer lines captured around the test attempt. */
	logs: string[];
}

export interface SettingsGetOutput {
	/**
	 * Installation settings with credential-bearing fields recursively
	 * replaced by "[redacted]" (passwords, secrets, API keys, tokens).
	 */
	settings: Record<string, unknown>;
}
