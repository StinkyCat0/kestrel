import { defineConfig } from "cf/config"

export default defineConfig({
	worker: {
		name: "cloudagents-web",
		compatibilityDate: "2026-01-01",
		assets: {
			notFoundHandling: "single-page-application",
		},
	},
})
