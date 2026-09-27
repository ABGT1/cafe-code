import type {
  DesktopBridge,
  DictationRealtimeClientSecret,
  DictationTranscriptionModel,
} from "@cafecode/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";

import type {
  RealtimeTranscriptionSession,
  StartRealtimeTranscriptionInput,
} from "~/dictation/realtimeTranscription";

const dictationHarness = vi.hoisted(() => ({
  startRealtimeTranscription: vi.fn(),
  latestInput: null as StartRealtimeTranscriptionInput | null,
}));

vi.mock("~/dictation/realtimeTranscription", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/dictation/realtimeTranscription")>()),
  startRealtimeTranscription: dictationHarness.startRealtimeTranscription,
}));

import { useComposerDictation } from "~/hooks/useComposerDictation";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

interface PromptState {
  value: string;
}

async function renderDictationController(prompt: PromptState, onError = vi.fn()) {
  return renderHook(() =>
    useComposerDictation({
      enabled: true,
      sessionKey: "test-session",
      createClientSecret: async (
        model: DictationTranscriptionModel,
      ): Promise<DictationRealtimeClientSecret> => ({
        clientSecret: "ephemeral-test-token",
        expiresAt: Date.now() + 60_000,
        model,
        sessionProfile: "transcription_pcm24k_minimal_v1",
      }),
      readComposerSnapshot: () => ({
        value: prompt.value,
        expandedCursor: prompt.value.length,
      }),
      replaceComposerRange: (input) => {
        if (prompt.value.slice(input.start, input.end) !== input.expectedText) return false;
        prompt.value = `${prompt.value.slice(0, input.start)}${input.replacement}${prompt.value.slice(input.end)}`;
        return true;
      },
      onError,
    }),
  );
}

function emitTranscript(transcript: string): void {
  const input = dictationHarness.latestInput;
  if (!input) throw new Error("Dictation transport input was not captured");
  input.onTranscript({
    transcript,
    // The hook intentionally treats the provider event as opaque; its only
    // responsibility here is applying the transport's selected transcript.
    event: {} as never,
  });
}

describe("useComposerDictation finalization boundary", () => {
  let originalDesktopBridge: DesktopBridge | undefined;

  beforeEach(() => {
    originalDesktopBridge = window.desktopBridge;
    dictationHarness.latestInput = null;
    dictationHarness.startRealtimeTranscription.mockReset();
  });

  afterEach(() => {
    if (originalDesktopBridge) window.desktopBridge = originalDesktopBridge;
    else delete window.desktopBridge;
    document.body.innerHTML = "";
  });

  it("does not start a second microphone capture when desktop denies the lease", async () => {
    const claim = vi.fn().mockResolvedValue(null);
    const release = vi.fn().mockResolvedValue(undefined);
    window.desktopBridge = {
      claimComposerDictationCapture: claim,
      releaseComposerDictationCapture: release,
    } as unknown as DesktopBridge;
    const onError = vi.fn();
    const hook = await renderDictationController({ value: "" }, onError);

    await hook.act(async () => {
      hook.result.current.toggle();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(hook.result.current.phase).toBe("idle");
    expect(onError).toHaveBeenCalledWith("Finish the other dictation before starting this one.");
    expect(claim).toHaveBeenCalledOnce();
    expect(dictationHarness.startRealtimeTranscription).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    await hook.unmount();
  });

  it("releases the exact desktop lease after final transcription settles", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    window.desktopBridge = {
      claimComposerDictationCapture: vi.fn().mockResolvedValue("lease-for-this-recording"),
      releaseComposerDictationCapture: release,
    } as unknown as DesktopBridge;
    const finalization = deferred<void>();
    const session: RealtimeTranscriptionSession = {
      cancel: vi.fn(),
      stopAndFinalize: vi.fn(() => finalization.promise),
    };
    dictationHarness.startRealtimeTranscription.mockResolvedValue(session);
    const hook = await renderDictationController({ value: "" });

    await hook.act(async () => {
      hook.result.current.toggle();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(hook.result.current.phase).toBe("recording"));
    let finishing!: Promise<boolean>;
    await hook.act(() => {
      finishing = hook.result.current.finish();
    });
    expect(release).not.toHaveBeenCalled();
    await hook.act(async () => {
      finalization.resolve(undefined);
      expect(await finishing).toBe(true);
    });
    expect(release).toHaveBeenCalledExactlyOnceWith("lease-for-this-recording");
    await hook.unmount();
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases a delayed desktop lease after the composer unmounts", async () => {
    const claim = deferred<string | null>();
    const release = vi.fn().mockResolvedValue(undefined);
    window.desktopBridge = {
      claimComposerDictationCapture: vi.fn(() => claim.promise),
      releaseComposerDictationCapture: release,
    } as unknown as DesktopBridge;
    const hook = await renderDictationController({ value: "" });

    await hook.act(() => hook.result.current.toggle());
    expect(hook.result.current.phase).toBe("starting");
    await hook.unmount();
    claim.resolve("lease-after-unmount");
    await vi.waitFor(() => expect(release).toHaveBeenCalledExactlyOnceWith("lease-after-unmount"));
    expect(dictationHarness.startRealtimeTranscription).not.toHaveBeenCalled();
  });

  it("waits for the authoritative final transcript before allowing Send", async () => {
    const finalization = deferred<void>();
    const session: RealtimeTranscriptionSession = {
      cancel: vi.fn(),
      stopAndFinalize: vi.fn(() => finalization.promise),
    };
    dictationHarness.startRealtimeTranscription.mockImplementation(
      async (input: StartRealtimeTranscriptionInput) => {
        dictationHarness.latestInput = input;
        return session;
      },
    );
    const prompt = { value: "" };
    const hook = await renderDictationController(prompt);
    const onSend = vi.fn();

    await hook.act(async () => {
      hook.result.current.toggle();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(hook.result.current.phase).toBe("recording"));
    await hook.act(() => emitTranscript("interim words"));

    let finishAndSend!: Promise<void>;
    await hook.act(() => {
      finishAndSend = hook.result.current.finish().then((ready) => {
        if (ready) onSend(prompt.value);
      });
    });
    await vi.waitFor(() => expect(hook.result.current.phase).toBe("finalizing"));
    expect(onSend).not.toHaveBeenCalled();

    await hook.act(async () => {
      emitTranscript("interim words plus final words");
      finalization.resolve(undefined);
      await finishAndSend;
    });

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith("interim words plus final words");
    expect(session.stopAndFinalize).toHaveBeenCalledOnce();
  });

  it("waits through microphone startup before finalizing and sending", async () => {
    const startup = deferred<RealtimeTranscriptionSession>();
    const finalization = deferred<void>();
    const session: RealtimeTranscriptionSession = {
      cancel: vi.fn(),
      stopAndFinalize: vi.fn(() => finalization.promise),
    };
    dictationHarness.startRealtimeTranscription.mockImplementation(
      (input: StartRealtimeTranscriptionInput) => {
        dictationHarness.latestInput = input;
        return startup.promise;
      },
    );
    const prompt = { value: "" };
    const hook = await renderDictationController(prompt);
    const onSend = vi.fn();

    await hook.act(() => hook.result.current.toggle());
    expect(hook.result.current.phase).toBe("starting");
    let finishAndSend!: Promise<void>;
    await hook.act(() => {
      finishAndSend = hook.result.current.finish().then((ready) => {
        if (ready) onSend(prompt.value);
      });
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(session.stopAndFinalize).not.toHaveBeenCalled();

    await hook.act(async () => {
      startup.resolve(session);
      await startup.promise;
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(session.stopAndFinalize).toHaveBeenCalledOnce());
    await hook.act(async () => {
      emitTranscript("final startup transcript");
      finalization.resolve(undefined);
      await finishAndSend;
    });

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith("final startup transcript");
  });

  it("does not release an interim transcript when finalization fails", async () => {
    const session: RealtimeTranscriptionSession = {
      cancel: vi.fn(),
      stopAndFinalize: vi.fn(async () => {
        throw new Error("provider finalization failed");
      }),
    };
    dictationHarness.startRealtimeTranscription.mockImplementation(
      async (input: StartRealtimeTranscriptionInput) => {
        dictationHarness.latestInput = input;
        return session;
      },
    );
    const prompt = { value: "" };
    const onError = vi.fn();
    const hook = await renderDictationController(prompt, onError);
    const onSend = vi.fn();

    await hook.act(async () => {
      hook.result.current.toggle();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(hook.result.current.phase).toBe("recording"));
    await hook.act(() => emitTranscript("unsafe interim text"));
    await hook.act(async () => {
      const ready = await hook.result.current.finish();
      if (ready) onSend(prompt.value);
    });

    expect(hook.result.current.phase).toBe("error");
    expect(onSend).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });
});
