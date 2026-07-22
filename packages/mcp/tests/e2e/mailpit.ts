export type MailpitAddress = {
	Address: string;
};

export type MailpitMessageSummary = {
	ID: string;
	Subject: string;
	To: MailpitAddress[] | null;
};

type MailpitMessageList = {
	messages?: MailpitMessageSummary[];
};

export type MailpitMessage = MailpitMessageSummary & {
	From: MailpitAddress;
	HTML: string;
};

function resolveMailpitApiRoot(): string {
	return (
		process.env.MAILPIT_API_URL?.trim() ||
		"http://127.0.0.1:8025/api/v1"
	).replace(/\/$/, "");
}

export async function fetchMailpitJson<T>(path: string): Promise<T> {
	const mailpitApiRoot = resolveMailpitApiRoot();
	const response = await fetch(`${mailpitApiRoot}${path}`);
	if (!response.ok) {
		throw new Error(
			`Mailpit request ${path} failed: ${response.status} ${response.statusText}`,
		);
	}
	return (await response.json()) as T;
}

export async function findMailpitMessage(
	recipient: string,
	subject: string,
): Promise<MailpitMessageSummary | undefined> {
	const query = encodeURIComponent(`to:"${recipient}" subject:"${subject}"`);
	const mailbox = await fetchMailpitJson<MailpitMessageList>(
		`/search?query=${query}`,
	);
	return mailbox.messages?.find(
		(message) =>
			message.Subject === subject &&
			message.To?.some((address) => address.Address === recipient),
	);
}
