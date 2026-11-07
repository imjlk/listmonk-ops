import { expect, test } from "bun:test";
import {
	propagateTemporaryListOptOuts,
	readTemporaryListOptOuts,
} from "@listmonk-ops/abtest";
import { buildTestName, createTestClient, TEST_CONFIG } from "../setup.js";

test("A/B chunk confirmation SQL selects only requested recipients against Listmonk6.2 without delivery", async () => {
	if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(TEST_CONFIG.baseUrl).hostname)) throw new Error("Local test stack required");
	const api = createTestClient();
	const prefix = buildTestName("abtest-confirmation");
	const lists: number[] = [];
	const subscribers: number[] = [];
	try {
		for (const suffix of ["source", "temporary"]) {
			const response = await api.list.create({ body: { name: `${prefix}-${suffix}`, type: "private", optin: "single" } });
			if (response.error || !response.data.id) throw new Error("List fixture failed");
			lists.push(response.data.id);
		}
		for (let i = 0; i < 3; i += 1) {
			const response = await api.subscriber.create({ body: { email: `${prefix}-${i}@example.test`, status: "enabled", lists, preconfirm_subscriptions: true } });
			if (response.error || !response.data.id) throw new Error("Subscriber fixture failed");
			subscribers.push(response.data.id);
		}
		const unsubscribed = await api.subscriber.manageLists({ body: { ids: subscribers, target_list_ids: [lists[1]!], action: "unsubscribe" } });
		if (unsubscribed.error) throw new Error("Opt-out fixture failed");
		const selected = [subscribers[0]!, subscribers[2]!];
		const subset = await readTemporaryListOptOuts(api, lists[1]!, { subscriberIds: selected, pageSize: 1 });
		expect(subset.map((row) => row.subscriberId).sort((a, b) => a - b)).toEqual(
			selected.sort((a, b) => a - b),
		);
		for (const row of subset) expect(row.membershipStatuses.get(lists[0]!)).toBe("confirmed");
		const result = await propagateTemporaryListOptOuts(api, { listId: lists[1]!, sourceListIds: [lists[0]!], chunkSize: 1 });
		expect(result).toMatchObject({
			safeToDelete: true,
			propagatedCount: 3,
			pendingCount: 0,
		});
		expect(result.settledSubscriberIds).toHaveLength(3);
		const after = await readTemporaryListOptOuts(api, lists[1]!, { subscriberIds: subscribers });
		for (const row of after) expect(row.membershipStatuses.get(lists[0]!)).toBe("unsubscribed");
	} finally {
		for (const id of subscribers) await api.subscriber.delete({ path: { id } });
		for (const id of lists) await api.list.delete({ path: { list_id: id } });
	}
});
