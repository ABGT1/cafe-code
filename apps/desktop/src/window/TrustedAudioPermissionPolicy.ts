import type * as Electron from "electron";

/**
 * Electron permission handlers belong to a Session, not to a BrowserWindow.
 * Installing the global-dictation panel's handler over the main window's
 * handler would silently revoke the composer microphone (and vice versa).
 * This registry installs one deny-by-default policy per Session and admits
 * only explicitly registered, still-live, top-level Cafe webContents at the
 * exact origin from which each was loaded.
 */
const trustedBySession = new WeakMap<Electron.Session, Map<Electron.WebContents, string>>();

function matchesOrigin(candidate: string | undefined, trustedOrigin: string): boolean {
  if (!candidate) return false;
  try {
    return new URL(candidate).origin === trustedOrigin;
  } catch {
    return false;
  }
}

function trustedOriginFor(
  session: Electron.Session,
  webContents: Electron.WebContents | null,
): string | null {
  if (!webContents) return null;
  // An unknown requester is denied before any method call on it. Apart from
  // keeping the policy fail-closed, this matters when Chromium hands us a
  // nonstandard/destroying requester during a permission race.
  const trustedOrigin = trustedBySession.get(session)?.get(webContents);
  if (!trustedOrigin || webContents.isDestroyed()) return null;
  return trustedOrigin;
}

function checkAudioPermission(
  session: Electron.Session,
  requestingWebContents: Electron.WebContents | null,
  permission: string,
  requestingOrigin: string,
  details: Electron.PermissionCheckHandlerHandlerDetails,
): boolean {
  const trustedOrigin = trustedOriginFor(session, requestingWebContents);
  return (
    trustedOrigin !== null &&
    permission === "media" &&
    details.isMainFrame &&
    details.mediaType === "audio" &&
    matchesOrigin(requestingOrigin, trustedOrigin) &&
    (details.securityOrigin === undefined ||
      matchesOrigin(details.securityOrigin, trustedOrigin)) &&
    (details.requestingUrl === undefined || matchesOrigin(details.requestingUrl, trustedOrigin))
  );
}

function requestAudioPermission(
  session: Electron.Session,
  requestingWebContents: Electron.WebContents,
  permission: string,
  details: Electron.PermissionRequest,
): boolean {
  const trustedOrigin = trustedOriginFor(session, requestingWebContents);
  const mediaDetails = details as Electron.MediaAccessPermissionRequest;
  return (
    trustedOrigin !== null &&
    permission === "media" &&
    details.isMainFrame &&
    mediaDetails.mediaTypes?.length === 1 &&
    mediaDetails.mediaTypes[0] === "audio" &&
    matchesOrigin(details.requestingUrl, trustedOrigin) &&
    (mediaDetails.securityOrigin === undefined ||
      matchesOrigin(mediaDetails.securityOrigin, trustedOrigin))
  );
}

export function trustAudioWebContents(webContents: Electron.WebContents, trustedUrl: URL): void {
  const session = webContents.session;
  let trusted = trustedBySession.get(session);
  if (!trusted) {
    trusted = new Map();
    trustedBySession.set(session, trusted);

    // The current request and check handlers must stay paired. A missing
    // handler can make Chromium apply a broader default policy.
    session.setPermissionCheckHandler((requester, permission, origin, details) =>
      checkAudioPermission(session, requester, permission, origin, details),
    );
    session.setPermissionRequestHandler((requester, permission, callback, details) => {
      callback(requestAudioPermission(session, requester, permission, details));
    });
  }

  trusted.set(webContents, trustedUrl.origin);
  webContents.once("destroyed", () => {
    trusted.delete(webContents);
  });
}

export function untrustAudioWebContents(webContents: Electron.WebContents): void {
  trustedBySession.get(webContents.session)?.delete(webContents);
}
