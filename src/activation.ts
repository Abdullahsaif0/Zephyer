import type { ActivationStatus } from "./shared";
const running = new Map<number, Promise<void>>();
export const activationStatuses = new Map<number, ActivationStatus>();
export async function activationStatus(tabId: number) {
  return (
    activationStatuses.get(tabId) ||
    (await chrome.storage.session.get(`activation:${tabId}`))[
      `activation:${tabId}`
    ]
  );
}
function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => { reject(Error("Handshake timed out")); }, ms);
    }),
  ]).finally(() => { clearTimeout(timer); });
}
export function activateReliably(tabId: number, commit: () => Promise<void>) {
  if (running.has(tabId)) return running.get(tabId)!;
  const task = (async () => {
    const deadline = Date.now() + 10000;
    let status: ActivationStatus = {
      tabId,
      stage: "checking",
      detail: "Checking document receiver",
      updated: Date.now(),
    };
    const update = async (patch: Partial<ActivationStatus>) => {
      status = { ...status, ...patch, updated: Date.now() };
      activationStatuses.set(tabId, status);
      // Diagnostic persistence must not hide the actionable failure when
      // session storage itself is unavailable. Activation persistence remains
      // mandatory in the commit callback.
      await chrome.storage.session
        .set({ [`activation:${tabId}`]: status })
        .catch(() => {});
    };
    const check = () => {
      if (Date.now() >= deadline) throw Error("Activation timed out");
    };
    const send = (m: object) => {
      check();
      return bounded(
        chrome.tabs.sendMessage(tabId, m, { frameId: 0 }),
        Math.min(3000, deadline - Date.now()),
      );
    };
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          check();
          const tab = await chrome.tabs.get(tabId);
          if (!/^https?:\/\//.test(tab.url || "")) {
            status.category = "restricted";
            throw Error(
              "Chrome restricts injection on this page. Open an HTTP/HTTPS website.",
            );
          }
          if (
            !(await chrome.permissions.contains({
              origins: [new URL(tab.url!).origin + "/*"],
            }))
          ) {
            status.category = "access-withheld";
            throw Error(
              "Website access is withheld. Allow Zephyer in Chrome's extension site-access settings.",
            );
          }
          const frame = await chrome.webNavigation.getFrame({
            tabId,
            frameId: 0,
          });
          const docId = (frame as any)?.documentId;
          await update({ stage: "checking", documentId: docId });
          let ping;
          try {
            ping = await send({ type: "PING" });
          } catch {}
          if (ping?.version !== chrome.runtime.getManifest().version) {
            await update({
              stage: "injecting",
              category: "missing-receiver",
              detail: "Recovering missing or outdated content script",
            });
            check();
            await bounded(
              chrome.scripting.executeScript({
                target: { tabId, frameIds: [0] },
                files: ["content.js"],
              }),
              Math.min(3000, deadline - Date.now()),
            );
            // Recover accessible child frames individually; one restricted frame must
            // not prevent the top-level dock from activating.
            const frames = await chrome.webNavigation.getAllFrames({ tabId });
            await Promise.allSettled(
              (frames || [])
                .filter((f) => f.frameId !== 0)
                .map(async (f) => {
                  try {
                    const p = await bounded(
                      chrome.tabs.sendMessage(
                        tabId,
                        { type: "PING" },
                        { frameId: f.frameId },
                      ),
                      500,
                    );
                    if (p?.version === chrome.runtime.getManifest().version)
                      return;
                  } catch {}
                  check();
                  await bounded(
                    chrome.scripting.executeScript({
                      target: { tabId, frameIds: [f.frameId] },
                      files: ["content.js"],
                    }),
                    1000,
                  );
                }),
            );
          }
          await update({
            stage: "initializing",
            category: "initialization",
            detail: "Waiting for document initialization",
          });
          while (true) {
            const p = await send({ type: "PING" });
            if (p.initialized) break;
            await new Promise((r) => setTimeout(r, 75));
            check();
          }
          const current = await chrome.webNavigation.getFrame({
            tabId,
            frameId: 0,
          });
          if (docId && (current as any)?.documentId !== docId) {
            status.category = "navigation";
            if (!attempt) continue;
            throw Error(
              "The page changed during activation. Retry once navigation settles.",
            );
          }
          check();
          await commit();
          check();
          await update({
            stage: "mounting",
            category: "rendering",
            detail: "Verifying dock visibility",
          });
          const mounted = await send({ type: "SHOW_DOCK" });
          if (!mounted?.mounted || !mounted?.visible)
            throw Error(
              "The document receiver is ready but the dock is not visible. Refresh the page and Retry.",
            );
          await update({
            stage: "ready",
            category: undefined,
            detail: "Dock is visible",
          });
          await chrome.action.setBadgeText({ tabId, text: "" });
          return;
        } catch (error) {
          const now = await chrome.webNavigation
            .getFrame({ tabId, frameId: 0 })
            .catch(() => null);
          if (
            status.documentId &&
            (now as any)?.documentId !== status.documentId
          ) {
            status.category = "navigation";
            if (attempt === 0 && now && Date.now() < deadline) continue;
            throw Error(
              "The page changed during activation. Retry once navigation settles.",
              { cause: error },
            );
          }
          throw error;
        }
      }
    } catch (error) {
      // Error messages from Chromium may contain page URLs. Keep local diagnostic
      // details to our own actionable categories instead of copying those URLs.
      const own =
        error instanceof Error &&
        /^(Chrome restricts|Website access|The page changed|The document receiver)/.test(
          error.message,
        );
      await update({
        stage: "failed",
        detail: own
          ? (error).message
          : "Activation failed or timed out. Check site access, refresh the website, then Retry.",
        category: status.category || "initialization",
      });
      await chrome.action.setBadgeText({ tabId, text: "!" }).catch(() => {});
      await chrome.action
        .setBadgeBackgroundColor({ tabId, color: "#af3b48" })
        .catch(() => {});
      throw Error(status.detail, { cause: error });
    }
  })().finally(() => running.delete(tabId));
  running.set(tabId, task);
  return task;
}
export async function showTroubleshooting(tabId: number) {
  const url = chrome.runtime.getURL(`troubleshoot.html?tab=${tabId}`);
  const saved =
    ((await chrome.storage.session.get("troubleshootingTabs"))[
      "troubleshootingTabs"
    ] || {}) as Record<number, number>;
  if (saved[tabId]) {
    try {
      await chrome.tabs.update(saved[tabId], { active: true });
      return;
    } catch {}
  }
  const tab = await chrome.tabs.create({ url });
  if (typeof tab.id === "number") {
    saved[tabId] = tab.id;
    await chrome.storage.session.set({ troubleshootingTabs: saved });
  }
}
