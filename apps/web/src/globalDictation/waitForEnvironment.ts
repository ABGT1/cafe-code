import { ensurePrimaryEnvironmentReady } from "~/environments/primary";

/**
 * The primary-environment bootstrap may wait on a local HTTP fetch that never
 * settles when a backend stalls without closing its socket. Bound the panel's
 * wait independently of that fetch, so Stop and voice-command cleanup cannot
 * be held indefinitely by an unresolved startup promise. A later bootstrap
 * completion is ignored; it cannot start a microphone after this wait ends.
 */
export async function waitForDictationEnvironmentReady(
  signal: AbortSignal,
  timeoutMs: number,
  ready: () => Promise<unknown> = ensurePrimaryEnvironmentReady,
): Promise<void> {
  if (signal.aborted) throw new Error("dictation_startup_cancelled");

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("dictation_startup_timeout")), timeoutMs);
    onAbort = () => reject(new Error("dictation_startup_cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    await Promise.race([ready(), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}
