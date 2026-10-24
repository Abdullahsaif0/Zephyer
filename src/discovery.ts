import type { Eligibility, ImageRecord, Settings, Variant } from "./shared";

export const imageFormats = [
  "jpeg",
  "png",
  "webp",
  "avif",
  "gif",
  "svg",
  "bmp",
  "ico",
  "tiff",
] as const;
export type { Eligibility };
export const normalizedFormat = (f: string) =>
  (f.split(";", 1)[0] ?? "")
    .trim()
    .toLowerCase()
    .replace(/^image\//, "")
    .replace("svg+xml", "svg")
    .replace("x-icon", "ico")
    .replace("vnd.microsoft.icon", "ico")
    .replace(/^tif$/, "tiff")
    .replace(/^pjpeg$/, "jpeg")
    .replace(/^x-png$/, "png")
    .replace(/^x-ms-bmp$/, "bmp")
    .replace("jpg", "jpeg");
export function allowedVariants(r: ImageRecord, s: Settings): Variant[] {
  return r.variants.filter((v) =>
    s.allowedFormats.includes(normalizedFormat(v.format)),
  );
}
export function eligibility(r: ImageRecord, s: Settings): Eligibility {
  if (!r.variants.length && r.status.startsWith("unsupported"))
    return { state: "excluded", reasons: [r.status] };
  const eligible = allowedVariants(r, s);
  if (!eligible.length)
    return r.variants.some((v) => v.format === "unknown")
      ? { state: "pending", reasons: ["Format could not yet be verified"] }
      : { state: "excluded", reasons: ["Format disabled in Preferences"] };
  if (r.userIncluded || !s.smartCleanup)
    return { state: "accepted", reasons: [] };
  const reasons: string[] = [];
  if (s.hideBranding && r.signals?.favicon)
    reasons.push("Declared favicon / site icon");
  if (s.hideBranding && r.signals?.emoji)
    reasons.push("Likely interface emoji / emoticon");
  // Use the largest discovered source, never CSS display size, to retain thumbnails with originals.
  const width = Math.max(r.width, ...eligible.map((v) => v.width));
  const height = Math.max(r.height, ...eligible.map((v) => v.height));
  if (width > 0 && height > 0 && (width <= 2 || height <= 2))
    reasons.push("Tracking pixel / spacer");
  else if (
    s.hideSmall &&
    width > 0 &&
    height > 0 &&
    width < s.minImageSize &&
    height < s.minImageSize
  )
    reasons.push("Small decorative asset");
  if (s.hideBranding && r.signals?.interfaceAsset)
    reasons.push("Likely interface icon or branding");
  if (s.hideAvatars && r.signals?.avatar) reasons.push("Likely avatar");
  return { state: reasons.length ? "excluded" : "accepted", reasons };
}
export function decorate(r: ImageRecord, s: Settings): ImageRecord {
  return { ...r, eligibility: eligibility(r, s) };
}
export function discoveryBucket(r: ImageRecord) {
  return r.eligibility?.reasons.includes("Format disabled in Preferences")
    ? "disabled"
    : r.eligibility?.state || "accepted";
}
export function validDiscoverySettings(v: Settings) {
  return (
    Array.isArray(v.allowedFormats) &&
    v.allowedFormats.length > 0 &&
    v.allowedFormats.every((f) => imageFormats.includes(f as any)) &&
    [
      "smartCleanup",
      "hideSmall",
      "hideBranding",
      "hideAvatars",
      "showUpcoming",
    ].every((k) => typeof (v as any)[k] === "boolean") &&
    Number.isInteger(v.minImageSize) &&
    v.minImageSize >= 0 &&
    v.minImageSize <= 4096
  );
}
export function sniffImage(bytes: Uint8Array): string {
  const ascii = new TextDecoder().decode(bytes.slice(0, 512));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (bytes[0] === 137 && ascii.slice(1, 4) === "PNG") return "png";
  if (ascii.startsWith("GIF8")) return "gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "webp";
  if (ascii.slice(4, 8) === "ftyp" && /avif|avis/.test(ascii.slice(8, 40)))
    return "avif";
  if (/<svg[\s>]/i.test(ascii)) return "svg";
  if (ascii.startsWith("BM")) return "bmp";
  if (ascii.startsWith("II*") || ascii.startsWith("MM\x00*")) return "tiff";
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0)
    return "ico";
  return "unknown";
}
