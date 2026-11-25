import { isTelemetryBatch, storeTelemetryBatch } from "./telemetry";

const maxBatchBytes = 64 * 1024;

async function readBatchBody(request: Request): Promise<string | null> {
	if (Number(request.headers.get("Content-Length")) > maxBatchBytes) {
		return null;
	}
	if (!request.body) {
		return "";
	}

	const reader = request.body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
	let body = "";
	let bytes = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) {
				return body + decoder.decode();
			}
			bytes += chunk.value.byteLength;
			if (bytes > maxBatchBytes) {
				await reader.cancel();
				return null;
			}
			body += decoder.decode(chunk.value, { stream: true });
		}
	} finally {
		reader.releaseLock();
	}
}

export default {
	async fetch(request, env) {
		const receivedAtMs = Date.now();
		const { pathname } = new URL(request.url);
		if (pathname === "/" && request.method === "GET") {
			return new Response(`Hello ${env.WORLD}!`);
		}
		if (pathname !== "/telemetry") {
			return new Response("Not found", { status: 404 });
		}
		if (request.method !== "POST") {
			return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
		}

		let payload: unknown;
		try {
			const body = await readBatchBody(request);
			if (body === null) {
				return new Response("Telemetry batch too large", { status: 413 });
			}
			payload = JSON.parse(body);
		} catch {
			return new Response("Invalid JSON", { status: 400 });
		}
		if (!isTelemetryBatch(payload)) {
			return new Response("Invalid telemetry batch", { status: 400 });
		}

		try {
			await storeTelemetryBatch(env.DB, payload, receivedAtMs);
		} catch {
			console.error("Telemetry database write failed");
			return new Response("Telemetry temporarily unavailable", { status: 503 });
		}
		return new Response(null, { status: 204 });
	},
} satisfies ExportedHandler<Env>;
