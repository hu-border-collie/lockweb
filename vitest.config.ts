import { defineConfig } from "vitest/config";
process.env.TZ = "Asia/Shanghai";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    setupFiles: ["tests/setup.ts"],
  },
});
