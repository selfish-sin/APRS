import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  define: { __SINGLE__: "false", __BUILD__: '"test"' },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
