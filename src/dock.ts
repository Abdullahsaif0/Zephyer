import { Lifecycle } from "./lifecycle";
import {
  type DockLayout,
  type Settings,
  type ScanSession,
  type PagePowerState,
  type SiteCapability,
} from "./shared";
import { iconElement, type IconName } from "./icons";
export function clampPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
) {
  return {
    x: Math.max(12, Math.min(x, Math.max(12, vw - w - 12))),
    y: Math.max(12, Math.min(y, Math.max(12, vh - h - 12))),
  };
}
export function validLayout(v: any): v is DockLayout {
  return (
    !!v &&
    [v.x, v.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
    ["compact", "expanded", "minimized"].includes(v.state) &&
    ["compact", "expanded"].includes(v.restoreState)
  );
}
type Model = {
  capability?: SiteCapability;
  count: number;
  selected: number;
  mode: boolean;
  scan: ScanSession;
  settings: Settings;
  power: PagePowerState;
  powerBusy: boolean;
};
type Actions = {
  traverse?: (target: "carousel" | "stories") => void;
  power: () => void;
  gallery: () => void;
  scanNow: () => void;
  automatic: () => void;
  select: () => void;
  scan: () => void;
  download: () => void;
  zip: () => void;
  library: () => void;
  stop: () => void;
  all: () => void;
  clear: () => void;
  preferences: () => void;
  save: (v: DockLayout) => void;
  reset: () => void;
};
export class Dock {
  private lifecycle = new Lifecycle();
  dispose() {
    this.lifecycle.dispose();
    cancelAnimationFrame(this.raf);
    this.menu.remove();
    this.hud.remove();
  }
  root: HTMLElement;
  menu: HTMLDivElement;
  layout: DockLayout = {
    x: 0.5,
    y: 1,
    state: "compact",
    restoreState: "compact",
  };
  private orientation = "horizontal";
  private model?: Model;
  private initialized = false;
  private drag?:
    | {
        id: number;
        startX: number;
        startY: number;
        x: number;
        y: number;
        old: DockLayout;
        moved: boolean;
      }
    | undefined;
  private x = 0;
  private y = 0;
  private raf = 0;
  private count = document.createElement("span");
  private foundCount = document.createElement("span");
  private selectedCount = document.createElement("span");
  private selectedNumber = document.createElement("span");
  private offCopy = document.createElement("span");
  private status = document.createElement("p");
  private actions = document.createElement("div");
  private header = document.createElement("div");
  private controls = document.createElement("div");
  private buttons = new Map<string, HTMLButtonElement>();
  private grip: HTMLButtonElement;
  private hud = document.createElement("div");
  private hudTitle = document.createElement("strong");
  private hudDetail = document.createElement("span");
  private elapsed = document.createElement("small");
  private finishedAt = 0;
  private lastScanState = "";
  private announcement = document.createElement("span");
  constructor(
    root: HTMLElement,
    private callbacks: Actions,
  ) {
    this.root = root;
    root.hidden = true;
    root.className = "z-dock";
    root.setAttribute("role", "toolbar");
    root.setAttribute("aria-label", "Zephyer image controls");
    root.dataset["state"] = "compact";
    root.dataset["orientation"] = "horizontal";
    this.grip = this.make("grip", "Move dock", "grip", () => {});
    this.grip.classList.add("z-grip");
    this.grip.setAttribute(
      "aria-description",
      "Drag to move. Arrow keys move the dock. Shift moves faster. Escape cancels dragging.",
    );
    const mark = document.createElement("span");
    mark.className = "z-mark";
    mark.append(iconElement("brand"));
    mark.title = "Zephyer";
    this.count.className = "z-count";
    this.foundCount.className = "z-found-count";
    this.selectedCount.className = "z-selected-count";
    this.selectedCount.append(iconElement("check"), this.selectedNumber);
    this.count.append(this.foundCount, this.selectedCount);
    this.header.className = "z-dock-header";
    this.controls.className = "z-dock-controls";
    this.actions.className = "z-dock-actions";
    this.status.className = "z-dock-status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "off");
    this.announcement.className = "z-sr-only";
    this.announcement.setAttribute("role", "status");
    this.announcement.setAttribute("aria-live", "polite");
    root.append(this.announcement);
    const powerButton = this.make(
      "power",
      "Turn off this website",
      "power",
      callbacks.power,
    );
    this.controls.append(
      powerButton,
      this.make("expand", "Expand controls", "expand", () => { this.setState(
          this.layout.state === "expanded" ? "compact" : "expanded",
        ); },
      ),
      this.make("minimize", "Minimize dock", "minimize", () => { this.setState("minimized"); },
      ),
      this.make("more", "More options", "more", () => { this.toggleMenu(); }),
    );
    this.header.append(this.grip, mark, this.count, this.controls);
    for (const [key, label, icon, fn] of [
      ["select", "Select mode", "select", callbacks.select],
      ["scan", "Scan full page", "scan", callbacks.scan],
      ["download", "Download selected", "download", callbacks.download],
      ["library", "Open side library", "library", callbacks.library],
      ["stop", "Stop scan", "stop", callbacks.stop],
      ["all", "Select all", "all", callbacks.all],
      ["clear", "Clear selection", "clear", callbacks.clear],
    ] as [string, string, IconName, () => void][]) {
      this.actions.append(this.make(key, label, icon, fn));
    }
    const restore = this.make("restore", "Restore dock", "expand", () => { this.setState(this.layout.restoreState); },
    );
    restore.className += " z-restore";
    this.offCopy.className = "z-off-copy";
    const enable = this.make(
      "enable",
      "Turn on this website",
      "power",
      callbacks.power,
    );
    enable.classList.add("z-enable");
    root.append(
      this.header,
      this.actions,
      this.status,
      restore,
      this.offCopy,
      enable,
    );
    this.menu = document.createElement("div");
    this.menu.className = "z-dock-menu";
    this.menu.hidden = true;
    this.menu.setAttribute("role", "group");
    this.menu.setAttribute("aria-label", "Dock options");
    const reset = this.make("reset", "Reset position", "reset", () => {
      callbacks.reset();
      this.closeMenu();
      this.reset();
      this.grip.focus();
    });
    const prefs = this.make("preferences", "Preferences", "settings", () => {
      callbacks.preferences();
      this.closeMenu();
    });
    const zip = this.make("zip", "Download selected ZIP", "zip", () => {
      callbacks.zip();
      this.closeMenu();
    });
    const expandMenu = this.make(
      "expand-menu",
      "Expand controls",
      "expand",
      () => {
        this.closeMenu();
        this.setState("expanded");
      },
    );
    expandMenu.classList.add("z-narrow-expand");
    this.menu.append(
      this.make("carousel", "Start carousel scan", "scan", () => {
        callbacks.traverse?.("carousel");
        this.closeMenu();
      }),
      this.make("stories", "Start Story scan", "scan", () => {
        callbacks.traverse?.("stories");
        this.closeMenu();
      }),
      this.make("gallery", "Open Photos Gallery", "photos", () => {
        callbacks.gallery();
        this.closeMenu();
      }),
      this.make("scan-now", "Scan now", "scan", () => {
        callbacks.scanNow();
        this.closeMenu();
      }),
      this.make(
        "automatic",
        "Automatically collect images",
        "scan",
        callbacks.automatic,
      ),
      zip,
      expandMenu,
      reset,
      prefs,
    );
    this.actions.append(
      this.make(
        "gallery-expanded",
        "Open Photos Gallery",
        "photos",
        callbacks.gallery,
      ),
    );
    this.actions.append(
      this.make("scan-now-expanded", "Scan now", "scan", callbacks.scanNow),
      this.make(
        "automatic-expanded",
        "Automatically collect images",
        "scan",
        callbacks.automatic,
      ),
    );
    root.after(this.menu);
    this.hud.className = "z-scan-hud";
    this.hud.hidden = true;
    this.hud.setAttribute("aria-label", "Page scan activity");
    const track = document.createElement("div");
    track.className = "z-scan-track";
    track.setAttribute("aria-hidden", "true");
    track.append(document.createElement("i"));
    const text = document.createElement("div");
    text.className = "z-scan-copy";
    text.append(this.hudTitle, this.hudDetail, this.elapsed);
    const pause = this.make("hud-pause", "Pause scan", "pause", callbacks.scan);
    const stop = this.make("hud-stop", "Stop scan", "stop", callbacks.stop);
    this.hud.append(track, text, pause, stop);
    root.after(this.hud);
    this.lifecycle.interval(() => { this.updateHud(); }, 1000);
    this.lifecycle.listen(document, "visibilitychange", () => {
      this.hud.dataset["hiddenPage"] = String(document.hidden);
    });
    this.grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !e.isPrimary) return;
      e.preventDefault();
      this.closeMenu();
      this.grip.focus();
      this.grip.setPointerCapture(e.pointerId);
      this.drag = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        x: this.x,
        y: this.y,
        old: { ...this.layout },
        moved: false,
      };
    });
    this.grip.addEventListener("pointermove", (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      if (
        Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4 &&
        !d.moved
      )
        return;
      d.moved = true;
      root.dataset["dragging"] = "true";
      this.move(d.x + e.clientX - d.startX, d.y + e.clientY - d.startY);
    });
    this.grip.addEventListener("pointerup", (e) => { this.finish(e.pointerId, false); },
    );
    this.grip.addEventListener("pointercancel", (e) => { this.finish(e.pointerId, true); },
    );
    this.grip.addEventListener("lostpointercapture", (e) => {
      if (this.drag) this.finish(e.pointerId, true);
    });
    this.grip.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.drag) {
        e.preventDefault();
        e.stopPropagation();
        this.finish(this.drag.id, true);
        return;
      }
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const step = delta[e.key];
      if (step) {
        e.preventDefault();
        const n = e.shiftKey ? 40 : 10;
        this.move(this.x + step[0] * n, this.y + step[1] * n);
        this.remember();
      }
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.drag) this.closeMenu();
    });
    this.menu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeMenu();
        this.buttons.get("more")!.focus();
      }
    });
    root.getRootNode().addEventListener("pointerdown", (e) => {
      if (
        !e.composedPath().includes(this.menu) &&
        !e.composedPath().includes(this.buttons.get("more")!)
      )
        this.closeMenu();
    });
    const observer = new ResizeObserver(() => { this.place(); });
    observer.observe(root);
    this.lifecycle.listen(window, "resize", () => { this.place(); });
    if (window.visualViewport)
      this.lifecycle.listen(window.visualViewport, "resize", () => { this.place(); },
      );
  }
  private make(key: string, label: string, icon: IconName, fn: () => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "z-action";
    b.dataset["action"] = key;
    b.title = label;
    b.setAttribute("aria-label", label);
    b.append(iconElement(icon));
    const text = document.createElement("span");
    text.className = "z-label";
    text.textContent = label;
    b.append(text);
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    this.buttons.set(key, b);
    return b;
  }
  private changeIcon(key: string, name: IconName, label: string) {
    const b = this.buttons.get(key)!;
    if (b.dataset["icon"] !== name) {
      b.querySelector("svg")!.replaceWith(iconElement(name));
      b.dataset["icon"] = name;
    }
    b.title = label;
    b.setAttribute("aria-label", label);
    b.querySelector(".z-label")!.textContent = label;
  }
  private viewport() {
    return {
      w: window.visualViewport?.width || innerWidth,
      h: window.visualViewport?.height || innerHeight,
    };
  }
  private move(x: number, y: number) {
    const v = this.viewport(),
      p = clampPosition(
        x,
        y,
        this.root.offsetWidth,
        this.root.offsetHeight,
        v.w,
        v.h,
      );
    this.x = p.x;
    this.y = p.y;
    this.root.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
    this.positionHud();
    if (!this.menu.hidden) this.positionMenu();
  }
  private place() {
    if (this.drag) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const v = this.viewport();
      this.root.style.maxWidth = Math.max(0, v.w - 24) + "px";
      this.root.style.maxHeight = Math.max(0, v.h - 24) + "px";
      this.move(
        12 + this.layout.x * Math.max(0, v.w - this.root.offsetWidth - 24),
        12 + this.layout.y * Math.max(0, v.h - this.root.offsetHeight - 24),
      );
    });
  }
  private remember() {
    const v = this.viewport();
    this.layout.x = Math.max(
      0,
      Math.min(
        1,
        (this.x - 12) / Math.max(1, v.w - this.root.offsetWidth - 24),
      ),
    );
    this.layout.y = Math.max(
      0,
      Math.min(
        1,
        (this.y - 12) / Math.max(1, v.h - this.root.offsetHeight - 24),
      ),
    );
    this.callbacks.save({ ...this.layout });
  }
  private finish(id: number, cancel: boolean) {
    const d = this.drag;
    if (!d || d.id !== id) return;
    this.drag = undefined;
    delete this.root.dataset["dragging"];
    if (this.grip.hasPointerCapture(id)) this.grip.releasePointerCapture(id);
    if (cancel) {
      this.layout = d.old;
      this.move(d.x, d.y);
    } else if (d.moved) this.remember();
    this.place();
  }
  private setState(state: DockLayout["state"]) {
    if (this.drag) this.finish(this.drag.id, true);
    if (state === "minimized" && this.layout.state !== "minimized")
      this.layout.restoreState = this.layout.state;
    this.layout.state = state;
    if (state !== "minimized") this.layout.restoreState = state;
    this.root.dataset["state"] = state;
    this.closeMenu();
    this.changeIcon(
      "expand",
      state === "expanded" ? "compact" : "expand",
      state === "expanded" ? "Compact controls" : "Expand controls",
    );
    this.place();
    this.callbacks.save({ ...this.layout });
    if (state === "minimized") this.buttons.get("restore")!.focus();
    else this.buttons.get("expand")!.focus();
  }
  setLayout(layout: DockLayout | null) {
    this.root.dataset["restoring"] = "true";
    this.root.hidden = false;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => delete this.root.dataset["restoring"]),
    );
    this.initialized = true;
    this.layout = validLayout(layout) ? { ...layout } : this.defaultLayout();
    this.root.dataset["state"] = this.layout.state;
    this.changeIcon(
      "expand",
      this.layout.state === "expanded" ? "compact" : "expand",
      this.layout.state === "expanded" ? "Compact controls" : "Expand controls",
    );
    this.place();
  }
  private defaultLayout(): DockLayout {
    return {
      x: this.orientation === "vertical" ? 1 : 0.5,
      y: this.orientation === "vertical" ? 0.5 : 1,
      state: "compact",
      restoreState: "compact",
    };
  }
  reset() {
    this.setLayout(null);
  }
  update(model: Model) {
    for (const target of ["carousel", "stories"] as const) {
      const button = this.buttons.get(target)!;
      button.disabled =
        !model.capability?.targets.includes(target) ||
        model.mode ||
        !model.power.effectiveEnabled ||
        ["running", "paused"].includes(model.scan.state) ||
        (target === "stories" && !model.settings.instagramStoriesEnabled);
      button.title =
        target === "stories" && !model.settings.instagramStoriesEnabled
          ? "Enable optional Stories in Preferences first"
          : button.getAttribute("aria-label") || "";
    }
    const powerChanged =
      this.model?.power.effectiveEnabled !== model.power.effectiveEnabled;
    const priorFocus =
      this.root.getRootNode() instanceof ShadowRoot
        ? (this.root.getRootNode() as ShadowRoot).activeElement
        : null;
    this.model = model;
    this.root.dataset["power"] = model.power.effectiveEnabled ? "on" : "off";
    this.root.dataset["powerReason"] = model.power.reason;
    this.root.setAttribute("aria-busy", String(model.powerBusy));
    this.offCopy.textContent = model.power.globalEnabled
      ? "Zephyer off"
      : "Globally paused";
    this.changeIcon("power", "power", `Turn off for ${model.power.hostname}`);
    this.changeIcon(
      "enable",
      model.power.globalEnabled ? "power" : "settings",
      model.power.globalEnabled
        ? `Turn on for ${model.power.hostname}`
        : "Open Preferences · globally paused",
    );
    this.buttons.get("enable")!.querySelector(".z-label")!.textContent =
      model.powerBusy
        ? "Saving…"
        : model.power.globalEnabled
          ? "Turn on"
          : "Preferences";
    this.buttons
      .get("power")!
      .setAttribute("aria-pressed", String(model.power.effectiveEnabled));
    this.buttons
      .get("power")!
      .setAttribute("aria-disabled", String(model.powerBusy));
    this.buttons
      .get("enable")!
      .setAttribute("aria-disabled", String(model.powerBusy));
    if (!model.power.effectiveEnabled) {
      this.closeMenu();
      if (powerChanged && this.root.getRootNode() instanceof ShadowRoot) {
        const focused = priorFocus;
        if (
          focused &&
          focused !== this.grip &&
          focused !== this.buttons.get("enable")
        )
          this.buttons.get("enable")!.focus();
      }
    }
    if (powerChanged) {
      this.place();
      if (
        model.power.effectiveEnabled &&
        priorFocus === this.buttons.get("enable")
      )
        this.buttons
          .get(this.layout.state === "minimized" ? "restore" : "power")!
          .focus();
    }
    const orientation = model.settings.dockOrientation;
    if (this.orientation !== orientation) {
      this.orientation = orientation;
      this.root.dataset["orientation"] = orientation;
      this.closeMenu();
      this.place();
    }
    if (this.foundCount.textContent !== String(model.count)) {
      this.foundCount.textContent = String(model.count);
      if (
        model.scan.state === "running" &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        this.foundCount.getAnimations().forEach((a) => { a.cancel(); });
        this.foundCount.animate(
          [
            { opacity: 0.55, translate: "0 2px" },
            { opacity: 1, translate: "0 0" },
          ],
          { duration: 220, easing: "ease-out" },
        );
      }
    }
    if (this.selectedNumber.textContent !== String(model.selected))
      this.selectedNumber.textContent = String(model.selected);
    this.count.setAttribute(
      "aria-label",
      `${model.count} images found, ${model.selected} selected`,
    );
    this.selectedCount.title = `${model.selected} selected`;
    this.selectedCount.setAttribute("aria-label", `${model.selected} selected`);
    this.selectedCount.dataset["empty"] = String(model.selected === 0);
    this.count.title = `${model.count} images found · ${model.selected} selected`;
    this.root.dataset["scanning"] = String(model.scan.state === "running");
    this.updateHud();
    if (this.status.textContent !== model.scan.reason)
      this.status.textContent = model.scan.reason;
    this.buttons
      .get("select")!
      .setAttribute("aria-pressed", String(model.mode));
    this.buttons.get("gallery")!.disabled = !model.count;
    this.buttons.get("gallery-expanded")!.disabled = !model.count;
    this.buttons
      .get("automatic-expanded")!
      .setAttribute("aria-pressed", String(model.settings.automaticCollection));
    this.buttons
      .get("automatic-expanded")!
      .querySelector(".z-label")!.textContent =
      `Auto collect · ${model.settings.automaticCollection ? "On" : "Off"}`;
    this.buttons
      .get("gallery-expanded")!
      .classList.toggle("z-gallery-ready", model.scan.state === "complete");
    this.buttons
      .get("automatic")!
      .setAttribute("aria-pressed", String(model.settings.automaticCollection));
    this.buttons.get("automatic")!.querySelector(".z-label")!.textContent =
      `Automatic collection · ${model.settings.automaticCollection ? "On" : "Off"}`;
    this.buttons.get("download")!.disabled = !model.selected;
    this.buttons.get("zip")!.disabled = !model.selected;
    this.buttons.get("zip")!.title =
      `Download ${model.selected} selected images as ZIP`;
    this.buttons.get("download")!.title =
      `Download ${model.selected} selected images`;
    this.changeIcon(
      "scan",
      model.scan.state === "running"
        ? "pause"
        : model.scan.state === "paused"
          ? "play"
          : "scan",
      model.scan.state === "running"
        ? "Pause scan"
        : model.scan.state === "paused"
          ? "Resume scan"
          : "Scan full page",
    );
    this.buttons.get("stop")!.disabled = !["running", "paused"].includes(
      model.scan.state,
    );
    this.buttons.get("clear")!.disabled = !model.selected;
    if (!this.initialized) this.place();
  }
  private closeMenu() {
    this.menu.hidden = true;
    this.buttons.get("more")!.setAttribute("aria-expanded", "false");
  }
  private positionHud() {
    if (this.hud.hidden) return;
    const v = this.viewport(),
      h = this.hud.offsetHeight;
    const p = clampPosition(
      this.x,
      this.y > h + 24 ? this.y - h - 10 : this.y + this.root.offsetHeight + 10,
      this.hud.offsetWidth,
      h,
      v.w,
      v.h,
    );
    this.hud.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
  }
  private updateHud() {
    const m = this.model;
    if (!m) return;
    if (!m.power.effectiveEnabled) {
      this.hud.hidden = true;
      return;
    }
    const s = m.scan;
    if (this.lastScanState !== s.state) {
      this.lastScanState = s.state;
      this.announcement.textContent =
        s.state === "running"
          ? "Page scan running"
          : s.state === "paused"
            ? "Page scan paused"
            : s.state === "complete"
              ? "Page scan complete"
              : s.state === "stopped"
                ? "Page scan stopped"
                : "";
      this.finishedAt = ["complete", "stopped"].includes(s.state)
        ? Date.now()
        : 0;
    }
    const working = ["running", "paused"].includes(s.state);
    this.hud.hidden =
      !m.power.effectiveEnabled ||
      this.layout.state === "minimized" ||
      (!working && (!this.finishedAt || Date.now() - this.finishedAt > 4000));
    this.hud.dataset["phase"] =
      s.state === "running" ? s.phase || "scanning" : s.state;
    this.hudTitle.textContent =
      s.state === "paused"
        ? "Scan paused"
        : s.state === "complete"
          ? "Loaded page collected"
          : s.state === "stopped"
            ? "Scan stopped"
            : s.phase === "waiting"
              ? "Waiting for page content"
              : "Exploring this page";
    this.hudDetail.textContent = `${m.count} useful · ${s.excluded || 0} excluded · ${s.pending || 0} pending`;
    this.elapsed.textContent = `${Math.max(0, Math.floor((Date.now() - (s.started || Date.now())) / 1000))}s elapsed · ${s.steps} steps`;
    this.changeIcon(
      "hud-pause",
      s.state === "paused" ? "play" : "pause",
      s.state === "paused" ? "Resume scan" : "Pause scan",
    );
    this.buttons.get("hud-pause")!.hidden = !working;
    this.buttons.get("hud-stop")!.hidden = !working;
    this.positionHud();
  }
  private toggleMenu() {
    this.menu.hidden = !this.menu.hidden;
    this.buttons
      .get("more")!
      .setAttribute("aria-expanded", String(!this.menu.hidden));
    if (!this.menu.hidden) {
      this.positionMenu();
      Array.from(
        this.menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      )
        .find((button) => button.getClientRects().length > 0)
        ?.focus();
    }
  }
  private positionMenu() {
    const v = this.viewport(),
      height = this.menu.offsetHeight;
    const p = clampPosition(
      this.x,
      this.y > height + 24
        ? this.y - height - 8
        : this.y + this.root.offsetHeight + 8,
      this.menu.offsetWidth,
      height,
      v.w,
      v.h,
    );
    this.menu.style.left = p.x + "px";
    this.menu.style.top = p.y + "px";
  }
}
