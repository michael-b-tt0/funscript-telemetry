import { Validator, type Schema } from "@cfworker/json-schema";
import schema from "../telemetry.schema.json";

type TelemetryEvent = { eventId: string; occurredAt: string } & (
	| { type: "startup_attempt" | "startup_success" }
	| { type: "tool_run"; toolId: string }
	| { type: "script_download"; fileName: string }
	| {
			type: "error";
			phase: "startup" | "runtime";
			errorType: string;
			code?: string;
			message?: string;
	  }
);

interface TelemetryBatch {
	schemaVersion: number;
	pageLoadId: string;
	appVersion?: string;
	sentAt: string;
	environment: {
		browser: { family: string; majorVersion?: number };
		os: { family: string; majorVersion?: number };
		deviceType: string;
		browserLanguage?: string;
		appLanguage?: string;
	};
	display: object;
	events: TelemetryEvent[];
}

const validator = new Validator(schema as Schema, "2020-12");

function isCanonicalTimestamp(value: string): boolean {
	const time = Date.parse(value);
	return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function isTelemetryBatch(value: unknown): value is TelemetryBatch {
	if (!validator.validate(value).valid) {
		return false;
	}

	const batch = value as TelemetryBatch;
	return (
		isCanonicalTimestamp(batch.sentAt) &&
		batch.events.every((event) => isCanonicalTimestamp(event.occurredAt))
	);
}

export async function storeTelemetryBatch(
	db: D1Database,
	batch: TelemetryBatch,
	receivedAtMs: number,
) {
	const batchId = crypto.randomUUID();
	const { browser, os, deviceType, browserLanguage, appLanguage } = batch.environment;
	const insertBatch = db
		.prepare(`INSERT INTO telemetry_batches (
			batch_id, page_load_id, schema_version, app_version, sent_at_ms, received_at_ms,
			browser_family, browser_major_version, os_family, os_major_version, device_type,
			browser_language, app_language, display_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		.bind(
			batchId,
			batch.pageLoadId,
			batch.schemaVersion,
			batch.appVersion ?? null,
			Date.parse(batch.sentAt),
			receivedAtMs,
			browser.family,
			browser.majorVersion ?? null,
			os.family,
			os.majorVersion ?? null,
			deviceType,
			browserLanguage ?? null,
			appLanguage ?? null,
			JSON.stringify(batch.display),
		);
	const insertEvent = db.prepare(`INSERT INTO telemetry_events (
		event_id, batch_id, event_index, occurred_at_ms, type, tool_id, file_name,
		phase, error_type, error_code, error_message
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (event_id) DO NOTHING`);
	const eventInserts = batch.events.map((event, index) => {
		const error = event.type === "error" ? event : undefined;
		return insertEvent.bind(
			event.eventId,
			batchId,
			index,
			Date.parse(event.occurredAt),
			event.type,
			event.type === "tool_run" ? event.toolId : null,
			event.type === "script_download" ? event.fileName : null,
			error?.phase ?? null,
			error?.errorType ?? null,
			error?.code ?? null,
			error?.message ?? null,
		);
	});
	const discardEmptyBatch = db
		.prepare(`DELETE FROM telemetry_batches WHERE batch_id = ?1
			AND NOT EXISTS (SELECT 1 FROM telemetry_events WHERE batch_id = ?1)`)
		.bind(batchId);

	await db.batch([insertBatch, ...eventInserts, discardEmptyBatch]);
}
