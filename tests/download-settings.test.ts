import { describe, it, expect } from "vitest";
import { defaults, type ImageRecord } from "../src/shared";
import {
  normalizeDownloadFolder,
  outputPath,
  sequentialFilename,
  validDownloadPreferences,
} from "../src/download-settings";
const r = { displayed: "https://example.com/photo.png" } as ImageRecord;
describe("download destinations and names", () => {
  it("accepts nested relative folders and the Downloads root", () => {
    expect(normalizeDownloadFolder("Pictures\\My collection")).toBe(
      "Pictures/My collection",
    );
    expect(normalizeDownloadFolder("")).toBe("");
    expect(outputPath("", "000001.png")).toBe("000001.png");
  });
  it("rejects absolute paths, traversal, empty segments and reserved Windows names", () => {
    for (const path of [
      "C:\\Pictures",
      "/Pictures",
      "\\\\server\\share",
      "../Photos",
      "Photos/../secret",
      "Photos//Folder",
      "Photos/",
      "CON",
      "photos/aux.png",
      "photos/.hidden",
      "photos/bad?name",
    ])
      expect(() => normalizeDownloadFolder(path), path).toThrow();
  });
  it("retains Unicode folder names without injecting invalid separators", () => { expect(normalizeDownloadFolder("تصاویر/Design work")).toBe(
      "تصاویر/Design work",
    ); });
  it("uses explicit persistent sequence numbers and actual output extensions", () => {
    expect(sequentialFilename(r, 42, "jpeg")).toBe("000042.jpg");
    expect(sequentialFilename(r, 1000001, "webp", "photo")).toBe(
      "photo-1000001.webp",
    );
    expect(sequentialFilename(r, 43, "png", "photo")).toBe("photo-000043.png");
  });
  it("validates folder/prefix settings and backward-compatible defaults", () => {
    expect(validDownloadPreferences(defaults)).toBe(true);
    expect(
      validDownloadPreferences({ ...defaults, sequencePrefix: "../bad" }),
    ).toBe(false);
    expect(validDownloadPreferences({...defaults, sequencePrefix:'.hidden'})).toBe(false);
    expect(
      validDownloadPreferences({ ...defaults, askWhereToSave: "yes" }),
    ).toBe(false);
    expect(
      validDownloadPreferences({ ...defaults, downloadFolder: "D:/Photos" }),
    ).toBe(false);
  });
});
