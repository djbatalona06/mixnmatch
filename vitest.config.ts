import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "cloudflare:workers": new URL("./test/cf-workers-shim.ts", import.meta.url).pathname },
  },
});
