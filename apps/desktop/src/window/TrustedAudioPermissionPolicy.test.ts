import { assert, describe, it } from "@effect/vitest";
import type * as Electron from "electron";
import { vi } from "vitest";

import { trustAudioWebContents, untrustAudioWebContents } from "./TrustedAudioPermissionPolicy.ts";

function makeSession() {
  const setPermissionCheckHandler = vi.fn();
  const setPermissionRequestHandler = vi.fn();
  const session = {
    setPermissionCheckHandler,
    setPermissionRequestHandler,
  } as unknown as Electron.Session;
  return { session, setPermissionCheckHandler, setPermissionRequestHandler };
}

function makeWebContents(session: Electron.Session) {
  let onDestroyed: (() => void) | undefined;
  const webContents = {
    session,
    isDestroyed: vi.fn(() => false),
    once: vi.fn((event: string, listener: () => void) => {
      if (event === "destroyed") onDestroyed = listener;
    }),
  } as unknown as Electron.WebContents;
  return { webContents, destroy: () => onDestroyed?.() };
}

describe("TrustedAudioPermissionPolicy", () => {
  it("keeps the main composer and global panel trusted in their shared Electron session", () => {
    const { session, setPermissionCheckHandler, setPermissionRequestHandler } = makeSession();
    const main = makeWebContents(session);
    const panel = makeWebContents(session);
    const untrusted = makeWebContents(session);
    const origin = new URL("http://127.0.0.1:3773/");

    trustAudioWebContents(main.webContents, origin);
    trustAudioWebContents(
      panel.webContents,
      new URL("http://127.0.0.1:3773/?cafeDictationOverlay=1"),
    );

    // Electron permission callbacks live on Session. Registering the panel
    // must not overwrite the handler that already serves the composer.
    assert.equal(setPermissionCheckHandler.mock.calls.length, 1);
    assert.equal(setPermissionRequestHandler.mock.calls.length, 1);
    const check = setPermissionCheckHandler.mock.calls[0]?.[0] as NonNullable<
      Parameters<Electron.Session["setPermissionCheckHandler"]>[0]
    >;
    const request = setPermissionRequestHandler.mock.calls[0]?.[0] as NonNullable<
      Parameters<Electron.Session["setPermissionRequestHandler"]>[0]
    >;
    const details = {
      isMainFrame: true,
      mediaType: "audio",
      securityOrigin: origin.origin,
      requestingUrl: `${origin.origin}/`,
    } satisfies Electron.PermissionCheckHandlerHandlerDetails;

    assert.isTrue(check(main.webContents, "media", origin.origin, details));
    assert.isTrue(check(panel.webContents, "media", origin.origin, details));
    assert.isFalse(check(untrusted.webContents, "media", origin.origin, details));
    assert.isFalse(
      check(panel.webContents, "media", origin.origin, { ...details, mediaType: "video" }),
    );
    assert.isFalse(
      check(panel.webContents, "media", origin.origin, { ...details, isMainFrame: false }),
    );
    assert.isFalse(check(panel.webContents, "media", "https://other.example", details));

    const result = vi.fn();
    request(panel.webContents, "media", result, {
      isMainFrame: true,
      requestingUrl: `${origin.origin}/`,
      securityOrigin: origin.origin,
      mediaTypes: ["audio"],
    });
    assert.deepEqual(result.mock.calls, [[true]]);

    result.mockClear();
    request(panel.webContents, "media", result, {
      isMainFrame: true,
      requestingUrl: `${origin.origin}/`,
      securityOrigin: origin.origin,
      mediaTypes: ["audio", "video"],
    });
    assert.deepEqual(result.mock.calls, [[false]]);

    untrustAudioWebContents(panel.webContents);
    assert.isFalse(check(panel.webContents, "media", origin.origin, details));
    assert.isTrue(check(main.webContents, "media", origin.origin, details));
    main.destroy();
    assert.isFalse(check(main.webContents, "media", origin.origin, details));
  });
});
