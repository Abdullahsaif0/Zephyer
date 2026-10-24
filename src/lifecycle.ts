/** Resources owned by one content-script generation. */
export class Lifecycle {
  readonly controller = new AbortController();
  private timers = new Set<number>();
  listen<K extends keyof GlobalEventHandlersEventMap>(
    target: EventTarget,
    type: K,
    fn: (event: GlobalEventHandlersEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  listen(
    target: EventTarget,
    type: string,
    fn: (event: any) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  listen(
    target: EventTarget,
    type: string,
    fn: (event: any) => void,
    options: boolean | AddEventListenerOptions = {},
  ) {
    target.addEventListener(type, fn, {
      ...(typeof options === "boolean" ? { capture: options } : options),
      signal: this.controller.signal,
    });
  }
  timeout(fn: () => void, delay = 0) {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.controller.signal.aborted) fn();
    }, delay);
    this.timers.add(id);
    return id;
  }
  interval(fn: () => void, delay: number) {
    const id = window.setInterval(() => {
      if (!this.controller.signal.aborted) fn();
    }, delay);
    this.timers.add(id);
    return id;
  }
  dispose() {
    this.controller.abort();
    for (const id of this.timers) {
      clearTimeout(id);
      clearInterval(id);
    }
    this.timers.clear();
  }
}
