import { isSdkHttpStatusError } from "#/api/agent-server-compatibility";
import type { Backend } from "#/api/backend-registry/types";
import CanvasExtensionsService, {
  type AppBackendSession,
} from "#/api/canvas-extensions-service";
import i18n from "#/i18n";
import { I18nKey } from "#/i18n/declaration";
import { getApiErrorBody } from "#/utils/api-error-message";
import type {
  CanvasExtensionAppBackendError,
  CanvasExtensionAppBackendErrorReason,
} from "#/types/canvas-extension";

/** A session is refreshed this long before it expires. */
export const APP_BACKEND_SESSION_REFRESH_MARGIN_MS = 60_000;
/** ...but never sooner than this after it was minted. */
export const APP_BACKEND_SESSION_MIN_REFRESH_MS = 10_000;

const SERVICE_UNAVAILABLE = 503;

export interface AppBackendTarget {
  backend: Backend;
  extensionName: string;
  /** app_backend_ingress_url from the backend's /server_info. */
  ingressUrl: string;
}

export interface AppBackendSessionLease {
  /** ingress_url of the live session: {ingress}/app-backends/{name}/ */
  readonly url: string;
  /** The server's iframe_sandbox tokens. */
  readonly iframeSandbox: string;
  /** Release once; the last release of an App revokes its session. */
  release: () => void;
  /** Called if a refresh fails while the lease is held. */
  onLost: (listener: (error: CanvasExtensionAppBackendError) => void) => void;
}

type LostListener = (error: CanvasExtensionAppBackendError) => void;

interface KeptSession {
  /** Leases plus acquisitions still waiting for the session. */
  holders: number;
  minted: Promise<AppBackendSession>;
  timer: ReturnType<typeof setTimeout> | null;
  lostListeners: Set<LostListener>;
}

const REASON_MESSAGE_KEYS: Record<
  CanvasExtensionAppBackendErrorReason,
  I18nKey
> = {
  "no-ingress": I18nKey.CANVAS_EXTENSIONS$APP_BACKEND_NO_INGRESS,
  "not-ready": I18nKey.CANVAS_EXTENSIONS$APP_BACKEND_NOT_READY,
  "session-refused": I18nKey.CANVAS_EXTENSIONS$APP_BACKEND_SESSION_REFUSED,
  "unsupported-backend": I18nKey.CANVAS_EXTENSIONS$APP_BACKEND_NO_INGRESS,
};

export function appBackendError(
  reason: CanvasExtensionAppBackendErrorReason,
  extensionName: string,
): CanvasExtensionAppBackendError {
  return {
    reason,
    message: i18n.t(REASON_MESSAGE_KEYS[reason], { name: extensionName }),
  };
}

/** What a failed session request means for the App's frames. */
export function toAppBackendError(
  error: unknown,
  extensionName: string,
): CanvasExtensionAppBackendError {
  if (isSdkHttpStatusError(error, SERVICE_UNAVAILABLE)) {
    // The agent-server's error handler moves a 5xx's reason under `exception`.
    const { exception } = (getApiErrorBody(error) ?? {}) as {
      exception?: unknown;
    };
    const reason = typeof exception === "string" ? exception : "";
    if (/not ready/i.test(reason)) {
      return appBackendError("not-ready", extensionName);
    }
    if (/ingress/i.test(reason)) {
      return appBackendError("no-ingress", extensionName);
    }
  }
  return appBackendError("session-refused", extensionName);
}

// One session per (backend, App): its cookie is per App, so every frame of an
// App shares it, and revoking it for one frame would cut the others.
// @spec CX-005 — An App's backend session is revoked only when that App's last frame closes
const keptSessions = new Map<string, KeptSession>();

const sessionKey = ({ backend, extensionName }: AppBackendTarget) =>
  JSON.stringify([backend.id, extensionName]);

const mint = ({ backend, extensionName, ingressUrl }: AppBackendTarget) =>
  CanvasExtensionsService.createAppBackendSession(
    extensionName,
    backend,
    ingressUrl,
  );

function scheduleRefresh(
  target: AppBackendTarget,
  kept: KeptSession,
  session: AppBackendSession,
) {
  const delay = Math.max(
    Date.parse(session.expires_at) -
      Date.now() -
      APP_BACKEND_SESSION_REFRESH_MARGIN_MS,
    APP_BACKEND_SESSION_MIN_REFRESH_MS,
  );
  // A refreshed session's cookie replaces the old one for every frame of the
  // App; the frames keep running.
  // eslint-disable-next-line no-param-reassign
  kept.timer = setTimeout(async () => {
    const isCurrent = () => keptSessions.get(sessionKey(target)) === kept;
    try {
      const refreshed = await mint(target);
      if (isCurrent()) scheduleRefresh(target, kept, refreshed);
    } catch (error) {
      if (!isCurrent()) return;
      const lost = toAppBackendError(error, target.extensionName);
      kept.lostListeners.forEach((listener) => listener(lost));
    }
  }, delay);
}

function keepSession(target: AppBackendTarget): KeptSession {
  const key = sessionKey(target);
  const existing = keptSessions.get(key);
  if (existing) return existing;
  const kept: KeptSession = {
    holders: 0,
    minted: mint(target),
    timer: null,
    lostListeners: new Set(),
  };
  keptSessions.set(key, kept);
  kept.minted.then(
    (session) => {
      if (keptSessions.get(key) === kept)
        scheduleRefresh(target, kept, session);
    },
    () => {
      // Forget a session that was never minted, so the next frame retries.
      if (keptSessions.get(key) === kept) keptSessions.delete(key);
    },
  );
  return kept;
}

function releaseHolder(target: AppBackendTarget, kept: KeptSession) {
  // eslint-disable-next-line no-param-reassign
  kept.holders -= 1;
  if (kept.holders > 0) return;
  const key = sessionKey(target);
  if (keptSessions.get(key) === kept) keptSessions.delete(key);
  if (kept.timer) clearTimeout(kept.timer);
  kept.minted.then(
    () =>
      CanvasExtensionsService.revokeAppBackendSession(
        target.extensionName,
        target.backend,
        target.ingressUrl,
      ),
    () => undefined,
  );
}

function abortion(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const abort = () =>
      reject(new DOMException("App backend session abandoned", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

/**
 * A lease on the App's backend session, minted on the App ingress the first
 * time and refreshed before it expires while any lease is held. Aborting the
 * signal before the session exists abandons the acquisition; the session is
 * then revoked if nothing else holds it.
 */
export async function acquireAppBackendSession(
  target: AppBackendTarget,
  signal: AbortSignal,
): Promise<AppBackendSessionLease> {
  const kept = keepSession(target);
  kept.holders += 1;
  let session: AppBackendSession;
  try {
    session = await Promise.race([kept.minted, abortion(signal)]);
  } catch (error) {
    releaseHolder(target, kept);
    throw error;
  }

  let released = false;
  const listeners = new Set<LostListener>();
  return {
    url: session.ingress_url,
    iframeSandbox: session.iframe_sandbox,
    release: () => {
      if (released) return;
      released = true;
      listeners.forEach((listener) => kept.lostListeners.delete(listener));
      releaseHolder(target, kept);
    },
    onLost: (listener) => {
      listeners.add(listener);
      kept.lostListeners.add(listener);
    },
  };
}
