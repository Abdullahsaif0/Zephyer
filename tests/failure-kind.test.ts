import { describe, expect, it } from "vitest";
import {
  DownloadFailure,
  failureKind,
  permanentFailure,
  userCancelled,
} from "../src/shared";

describe("structured download failures", () => {
  it("classifies DownloadFailure by its kind, never by message text", () => {
    // The word "cancelled" inside an unrelated permanent message must not
    // flip the kind — this is the regression the string-only era allowed.
    const sneaky = new DownloadFailure(
      "permanent",
      "user cancelled the filename Invalid characters check",
    );
    expect(failureKind(sneaky)).toBe("permanent");
    expect(userCancelled(sneaky)).toBe(false);
    expect(new DownloadFailure("cancelled", "USER_CANCELED").kind).toBe(
      "cancelled",
    );
    expect(failureKind(new DownloadFailure("rate-limited", "HTTP 429"))).toBe(
      "rate-limited",
    );
  });

  it("keeps the Chromium-string fallback for bare download errors", () => {
    expect(userCancelled("USER_CANCELED")).toBe(true);
    expect(userCancelled("Download cancelled by user")).toBe(true);
    expect(permanentFailure("SERVER_UNAUTHORIZED")).toBe(true);
    expect(permanentFailure("SERVER_FORBIDDEN")).toBe(true);
    expect(permanentFailure("Not an image: text/html")).toBe(true);
    expect(failureKind("NETWORK_DISCONNECTED")).toBe("transient");
    expect(failureKind(undefined)).toBe("transient");
  });

  it("preserves cause chains like plain Errors", () => {
    const cause = Error("root");
    const e = new DownloadFailure("transient", "wrapped", { cause });
    expect(e.cause).toBe(cause);
  });
});
