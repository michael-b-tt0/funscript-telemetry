import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vite-plus/test";
import startupSuccessRate from "../queries/startup-success-rate.sql?raw";
import schema from "../telemetry.schema.json";

declare global {
	namespace Cloudflare {
		interface Env {
			TEST_MIGRATIONS: D1Migration[];
		}
	}
}

const telemetryUrl = "https://example.com/telemetry";

function postBatch(batch: unknown) {
	return exports.default.fetch(telemetryUrl, { method: "POST", body: JSON.stringify(batch) });
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
	await env.DB.prepare("DELETE FROM telemetry_batches").run();
});

it("responds using the configured Worker binding", async () => {
	const response = await exports.default.fetch("https://example.com/");
	expect(response.status).toBe(200);
	expect(await response.text()).toBe("Hello World!");
});

it("stores telemetry snapshots and preserves filenames and diagnostic text", async () => {
	const fileName = "Clíp's `demo` 📁.funscript";
	const message = "Unexpected value 'café' ⚠️";
	const downloadExample = schema.examples[1];
	const downloadBatch = {
		...downloadExample,
		events: [downloadExample.events[0], { ...downloadExample.events[1], fileName }],
	};
	const errorExample = schema.examples[2];
	const errorBatch = { ...errorExample, events: [{ ...errorExample.events[0], message }] };
	const before = Date.now();
	for (const batch of [schema.examples[0], downloadBatch, errorBatch]) {
		const response = await postBatch(batch);
		expect(response.status).toBe(204);
	}

	const saved = await env.DB.prepare(`SELECT app_version, browser_family, os_major_version,
		sent_at_ms, received_at_ms, display_json FROM telemetry_batches WHERE page_load_id = ?`)
		.bind(downloadBatch.pageLoadId)
		.first<{ display_json: string; received_at_ms: number }>();
	expect(saved).toMatchObject({
		app_version: "2.4",
		browser_family: "firefox",
		os_major_version: 11,
		sent_at_ms: Date.parse(downloadBatch.sentAt),
		display_json: JSON.stringify(downloadBatch.display),
	});
	expect(saved?.received_at_ms).toBeGreaterThanOrEqual(before);
	expect(saved?.received_at_ms).toBeLessThanOrEqual(Date.now());
	const { results } = await env.DB.prepare(`SELECT type, event_index, tool_id, file_name,
		error_code, error_message FROM telemetry_events ORDER BY occurred_at_ms`).all();
	expect(results).toEqual([
		{
			type: "startup_success",
			event_index: 0,
			tool_id: null,
			file_name: null,
			error_code: null,
			error_message: null,
		},
		{
			type: "tool_run",
			event_index: 0,
			tool_id: "offset",
			file_name: null,
			error_code: null,
			error_message: null,
		},
		{
			type: "script_download",
			event_index: 1,
			tool_id: null,
			file_name: fileName,
			error_code: null,
			error_message: null,
		},
		{
			type: "error",
			event_index: 0,
			tool_id: null,
			file_name: null,
			error_code: "BLAZOR_SCRIPT_LOAD_FAILED",
			error_message: message,
		},
	]);
});

it("deduplicates concurrent retries and retains new events from a mixed batch", async () => {
	const batch = schema.examples[1];
	const firstBatch = { ...batch, events: [batch.events[0]] };
	const requests = await Promise.all([postBatch(firstBatch), postBatch(firstBatch)]);
	expect(requests.map((response) => response.status)).toEqual([204, 204]);
	const nextBatch = { ...batch, display: { ...batch.display, theme: "light" } };
	expect((await postBatch(nextBatch)).status).toBe(204);

	const { results } =
		await env.DB.prepare(`SELECT type, event_index, json_extract(display_json, '$.theme') AS theme
	FROM telemetry_events JOIN telemetry_batches USING (batch_id) ORDER BY event_index`).all();
	expect(results).toEqual([
		{ type: "tool_run", event_index: 0, theme: "dark" },
		{ type: "script_download", event_index: 1, theme: "light" },
	]);
	expect(
		await env.DB.prepare("SELECT COUNT(*) FROM telemetry_batches").first<number>("COUNT(*)"),
	).toBe(2);
});

it("rejects malformed batches and oversized streams without writing events", async () => {
	const invalid = await exports.default.fetch(telemetryUrl, { method: "POST", body: "{" });
	const batch = schema.examples[1];
	const impossibleDate = await postBatch({
		...batch,
		events: [batch.events[0], { ...batch.events[1], occurredAt: "2026-02-30T00:00:00.000Z" }],
	});
	const oversized = await exports.default.fetch(telemetryUrl, {
		method: "POST",
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(64 * 1024 + 1));
				controller.close();
			},
		}),
	});
	expect([invalid.status, impossibleDate.status, oversized.status]).toEqual([400, 400, 413]);
	expect(
		await env.DB.prepare("SELECT COUNT(*) FROM telemetry_events").first<number>("COUNT(*)"),
	).toBe(0);
	expect(
		await env.DB.prepare("SELECT COUNT(*) FROM telemetry_batches").first<number>("COUNT(*)"),
	).toBe(0);
});

it("calculates startup success by the first attempt's time and context", async () => {
	const firstPage = schema.examples[0];
	const secondPage = schema.examples[1];
	const thirdPage = schema.examples[2];
	const start = "2026-11-25T14:00:00.000Z";
	const end = "2026-11-25T15:00:00.000Z";
	const attempt = (occurredAt: string) => ({
		type: "startup_attempt",
		eventId: crypto.randomUUID(),
		occurredAt,
	});
	const query = (version: string | null, browser: string | null, from = start, to = end) =>
		env.DB.prepare(startupSuccessRate)
			.bind(Date.parse(from), Date.parse(to), version, browser)
			.first();
	const success = { ...firstPage.events[0], occurredAt: end };
	const payloads = [
		{
			...secondPage,
			pageLoadId: firstPage.pageLoadId,
			appVersion: "2.5",
			sentAt: end,
			events: [success],
		},
		{ ...firstPage, events: [attempt(start)] },
		{ ...secondPage, pageLoadId: firstPage.pageLoadId, events: [attempt(secondPage.sentAt)] },
		{ ...secondPage, events: [attempt(secondPage.sentAt)] },
		{ ...thirdPage, events: [{ ...success, eventId: crypto.randomUUID() }] },
		{ ...thirdPage, events: [attempt(end)] },
	];
	for (const batch of payloads) {
		expect((await postBatch(batch)).status).toBe(204);
	}
	expect(await query(null, null)).toEqual({
		attempted_page_loads: 2,
		successful_page_loads: 1,
		startup_success_rate: 0.5,
	});
	expect(await query("2.4", "safari")).toEqual({
		attempted_page_loads: 1,
		successful_page_loads: 1,
		startup_success_rate: 1,
	});
	expect(await query(null, "firefox")).toEqual({
		attempted_page_loads: 1,
		successful_page_loads: 0,
		startup_success_rate: 0,
	});
	expect(await query("2.5", null)).toEqual({
		attempted_page_loads: 0,
		successful_page_loads: 0,
		startup_success_rate: null,
	});
	expect(await query(null, null, secondPage.sentAt)).toEqual({
		attempted_page_loads: 1,
		successful_page_loads: 0,
		startup_success_rate: 0,
	});
});
