import { filename, sanitize, type ImageRecord } from "./shared";

export function normalizeDownloadFolder(value: unknown): string {
  if (typeof value !== "string" || value.length > 200)
    throw Error(
      "Download folder must be a relative path of at most 200 characters",
    );
  const path = value.trim();
  if (!path) return "";
  if (/^[\\/]|^[a-z]:/i.test(path))
    throw Error(
      "Choose a subfolder inside Chrome Downloads, or enable Ask where to save",
    );
  const parts = path.replaceAll("\\", "/").split("/");
  if (
    parts.some(
      (p) =>
        !p ||
        /^[. ]|[. ]$/.test(p) ||
        // Control characters are deliberately rejected in folder names.
        // eslint-disable-next-line no-control-regex
        /[<>:"|?*\u0000-\u001f]/.test(p) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p),
    )
  )
    throw Error("Download folder contains an invalid folder name");
  return parts.join("/");
}
export function validDownloadPreferences(v: any) {
  try {
    normalizeDownloadFolder(v.downloadFolder);
  } catch {
    return false;
  }
  return (
    typeof v.groupDownloads === "boolean" &&
    typeof v.askWhereToSave === "boolean" &&
    typeof v.sequencePrefix === "string" &&
    v.sequencePrefix.length <= 60 &&
    !/^[. ]/.test(v.sequencePrefix) &&
    (!v.sequencePrefix || sanitize(v.sequencePrefix) === v.sequencePrefix)
  );
}
export function outputPath(folder: string, name: string) {
  return folder ? `${folder}/${name}` : name;
}
export function sequentialFilename(
  r: ImageRecord,
  sequence: number,
  fmt?: string,
  prefix = "",
) {
  const ext = filename(r, 0, fmt).split(".").pop();
  return `${prefix ? sanitize(prefix) + "-" : ""}${String(sequence).padStart(6, "0")}.${ext}`;
}
