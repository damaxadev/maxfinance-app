import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.toml" },
			// Test-only secret value — INTERNAL_KEY isn't set via wrangler.toml
			// (real secrets come from `wrangler secret put` / `.dev.vars`).
			miniflare: {
				bindings: {
					INTERNAL_KEY: "test-internal-key",
				},
			},
		}),
	],
});
