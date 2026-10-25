import type { Fingerprint, ImageRecord } from "./shared";

/** A group of records judged to be duplicates. */
export type DuplicateGroup = {
  kind: "exact" | "similar";
  members: {
    recordId: string;
    name: string;
    displayed: string;
  }[];
};
export type DuplicateGroups = DuplicateGroup[];

/** Hamming distance between two 16-char hex phashes (64 bits). */
export function phashDistance(a: string, b: string): number {
  let distance = 0;
  for (let i = 0; i < 16; i++) {
    const x = parseInt(a[i] ?? "0", 16);
    const y = parseInt(b[i] ?? "0", 16);
    distance += (x ^ y).toString(2).replace(/0/g, "").length;
  }
  return distance;
}

const SIMILAR_THRESHOLD = 12;

/**
 * Group fingerprints into duplicates. SHA-256 collisions form exact groups;
 * the remaining records are clustered by dHash proximity (transitive, so a
 * chain of visually similar images lands in one group). Records without a
 * usable fingerprint are ignored. Never merges or deletes anything — the
 * caller decides what to do with a group.
 */
export function groupDuplicates(
  prints: Fingerprint[],
  records: ImageRecord[],
): DuplicateGroups {
  const byId = new Map(records.map((r) => [r.id, r]));
  const usable = prints.filter((p) => p.sha256 && p.phash);
  const groups: DuplicateGroups = [];

  // Exact duplicates by SHA-256.
  const exact = new Map<string, Fingerprint[]>();
  for (const p of usable) {
    const sha = p.sha256;
    if (!sha) continue;
    const list = exact.get(sha) || [];
    list.push(p);
    exact.set(sha, list);
  }
  for (const list of exact.values()) {
    if (list.length < 2) continue;
    groups.push({
      kind: "exact",
      members: list.map((p) => member(byId.get(p.recordId))),
    });
  }

  // Perceptual duplicates by dHash proximity (transitive clustering).
  const rest = usable.filter((p) => {
    const sha = p.sha256;
    const list = sha ? exact.get(sha) : undefined;
    return !list || list.length < 2;
  });
  const clusters: Fingerprint[][] = [];
  for (const p of rest) {
    const hash = p.phash;
    if (!hash) continue;
    let placed = false;
    for (const cluster of clusters) {
      if (
        cluster.some((c) => {
          const cHash = c.phash;
          return cHash ? phashDistance(cHash, hash) <= SIMILAR_THRESHOLD : false;
        })
      ) {
        cluster.push(p);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([p]);
  }
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    groups.push({
      kind: "similar",
      members: cluster.map((p) => member(byId.get(p.recordId))),
    });
  }
  // Deterministic order: exact first, then similar by smallest group.
  return groups.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "exact" ? -1 : 1;
    return a.members.length - b.members.length;
  });
}
function member(r: ImageRecord | undefined) {
  return {
    recordId: r?.id || "",
    name: r?.name || "Unknown image",
    displayed: r?.displayed || "",
  };
}
