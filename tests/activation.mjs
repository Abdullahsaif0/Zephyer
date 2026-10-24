// Existing suites explicitly simulate toolbar activation for their fixture tabs.
// The new gallery suite verifies that ordinary pages remain dormant without it.
async function install(worker) {
  for (let i = 0; i < 100; i++) {
    try {
      if (
        await worker.evaluate(
          () => typeof globalThis.activateZephyerTab === "function",
        )
      )
        break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  await worker.evaluate(async () => {
    if (!globalThis.fixtureActivationInstalled) {
      globalThis.fixtureActivationInstalled = true;
      chrome.webNavigation.onCommitted.addListener((d) => {
        if (d.frameId === 0 && /^https?:/.test(d.url))
          void chrome.storage.session
            .get("activation")
            .then((saved) => {
              if (!(saved.activation || []).includes(d.tabId))
                return globalThis.activateZephyerTab(d.tabId);
            })
            .catch(() => {});
      });
    }
    const saved = await chrome.storage.session.get("activation");
    for (const tab of await chrome.tabs.query({}))
      if (
        tab.id &&
        /^https?:/.test(tab.url || "") &&
        !(saved.activation || []).includes(tab.id)
      )
        await globalThis.activateZephyerTab(tab.id);
  });
}
export async function activateFixtures(context, worker) {
  if (!context.fixtureActivationHook) {
    context.fixtureActivationHook = true;
    context.on("serviceworker", (next) => void install(next).catch(() => {}));
    context.on("page", (page) =>
      page.on("domcontentloaded", () => {
        if (/^https?:/.test(page.url())) {
          const current = context.serviceWorkers().at(-1);
          if (current) void install(current).catch(() => {});
        }
      }),
    );
  }
  await install(worker);
}
