import {
  archiveFits,
  resized,
  DownloadFailure,
  type Output,
} from "./shared";
import { zip, type Zippable } from "fflate";
import { normalizedFormat, sniffImage } from "./discovery";
import { fetchImageBytes } from "./retrieval";
let activeOperations = 0;
let processingGeneration = 0;
const cancelledPreviews = new Set<string>();
const previewControllers = new Map<string, AbortController>();
const blobs = new Map<string, number>(),
  archives = new Map<string, { files: Zippable; bytes: number }>();
function objectUrl(b: Blob) {
  const url = URL.createObjectURL(b);
  blobs.set(url, Date.now());
  return url;
}
function revoke(url: string) {
  if (blobs.has(url)) {
    URL.revokeObjectURL(url);
    blobs.delete(url);
  }
}
async function bytes(url: string, signal?: AbortSignal) {
  return fetchImageBytes(url, 250 * 1024 * 1024, signal);
}
async function decode(blob: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}> {
  try {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => { bitmap.close(); },
    };
  } catch (error) {
    if (!blob.type.startsWith("image/svg+xml")) throw error;
    // Chromium's ImageBitmap decoder rejects some SVGs which its image decoder supports.
    const url = URL.createObjectURL(blob),
      image = new Image();
    image.src = url;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        image.decode(),
        new Promise((_, reject) => {
          timer = setTimeout(() => { reject(Error("SVG decode timeout")); }, 10000);
        }),
      ]);
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => {
          URL.revokeObjectURL(url);
          image.src = "";
        },
      };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
async function image(
  url: string,
  o: Output,
  allowedFormats?: string[],
  signal?: AbortSignal,
) {
  const b = await bytes(url, signal);
  const detected = sniffImage(
    new Uint8Array(await b.slice(0, 512).arrayBuffer()),
  );
  const inputFormat =
    detected !== "unknown"
      ? detected
      : normalizedFormat(b.type.split(";")[0] ?? "");
  if (allowedFormats && !allowedFormats.includes(inputFormat))
    throw Error(
      "No eligible format: actual image format is disabled in this job",
    );
  if (
    b.type &&
    !b.type.startsWith("image/") &&
    !["application/octet-stream", "binary/octet-stream"].includes(b.type)
  )
    throw new DownloadFailure("permanent", `Not an image: ${b.type}`);
  const format =
    detected !== "unknown"
      ? detected
      : normalizedFormat(b.type.split(";")[0] ?? "");
  let width = 0,
    height = 0;
  if (o.format === "original") {
    try {
      const bitmap = await decode(b);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    } catch {
      if (!b.type.startsWith("image/"))
        throw new DownloadFailure("permanent", "Response is not a decodable image");
    }
    return { blobUrl: objectUrl(b), bytes: b.size, format, width, height };
  }
  // Any animation-capable format needs explicit first-frame consent; inspect signatures, not URL suffixes.
  const head = new Uint8Array(
    await b.slice(0, Math.min(b.size, 256 * 1024)).arrayBuffer(),
  );
  const text = new TextDecoder("latin1").decode(head);
  const animated =
    format === "gif" ||
    text.includes('acTL') ||
    /ANIM|ANMF/.test(text) ||
    format === "avif" ||
    format === "svg+xml" ||
    format === "svg";
  if (animated && !o.firstFrame)
    throw new DownloadFailure(
      "permanent",
      "Animation/vector conversion requires “Allow first-frame/static conversion”",
    );
  const bitmap = await decode(b);
  width = bitmap.width;
  height = bitmap.height;
  const dims = resized(width, height, o.width, o.height, o.upscale);
  if (dims.width * dims.height > 64_000_000) {
    bitmap.close();
    throw new DownloadFailure("permanent", "Conversion exceeds 64 megapixels");
  }
  const canvas = document.createElement("canvas");
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext("2d")!;
  if (o.format === "jpeg") {
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap.source, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const result = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(Error("Conversion failed"));
      },
      `image/${o.format}`,
      o.format === "png" ? undefined : o.qualityValue,
    );
  });
  if (result.type !== `image/${o.format}`)
    throw new DownloadFailure("permanent", "Requested image encoder unavailable");
  return {
    blobUrl: objectUrl(result),
    bytes: result.size,
    format: o.format,
    width: dims.width,
    height: dims.height,
  };
}
chrome.runtime.onMessage.addListener((m, s, reply) => {
  if (
    m?.target !== "offscreen" ||
    s.id !== chrome.runtime.id ||
    (s.url && s.url !== chrome.runtime.getURL("background.js"))
  )
    return false;
  activeOperations++;
  const generation = processingGeneration;
  (async () => {
    switch (m.operation) {
      case "CLEANUP": {
        processingGeneration++;
        for (const controller of previewControllers.values())
          controller.abort();
        const retained = new Set<string>(m.retain || []);
        for (const url of blobs.keys()) if (!retained.has(url)) revoke(url);
        archives.clear();
        return true;
      }
      case "IMAGE": {
        if (m.requestId && cancelledPreviews.delete(m.requestId))
          throw Error("Preview cancelled");
        const controller = m.requestId ? new AbortController() : undefined;
        if (controller) previewControllers.set(m.requestId, controller);
        try {
          const result = await image(
            m.url,
            m.output,
            m.allowedFormats,
            controller?.signal,
          );
          if (controller?.signal.aborted) {
            revoke(result.blobUrl);
            throw Error("Preview cancelled");
          }
          return result;
        } finally {
          if (controller) {
            previewControllers.delete(m.requestId);
            cancelledPreviews.delete(m.requestId);
          }
        }
      }
      case "CANCEL":
        cancelledPreviews.add(m.requestId);
        if (cancelledPreviews.size > 256)
          cancelledPreviews.delete(cancelledPreviews.values().next().value!);
        previewControllers.get(m.requestId)?.abort();
        return true;
      case "PROBE": {
        const b = await bytes(m.url);
        const bitmap = await decode(b);
        const info = {
          width: bitmap.width,
          height: bitmap.height,
          format: b.type.split("/")[1] || "unknown",
          bytes: b.size,
        };
        bitmap.close();
        return info;
      }
      case "REVOKE":
        revoke(m.url);
        return true;
      case "ZIP_BEGIN":
        archives.set(m.key, { files: {}, bytes: 0 });
        return true;
      case "ZIP_ADD": {
        const a = archives.get(m.key);
        if (!a || !blobs.has(m.url)) throw Error("Archive/image unavailable");
        const b = await (await fetch(m.url)).arrayBuffer();
        if (!archiveFits(a.bytes, b.byteLength))
          throw Error("Archive input limit exceeded");
        a.files[m.name] = [new Uint8Array(b), { level: 0 }];
        a.bytes += b.byteLength;
        revoke(m.url);
        return true;
      }
      case "ZIP_END": {
        const a = archives.get(m.key);
        if (!a) throw Error("Archive unavailable");
        archives.delete(m.key);
        const result = await new Promise<Uint8Array<ArrayBuffer>>(
          (resolve, reject) =>
            zip(a.files, { level: 0 }, (err, data) => {
              if (err) reject(err);
              else resolve(new Uint8Array(data));
            }),
        );
        return {
          blobUrl: objectUrl(new Blob([result], { type: "application/zip" })),
          bytes: result.length,
        };
      }
      case "ZIP_ABORT":
        archives.delete(m.key);
        return true;
      default:
        throw Error("Invalid processing operation");
    }
  })()
    .then((result) => {
      if (
        generation !== processingGeneration &&
        result &&
        typeof result === "object" &&
        "blobUrl" in result
      ) {
        revoke(result.blobUrl);
        throw Error("Processing interrupted by worker recovery");
      }
      reply(result);
    })
    .catch((e: unknown) => { reply({ error: String(e) }); })
    .finally(() => activeOperations--);
  return true;
});
// URLs stay alive until the download manager acknowledges completion. No idle timer may revoke an active download.
setInterval(() => {
  if (!activeOperations && !blobs.size && !archives.size)
    chrome.runtime.sendMessage({ type: "OFFSCREEN_IDLE" }).catch(() => {});
}, 60000);
