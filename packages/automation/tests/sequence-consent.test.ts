import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	createFileBackedTransactionalIdempotencyStore,
	hashTransactionalPayload,
} from "@listmonk-ops/common";
import { checkSequenceListConsent } from "../src/sequence-consent";
import {
	runSequenceTick,
	type SequenceExecutionContext,
} from "../src/sequence-engine";
import {
	createFileSequenceRepository,
	createSequenceDefinition,
	createSequenceEnrollment,
	sequenceStepSchema,
} from "../src/sequences";
import {
	invokeSequenceCreateOperation,
	invokeSequenceValidateOperation,
	sequenceCreateOperation,
} from "../src/sequence-operations";
const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture(lists: Record<string, unknown>[], optin = "double", scoped = true, status = "enabled") {
	const directory = await mkdtemp(join(tmpdir(), "lmops-consent-"));
	directories.push(directory);
	const repository = createFileSequenceRepository(
		join(directory, "sequences.json"),
	);
	const idempotencyStore = createFileBackedTransactionalIdempotencyStore({
		storePath: join(directory, "tx.json"),
	});
	let sends = 0;
	const state = { lists, optin, status };
	const client = {
		subscriber: {
			getById: async () => ({
				data: { id: 7, status: state.status, lists: state.lists },
			}),
		},
		transactional: {
			send: async () => {
				sends++;
				return { data: true };
			},
		},
		list: {
			getById: async ({ path }: { path: { list_id: number } }) => ({
				data: { id: path.list_id, optin: state.optin },
			}),
		},
	} as unknown as SequenceExecutionContext["client"];
	const now = new Date();
	const definition = await repository.createDefinition(
		createSequenceDefinition(
			{
				name: "consent",
				steps: [
					{
						id: "first",
						type: "send",
						templateId: 1,
						...(scoped ? { consentListIds: [1] } : {}),
					},
					{
						id: "second",
						type: "send",
						templateId: 1,
						...(scoped ? { consentListIds: [1] } : {}),
					},
				],
			},
			now,
		),
	);
	await repository.createEnrollment(
		createSequenceEnrollment(
			definition,
			{ sequenceId: definition.id, subscriberId: 7 },
			now,
		),
	);
	const context = {
		repository,
		idempotencyStore,
		client,
		hashPayload: hashTransactionalPayload,
		target: { baseUrl: "https://consent.test/api", username: "test" },
	};
	return { repository, context, state, sends: () => sends };
}

test("an unrelated confirmed list cannot substitute for the required unsubscribed list", async () => {
 const f = await fixture([{ id: 1, subscription_status: "unsubscribed" }, { id: 2, subscription_status: "confirmed" }]);
 expect((await runSequenceTick(f.context)).cancelled).toBe(1);
	expect(f.sends()).toBe(0);
});
test("missing target membership is rejected even with another subscription", async () => {
	const f = await fixture([{ id: 2, subscription_status: "confirmed" }]);
	expect((await runSequenceTick(f.context)).cancelled).toBe(1);
	expect(f.sends()).toBe(0);
});
test("single opt-in unconfirmed memberships remain eligible", async () => {
 const f = await fixture([{ id: 1, subscription_status: "unconfirmed" }], "single");
 expect((await runSequenceTick(f.context)).advanced).toBe(1);
	expect(f.sends()).toBe(1);
});
test("double opt-in unconfirmed memberships cannot send", async () => {
 const f = await fixture([{ id: 1, subscription_status: "unconfirmed" }], "double");
 expect((await runSequenceTick(f.context)).cancelled).toBe(1);
	expect(f.sends()).toBe(0);
});
test("unsubscribing between steps blocks the next send", async () => {
 const f = await fixture([{ id: 1, subscription_status: "confirmed" }]);
 await runSequenceTick(f.context);
	expect(f.sends()).toBe(1);
 f.state.lists = [{ id: 1, subscription_status: "unsubscribed" }, { id: 2, subscription_status: "confirmed" }];
 expect((await runSequenceTick(f.context)).cancelled).toBe(1);
	expect(f.sends()).toBe(1);
});
test("global suppression takes priority over confirmed list consent", async () => {
 const f = await fixture([{ id: 1, subscription_status: "confirmed" }], "single", true, "blocklisted");
 expect((await runSequenceTick(f.context)).cancelled).toBe(1);
	expect(f.sends()).toBe(0);
});
test("unknown opt-in metadata fails closed without exposing remote content", async () => {
	const f = await fixture([{ id: 1, subscription_status: "unconfirmed" }], "unknown");
	expect((await runSequenceTick(f.context)).failed).toBe(1);
	expect(f.sends()).toBe(0);
});
test("legacy steps without a policy keep their existing transactional behavior", async () => {
	const f = await fixture([], "single", false);
	await runSequenceTick(f.context);
	expect(f.sends()).toBe(1);
});
test("all configured lists are required, not just any list", async () => {
 expect(await checkSequenceListConsent({}, { status: "enabled", lists: [
  { id: 1, subscription_status: "confirmed" }, { id: 2, subscription_status: "unsubscribed" },
 ] }, [1, 2])).toBeDefined();
});
test("unconfirmed memberships cannot rely on an absent list client", async () => {
 await expect(checkSequenceListConsent({}, { status: "enabled", lists: [{ id: 1, subscription_status: "unconfirmed" }] }, [1])).rejects.toThrow("list-read access");
});
test("temporary list lookup outages schedule a retry instead of failing the enrollment", async () => {
	const f = await fixture([{ id: 1, subscription_status: "unconfirmed" }], "single");
	f.context.client.list.getById = async () => {
		const error = new Error("connect ECONNREFUSED");
		throw error;
	};
	const tick = await runSequenceTick(f.context);
	const enrollment = await f.repository.getEnrollment(tick.claimedIds[0]!);
	expect(enrollment.status).toBe("pending");
	expect(enrollment.retryCount).toBe(1);
	expect(tick.failed).toBe(0);
	expect(f.sends()).toBe(0);
});
test("unclassified list transport exceptions also schedule a retry", async () => {
	const f = await fixture([{ id: 1, subscription_status: "unconfirmed" }], "single");
	f.context.client.list.getById = async () => { throw new Error("ECONNRESET while reading list"); };
	const tick = await runSequenceTick(f.context);
	const enrollment = await f.repository.getEnrollment(tick.claimedIds[0]!);
	expect(enrollment.status).toBe("pending");
	expect(enrollment.retryCount).toBe(1);
	expect(f.sends()).toBe(0);
});
for (const status of [429, 503]) {
	test(`retryable list HTTP ${status} responses keep the enrollment pending`, async () => {
		const f = await fixture([{ id: 1, subscription_status: "unconfirmed" }], "single");
		f.context.client.list.getById = async () => ({
			error: { message: "temporary list failure" },
			response: new Response(null, { status }),
		}) as never;
		const tick = await runSequenceTick(f.context);
		const enrollment = await f.repository.getEnrollment(tick.claimedIds[0]!);
		expect(enrollment.status).toBe("pending");
		expect(enrollment.retryCount).toBe(1);
		expect(f.sends()).toBe(0);
	});
}
test("permission failures remain terminal when list consent cannot be verified", async () => {
	const f = await fixture([{ id: 1, subscription_status: "unconfirmed" }], "single");
	f.context.client.list.getById = async () => ({
		error: { message: "forbidden" },
		response: new Response(null, { status: 403 }),
	}) as never;
	const tick = await runSequenceTick(f.context);
	expect(tick.failed).toBe(1);
	expect(f.sends()).toBe(0);
});
test("the published sequence input schema requires unique consent list IDs", () => {
	expect(JSON.stringify(sequenceCreateOperation.inputJsonSchema)).toContain(
		'"uniqueItems":true',
	);
});
test("shared operations preserve consent lists through persisted revisions", async () => {
 const f = await fixture([]);
 const result = await invokeSequenceCreateOperation({ repository: f.repository }, { name: "protected", steps: [
  { id: "send", type: "send", template_id: 1, consent_list_ids: [1, 2] },
 ] });
 const stored = await f.repository.getDefinition(result.sequence.id);
 expect(stored.revisions[0]?.steps[0]).toMatchObject({ consentListIds: [1, 2] });
});
test("invalid consent scopes are rejected by both input and persisted step boundaries", async () => {
 for (const ids of [[], [1, 1], [0], [-1], [Number.MAX_SAFE_INTEGER + 1], Array.from({ length: 101 }, (_, i) => i + 1)]) {
  expect(sequenceStepSchema.safeParse({ id: "s", type: "send", templateId: 1, consentListIds: ids }).success).toBe(false);
  await expect(invokeSequenceValidateOperation({}, { steps: [{ id: "s", type: "send", template_id: 1, consent_list_ids: ids }] })).rejects.toThrow();
 }
});
