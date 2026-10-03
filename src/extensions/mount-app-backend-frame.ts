import { getCachedAgentServerInfo } from "#/api/agent-server-compatibility";
import type { Backend } from "#/api/backend-registry/types";
import type {
  CanvasExtensionAppBackendError,
  CanvasExtensionAppBackendFrameOptions,
  CanvasExtensionDispose,
} from "#/types/canvas-extension";
import {
  acquireAppBackendSession,
  appBackendError,
  toAppBackendError,
  type AppBackendSessionLease,
  type AppBackendTarget,
} from "./app-backend-session-keeper";

const APP_BACKEND_BRIDGE_CAPABILITY = "canvas_app_backend_bridge_v1";

interface AppBackendFrameOwner {
  backend: Backend;
  extensionName: string;
}

/** The App ingress of the owning backend, or why there is none. */
function resolveTarget(
  owner: AppBackendFrameOwner,
): AppBackendTarget | CanvasExtensionAppBackendError {
  if (owner.backend.kind !== "local") {
    return appBackendError("unsupported-backend", owner.extensionName);
  }
  const info = getCachedAgentServerInfo({
    host: owner.backend.host.replace(/\/+$/, ""),
  });
  const ingressUrl = info?.app_backend_ingress_url;
  if (
    !info?.capabilities?.includes(APP_BACKEND_BRIDGE_CAPABILITY) ||
    !ingressUrl
  ) {
    return appBackendError("no-ingress", owner.extensionName);
  }
  return { ...owner, ingressUrl };
}

const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

/**
 * Show an App's own backend, served through the agent-server's App ingress,
 * in a sandboxed frame filling the container. The frame is the `<iframe>`
 * appended to the container, kept there until the returned disposer runs.
 * When it cannot be shown, a short notice is written into the container and
 * `onError` is called once.
 */
export function mountAppBackendFrame(
  owner: AppBackendFrameOwner,
  container: HTMLElement,
  options: CanvasExtensionAppBackendFrameOptions,
): CanvasExtensionDispose {
  const controller = new AbortController();
  let lease: AppBackendSessionLease | null = null;
  let frame: HTMLIFrameElement | null = null;
  let notice: HTMLElement | null = null;

  const report = (error: CanvasExtensionAppBackendError) => {
    if (controller.signal.aborted || notice) return;
    notice = document.createElement("p");
    notice.setAttribute("role", "status");
    notice.textContent = error.message;
    container.prepend(notice);
    options.onError?.(error);
  };

  const target = resolveTarget(owner);
  if ("reason" in target) {
    report(target);
  } else {
    acquireAppBackendSession(target, controller.signal).then(
      (acquired) => {
        if (controller.signal.aborted) {
          acquired.release();
          return;
        }
        lease = acquired;
        frame = document.createElement("iframe");
        frame.src = `${acquired.url}${(options.path ?? "/").replace(/^\/+/, "")}`;
        frame.setAttribute("sandbox", acquired.iframeSandbox);
        frame.setAttribute("referrerpolicy", "no-referrer");
        frame.title = options.title;
        frame.style.cssText = "display:block;width:100%;height:100%;border:0;";
        container.append(frame);
        acquired.onLost(report);
      },
      (error: unknown) => {
        if (!isAbort(error)) {
          report(toAppBackendError(error, owner.extensionName));
        }
      },
    );
  }

  return () => {
    controller.abort();
    frame?.remove();
    notice?.remove();
    lease?.release();
  };
}
