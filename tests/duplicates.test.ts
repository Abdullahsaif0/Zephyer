import { describe, expect, it } from "vitest";
import { groupDuplicates, phashDistance } from "../src/duplicates";
import type { Fingerprint } from "../src/shared";

const fp = (recordId: string, sha256: string, phash: string): Fingerprint => ({
  recordId,
  sha256,
  phash,
  updated: 1,
});

describe("phashDistance", () => {
  it("is 0 for identical hashes and 64 for inverted ones", () => {
    expect(phashDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(phashDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(phashDistance("f000000000000000", "0000000000000000")).toBe(4);
  });
});

describe("groupDuplicates", () => {
  const records = [
    { id: "a", name: "A", displayed: "https://x/a.png" },
    { id: "b", name: "B", displayed: "https://x/b.png" },
    { id: "c", name: "C", displayed: "https://x/c.png" },
    { id: "d", name: "D", displayed: "https://x/d.png" },
    { id: "e", name: "E", displayed: "https://x/e.png" },
    { id: "f", name: "F", displayed: "https://x/f.png" },
  ] as any;

  it("groups exact SHA-256 duplicates together", () => {
    const groups = groupDuplicates(
      [
        fp("a", "aa", "0000000000000000"),
        fp("b", "aa", "ffffffffffffffff"),
        fp("c", "bb", "1111111111111111"),
      ],
      records,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("exact");
    expect(groups[0]?.members.map((m) => m.recordId).sort()).toEqual(["a", "b"]);
  });

  it("clusters perceptual near-duplicates transitively", () => {
    // a~b and b~c but a not within threshold of c: still one group.
    const groups = groupDuplicates(
      [
        fp("a", "aa", "0000000000000000"),
        fp("b", "bb", "0000000000000003"), // 2 bits from a
        fp("c", "cc", "0000000000000006"), // 2 bits from b
      ],
      records,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe("similar");
    expect(groups[0]?.members.map((m) => m.recordId).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps dissimilar images ungrouped", () => {
    const groups = groupDuplicates(
      [
        fp("a", "aa", "0000000000000000"),
        fp("b", "bb", "ffffffffffffffff"),
        fp("c", "cc", "1234567890abcdef"),
      ],
      records,
    );
    expect(groups).toHaveLength(0);
  });

  it("sorts exact before similar and smaller groups first", () => {
    const groups = groupDuplicates(
      [
        fp("a", "same", "0000000000000000"),
        fp("b", "same", "ffffffffffffffff"),
        fp("c", "c", "0000000000000000"),
        fp("d", "d", "0000000000000003"),
        fp("e", "e", "0000000000000006"),
      ],
      records,
    );
    expect(groups.map((g) => g.kind)).toEqual(["exact", "similar"]);
  });

  it("ignores records without usable fingerprints", () => {
    const groups = groupDuplicates(
      [fp("a", "", ""), { recordId: "x", updated: 1 }],
      records,
    );
    expect(groups).toHaveLength(0);
  });
});
