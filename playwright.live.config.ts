import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/live",
  workers: 1,
  timeout: 180000,
  outputDir: "test-results/live",
});
