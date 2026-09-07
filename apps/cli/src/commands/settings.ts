import { z } from "zod";
import type { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeGetSettingsOperation,
	invokeTestSmtpOperation,
	OperationExecutionError,
} from "@listmonk-ops/operations";
import { getOutput } from "../lib/output";
import {
	defineCommand,
	defineGroup,
	type HandlerArgs,
	option,
} from "../lib/command";
import { toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

type SettingsOutput = Pick<typeof OutputUtils, "json" | "success">;

export interface SettingsCliContext {
	client: Pick<ListmonkClient, "settings">;
	output: SettingsOutput;
}

export function createSettingsCommandError(
	context: string,
	error: unknown,
): Error {
	if (error instanceof OperationExecutionError) return error;
	return new Error(`${context}: ${toErrorMessage(error)}`, { cause: error });
}

export async function renderSettings(
	context: SettingsCliContext,
): Promise<void> {
	const { settings } = await invokeGetSettingsOperation(context, {});
	context.output.success("Installation settings (credentials redacted)");
	context.output.json(settings);
}

export async function renderTestSmtp(
	context: SettingsCliContext,
	input: {
		email: string;
		server: {
			name?: string;
			host: string;
			port: number;
			hello_hostname?: string;
			auth_protocol?: "none" | "plain" | "cram-md5" | "login";
			username?: string;
			password?: string;
			tls_type?: "none" | "STARTTLS" | "TLS" | "SSL";
			tls_skip_verify?: boolean;
			max_conns?: number;
			max_msg_retries?: number;
			msg_retry_delay?: string;
			idle_timeout?: string;
			wait_timeout?: string;
		};
	},
): Promise<void> {
	const result = await invokeTestSmtpOperation(context, input);
	context.output.success(
		`SMTP test message sent to ${input.email}; ${result.logs.length} log line(s)`,
	);
	context.output.json(result);
}

type TestSmtpCommandFlags = {
	email: string;
	host: string;
	port: number;
	name?: string;
	"hello-hostname"?: string;
	"auth-protocol"?: "none" | "plain" | "cram-md5" | "login";
	username?: string;
	password?: string;
	"tls-type"?: "none" | "STARTTLS" | "TLS" | "SSL";
	"tls-skip-verify"?: boolean;
	"max-conns"?: number;
	"max-msg-retries"?: number;
	"msg-retry-delay"?: string;
	"idle-timeout"?: string;
	"wait-timeout"?: string;
};

export async function handleTestSmtpCommand({
	flags,
	...args
}: HandlerArgs<TestSmtpCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderTestSmtp(
			{ client, output: getOutput() },
			{
				email: flags.email,
				server: {
					host: flags.host,
					port: flags.port,
					name: flags.name,
					hello_hostname: flags["hello-hostname"],
					auth_protocol: flags["auth-protocol"],
					username: flags.username,
					password: flags.password,
					tls_type: flags["tls-type"],
					tls_skip_verify: flags["tls-skip-verify"],
					max_conns: flags["max-conns"],
					max_msg_retries: flags["max-msg-retries"],
					msg_retry_delay: flags["msg-retry-delay"],
					idle_timeout: flags["idle-timeout"],
					wait_timeout: flags["wait-timeout"],
				},
			},
		);
	} catch (error) {
		throw createSettingsCommandError("Failed to test SMTP settings", error);
	}
}

export async function handleGetSettingsCommand({
	...args
}: HandlerArgs<Record<string, unknown>>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderSettings({ client, output: getOutput() });
	} catch (error) {
		throw createSettingsCommandError(
			"Failed to read installation settings",
			error,
		);
	}
}

export default defineGroup({
	name: "settings",
	description: "Read Listmonk installation settings (redacted)",
	commands: [
		defineCommand({
			name: "get",
			operationId: "settings.get",
			description:
				"Read installation settings with credentials recursively redacted",
			options: {},
			handler: handleGetSettingsCommand,
		}),
		defineCommand({
			name: "test-smtp",
			operationId: "settings.test-smtp",
			description:
				"Send a real test message through a candidate SMTP configuration",
			options: {
				email: option(z.string().trim().min(3), {
					description: "Recipient of the real test message",
				}),
				host: option(z.string().trim().min(1), {
					description: "SMTP hostname",
				}),
				port: option(z.coerce.number().int().positive(), {
					description: "SMTP port",
				}),
				name: option(z.string().optional(), {
					description: "Display name for the pool under test",
				}),
				"hello-hostname": option(z.string().optional(), {
					description: "Hello hostname announced to the server",
				}),
				"auth-protocol": option(
					z.enum(["none", "plain", "cram-md5", "login"]).optional(),
					{ description: "Auth protocol" },
				),
				username: option(z.string().optional(), {
					description: "Username for authenticated protocols",
				}),
				password: option(z.string().optional(), {
					description:
						"Password for authenticated protocols (never persisted)",
				}),
				"tls-type": option(
					z.enum(["none", "STARTTLS", "TLS", "SSL"]).optional(),
					{ description: "TLS strategy" },
				),
				"tls-skip-verify": option(z.coerce.boolean().optional(), {
					description: "Skip TLS certificate verification",
				}),
				"max-conns": option(z.coerce.number().int().positive().optional(), {
					description: "Maximum concurrent connections",
				}),
				"max-msg-retries": option(
					z.coerce.number().int().nonnegative().optional(),
					{ description: "Message delivery retry limit" },
				),
				"msg-retry-delay": option(z.string().optional(), {
					description: 'Delay between retries (Go duration, e.g. "1s")',
				}),
				"idle-timeout": option(z.string().optional(), {
					description: "Idle connection timeout (Go duration)",
				}),
				"wait-timeout": option(z.string().optional(), {
					description: "Pool wait timeout (Go duration)",
				}),
			},
			handler: handleTestSmtpCommand,
		}),
	],
});
