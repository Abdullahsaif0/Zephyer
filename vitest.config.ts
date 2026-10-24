import { defineConfig } from "vitest/config";

/**
 * Coverage ratchet (Phase 0): pure logic modules must hold >=85% line
 * coverage and never regress. UI components and the IndexedDB/background
 * layers are exercised by the Playwright browser suites instead; they join
 * this ratchet in Phase 1 (see docs/adr/0002-coverage-ratchet.md).
 */
const ratchet = [
  "src/shared.ts",
  "src/discovery.ts",
  "src/power.ts",
  "src/preferences.ts",
  "src/download-settings.ts",
  "src/retrieval.ts",
];

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      thresholds: Object.fromEntries(
        ratchet.map((file) => [file, { lines: 85, functions: 70 }]),
      ),
    },
  },
});
