import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "funscript-telemetry",
		compatibilityDate: "2026-11-23",
		entrypoint,
		env: {
			WORLD: bindings.text("World"),
			DB: bindings.d1({
				name: "funscript-telemetry-db",
			}),
		},
	},
});
