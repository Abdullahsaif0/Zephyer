import { sanitize, type Settings, type SiteProfile } from "./shared";
import { normalizeDownloadFolder } from "./download-settings";

export function validHostname(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 253) return false;
  try {
    const url = new URL(`https://${value}`);
    return (
      url.hostname === value &&
      url.host === value &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** A defensive sanitizer for persisted site profiles: invalid entries are
 *  dropped, unknown fields ignored, values normalized. Never throws. */
export function sanitizeSiteProfiles(
  value: unknown,
): Record<string, SiteProfile> {
  const out: Record<string, SiteProfile> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [hostname, raw] of Object.entries(value)) {
    if (!validHostname(hostname) || !raw || typeof raw !== "object") continue;
    const profile = raw as Record<string, unknown>;
    const clean: SiteProfile = {};
    if (
      Array.isArray(profile["allowedFormats"]) &&
      profile["allowedFormats"].every((f) => typeof f === "string") &&
      profile["allowedFormats"].length > 0
    )
      clean.allowedFormats = [...profile["allowedFormats"]];
    for (const key of [
      "smartCleanup",
      "hideSmall",
      "hideBranding",
      "hideAvatars",
    ] as const)
      if (typeof profile[key] === "boolean") clean[key] = profile[key];
    if (
      typeof profile["minImageSize"] === "number" &&
      Number.isFinite(profile["minImageSize"]) &&
      profile["minImageSize"] >= 0
    )
      clean.minImageSize = profile["minImageSize"];
    if (typeof profile["downloadFolder"] === "string") {
      try {
        clean.downloadFolder = normalizeDownloadFolder(profile["downloadFolder"]);
      } catch {}
    }
    if (
      typeof profile["scanImages"] === "number" &&
      Number.isFinite(profile["scanImages"]) &&
      profile["scanImages"] >= 0
    )
      clean.scanImages = profile["scanImages"];
    if (Object.keys(clean).length) out[hostname] = clean;
  }
  return out;
}

export function preferenceError(
  key: keyof Settings,
  settings: Settings,
): string {
  const value = settings[key];
  if (key === "downloadFolder") {
    try {
      normalizeDownloadFolder(value);
    } catch (e) {
      return (e as Error).message;
    }
  }
  if (
    key === "sequencePrefix" &&
    (typeof value !== "string" ||
      value.length > 60 ||
      /^[. ]/.test(value) ||
      (value && sanitize(value) !== value))
  )
    return "Use up to 60 filename-safe characters, with no leading space or dot.";
  if (
    key === "disabledSites" &&
    settings.disabledSites.some((host) => !validHostname(host))
  )
    return "Enter exact hostnames, for example www.example.com, without a URL, port or path.";
  if (
    ["minImageSize", "concurrency", "scanImages", "scanMinutes"].includes(key)
  ) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      return "Enter a finite, non-negative number.";
    if (key !== "scanMinutes" && !Number.isInteger(value))
      return "Enter a whole number.";
    if (key === "concurrency" && (value < 1 || value > 8))
      return "Choose 1 to 8 concurrent tasks.";
    if (key === "minImageSize" && value > 4096)
      return "Choose a threshold from 0 to 4096 pixels.";
  }
  if (
    key === "namingPreset" &&
    (typeof value !== "string" || value.length > 120 || /^[. ]/.test(value))
  )
    return "Use up to 120 characters, with no leading space or dot.";
  if (
    key === "siteProfiles" &&
    (!value || typeof value !== "object" || Array.isArray(value))
  )
    return "Site profiles must be a hostname-to-profile map.";
  if (key === "siteProfiles") {
    for (const [hostname, profile] of Object.entries(value)) {
      if (!validHostname(hostname)) return `Invalid hostname: ${hostname}`;
      for (const [field, fieldValue] of Object.entries(profile)) {
        if (
          field === "minImageSize" &&
          (typeof fieldValue !== "number" ||
            !Number.isFinite(fieldValue) ||
            fieldValue < 0)
        )
          return `minImageSize must be a non-negative number (${hostname})`;
        if (field === "downloadFolder") {
          try {
            normalizeDownloadFolder(fieldValue);
          } catch {
            return `Invalid download folder for ${hostname}`;
          }
        }
      }
    }
  }
  return "";
}
