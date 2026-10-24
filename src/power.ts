import type { PagePowerState, Settings } from "./shared";

export function pagePower(
  settings: Settings,
  url: string,
  revision = 0,
  activated = true,
  manual = false,
): PagePowerState {
  let hostname = "";
  try {
    const parsed = new URL(url);
    if (/^https?:$/.test(parsed.protocol)) hostname = parsed.hostname;
  } catch {}
  const globalEnabled = settings.enabled;
  const siteEnabled = !!hostname && !settings.disabledSites.includes(hostname);
  return {
    activated,
    collecting:
      !!hostname &&
      globalEnabled &&
      siteEnabled &&
      activated &&
      (settings.automaticCollection || manual),
    hostname,
    globalEnabled,
    siteEnabled,
    effectiveEnabled: !!hostname && globalEnabled && siteEnabled && activated,
    epoch: "",
    reason: !hostname
      ? "restricted"
      : !globalEnabled
        ? "global-off"
        : !siteEnabled
          ? "site-off"
          : !activated
            ? "inactive"
            : "on",
    revision,
  };
}

// Apply only the user's edits, preserving rules changed elsewhere since editing began.
export function mergeSiteRules(
  current: string[],
  baseline: string[],
  edited: string[],
) {
  const before = new Set(baseline),
    after = new Set(edited);
  return [
    ...new Set([
      ...current.filter((host) => !before.has(host) || after.has(host)),
      ...edited.filter((host) => !before.has(host)),
    ]),
  ];
}
