import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForDictationEnvironmentReady } from "./waitForEnvironment";

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForDictationEnvironmentReady", () => {
  it("lets a ready environment proceed", async () => {
    await expect(
      waitForDictationEnvironmentReady(new AbortController().signal, 10, async () => undefined),
    ).resolves.toBeUndefined();
  });

  it("bounds a hung bootstrap before microphone startup", async () => {
    vi.useFakeTimers();
    const pending = waitForDictationEnvironmentReady(
      new AbortController().signal,
      100,
      () => new Promise(() => undefined),
    );
    const rejection = expect(pending).rejects.toThrow("dictation_startup_timeout");
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
  });

  it("releases the wait immediately on cancellation", async () => {
    const controller = new AbortController();
    const pending = waitForDictationEnvironmentReady(
      controller.signal,
      10_000,
      () => new Promise(() => undefined),
    );
    const rejection = expect(pending).rejects.toThrow("dictation_startup_cancelled");
    controller.abort();
    await rejection;
  });
});
