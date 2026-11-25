import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			config: true,
			miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") } },
		})),
	],
});
