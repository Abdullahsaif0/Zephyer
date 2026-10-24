import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activateReliably, activationStatuses } from "../src/activation";
let api: any;
beforeEach(() => {
  activationStatuses.clear();
  api = {
    runtime: { getManifest: () => ({ version: "1.7.0" }) },
    storage: { session: { set: vi.fn().mockResolvedValue(undefined) } },
    permissions: { contains: vi.fn().mockResolvedValue(true) },
    webNavigation: {
      getFrame: vi.fn().mockResolvedValue({ documentId: "document-1" }),
      getAllFrames: vi.fn().mockResolvedValue([{ frameId: 0 }]),
    },
    tabs: {
      get: vi
        .fn()
        .mockResolvedValue({ id: 1, url: "https://www.instagram.com/p/test/" }),
      sendMessage: vi
        .fn()
        .mockImplementation(async (_id, m) =>
          m.type === "PING"
            ? { version: "1.7.0", initialized: true }
            : { mounted: true, visible: true },
        ),
    },
    scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    action: {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
    },
  };
  vi.stubGlobal("chrome", api);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("activation handshake", () => {
  it("injects a missing receiver once under concurrent clicks", async () => {
    api.tabs.sendMessage.mockRejectedValueOnce(Error("No receiver"));
    const commit = vi.fn().mockResolvedValue(undefined);
    await Promise.all(
      Array.from({ length: 12 }, () => activateReliably(1, commit)),
    );
    expect(api.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(activationStatuses.get(1)?.stage).toBe("ready");
  });
  it("retries once after navigation interrupts injection", async () => {
    let doc = "document-1";
    api.webNavigation.getFrame.mockImplementation(async () => ({
      documentId: doc,
    }));
    api.tabs.sendMessage.mockRejectedValueOnce(Error("No receiver"));
    api.scripting.executeScript.mockImplementationOnce(async () => {
      doc = "document-2";
      throw Error("Frame changed");
    });
    const commit = vi.fn().mockResolvedValue(undefined);
    await activateReliably(2, commit);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(activationStatuses.get(2)?.documentId).toBe("document-2");
  });
  it("classifies withheld access without attempting injection", async () => {
    api.permissions.contains.mockResolvedValue(false);
    await expect(activateReliably(3, async () => {})).rejects.toThrow(
      /withheld/,
    );
    expect(activationStatuses.get(3)?.category).toBe("access-withheld");
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  });
  it("does not acknowledge an invisible dock", async () => {
    api.tabs.sendMessage.mockImplementation(async (_id: number, m: any) =>
      m.type === "PING"
        ? { version: "1.7.0", initialized: true }
        : { mounted: true, visible: false },
    );
    await expect(activateReliably(4, async () => {})).rejects.toThrow(
      /not visible/,
    );
    expect(activationStatuses.get(4)?.category).toBe("rendering");
    expect(api.action.setBadgeText).toHaveBeenCalledWith({
      tabId: 4,
      text: "!",
    });
  });
  it("redacts Chromium errors that include signed URLs", async () => {
    api.tabs.sendMessage.mockRejectedValueOnce(Error("No receiver"));
    api.scripting.executeScript.mockRejectedValue(
      Error("Failed https://private.test/image?token=secret"),
    );
    await expect(activateReliably(5, async () => {})).rejects.toThrow(
      /Activation failed/,
    );
    expect(JSON.stringify(activationStatuses.get(5))).not.toMatch(
      /private.test|secret/,
    );
  });
  it("bounds slow initialization to ten seconds without committing activation", async () => {
    vi.useFakeTimers();
    api.tabs.sendMessage.mockResolvedValue({
      version: "1.7.0",
      initialized: false,
    });
    const commit = vi.fn().mockResolvedValue(undefined),
      started = Date.now();
    const result = activateReliably(6, commit).catch((error) => error);
    await vi.runAllTimersAsync();
    expect(await result).toBeInstanceOf(Error);
    expect(Date.now() - started).toBeLessThanOrEqual(10075);
    expect(commit).not.toHaveBeenCalled();
    expect(activationStatuses.get(6)?.category).toBe("initialization");
  });
});
