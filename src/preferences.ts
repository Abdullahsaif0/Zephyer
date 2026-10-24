import { sanitize, type Settings } from "./shared";
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
  return "";
}
