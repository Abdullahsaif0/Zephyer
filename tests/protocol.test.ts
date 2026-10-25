import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Message } from "../src/shared";

/**
 * Canonical list of every message type in the protocol. The type assertions
 * below make this list exhaustive in BOTH directions at compile time: a newly
 * added Message member fails the build until it is registered here, and a
 * typo'd/removed member fails the satisfies check.
 */
const messageTypes = [
  "ENABLE_PHOTO_FORMATS",
  "PING",
  "ACTIVATION_STATUS",
  "ACTIVATION_RETRY",
  "CAPABILITIES",
  "VERIFY_RETRY",
  "OPEN_GALLERY",
  "AUTO_COLLECTION",
  "SCAN_NOW",
  "COLLECTION_META",
  "COLLECTION_BATCH",
  "COLLECTION_SELECT",
  "COLLECTION_INCLUDE",
  "COLLECTION_PIN",
  "COLLECTION_DOWNLOAD",
  "COLLECTION_PREVIEW",
  "PREVIEW_RELEASE",
  "PREVIEW_CANCEL",
  "PREFERENCES",
  "SITE_POWER",
  "INCLUDE",
  "HELLO",
  "APPEARANCE",
  "DOCK_GET",
  "DOCK_SAVE",
  "DOCK_RESET",
  "OPEN_OPTIONS",
  "DISCOVER",
  "SNAPSHOT",
  "LIBRARY_META",
  "RECORDS_BATCH",
  "SELECT",
  "MODE",
  "SCAN",
  "SCAN_PROGRESS",
  "DOWNLOAD",
  "JOB",
  "OPEN",
  "SETTINGS",
  "PAGE_BYTES",
  "NOTICE",
  "RESET",
  "UI_STATE",
] as const;

// Every Message member is registered, and nothing extra is registered.
type Unregistered = Exclude<Message["type"], (typeof messageTypes)[number]>;
const _exhaustive: Unregistered extends never ? true : never = true;
const _precise: readonly Message["type"][] = messageTypes;
expect(_exhaustive).toBe(true);
expect(_precise.length).toBe(messageTypes.length);

// The protocol registry must cover every member and nothing more.
import type { protocolRegistry } from "../src/shared";
type RegistryKeys = keyof typeof protocolRegistry;
type MissingRegistry = Exclude<Message["type"], RegistryKeys>;
type ExtraRegistry = Exclude<RegistryKeys, Message["type"]>;
const _registryExhaustive: MissingRegistry extends never ? true : never = true;
const _registryPrecise: ExtraRegistry extends never ? true : never = true;
expect(_registryExhaustive).toBe(true);
expect(_registryPrecise).toBe(true);

/**
 * Messages the background does not route to a `case` of its own: broadcast
 * pushes it originates, probes it sends into content scripts, and OPEN which
 * is intercepted before the router to preserve the click's user activation
 * (background.ts early-return block).
 */
const broadcastOnly = new Set([
  "NOTICE",
  "RESET",
  "UI_STATE",
  "PING",
  "PAGE_BYTES",
  "OPEN",
]);

const source = (file: string) =>
  readFileSync(resolve(import.meta.dirname, "..", file), "utf8");

describe("message protocol", () => {
  it("registers every union member as a background case unless broadcast-only", () => {
    const background = source("src/background.ts");
    const cases = new Set(
      [...background.matchAll(/case "([A-Z_]+)":/g)].map((m) => m[1]),
    );
    for (const type of messageTypes) {
      if (broadcastOnly.has(type)) continue;
      expect(cases, `${type} has no background handler`).toContain(type);
    }
  });

  it("has no dead router cases for protocol messages", () => {
    // The 1.7 audit found `case "OPEN"` was unreachable dead code. Any case
    // the router declares must be a real protocol member (or a private
    // offscreen directive, which lives in the allowlist below).
    const offscreenDirectives = new Set([
      "IMAGE",
      "PROBE",
      "DIGEST",
      "PHASH",
      "REVOKE",
      "CANCEL",
      "CLEANUP",
      "ZIP_BEGIN",
      "ZIP_ADD",
      "ZIP_END",
      "ZIP_ABORT",
      "OFFSCREEN_IDLE",
    ]);
    const background = source("src/background.ts");
    const cases = [...background.matchAll(/case "([A-Z_]+)":/g)].map(
      (m) => m[1] ?? "",
    );
    const known = new Set([...messageTypes, ...offscreenDirectives]);
    for (const c of cases)
      expect(
        known.has(c),
        `background case "${c}" is not part of the protocol`,
      ).toBe(true);
  });
});
