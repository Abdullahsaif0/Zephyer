import { useEffect } from "react";
import { applyTheme, tokensCSS, validTheme } from "./appearance";
import { iconSVG, type IconName } from "./icons";
export function useAppearance() {
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = tokensCSS;
    document.head.append(style);
    const apply = (settings: any) => { applyTheme(
        document.documentElement,
        validTheme(settings?.theme) ? settings.theme : "graphite",
      ); };
    void chrome.storage.local.get("settings").then((r) => {
      apply(r["settings"]);
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes["settings"]) apply(changes["settings"].newValue);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
      style.remove();
    };
  }, []);
}
export function Icon({ name }: { name: IconName }) {
  return (
    <span
      className="z-icon"
      dangerouslySetInnerHTML={{ __html: iconSVG(name) }}
    />
  );
}
