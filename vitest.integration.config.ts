import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.integration.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
