import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Backend } from "#/api/backend-registry/types";
import {
  APP_BACKEND_SESSION_MIN_REFRESH_MS,
  APP_BACKEND_SESSION_REFRESH_MARGIN_MS,
  acquireAppBackendSession,
  type AppBackendTarget,
} from "./app-backend-session-keeper";

const { createSession, revokeSession, clientOptions } = vi.hoisted(() => ({
  createSession: vi.fn(),
  revokeSession: vi.fn(),
  clientOptions: vi.fn(),
}));

vi.mock("@openhands/typescript-client/clients", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@openhands/typescript-client/clients")
  >()),
  CanvasExtensionsClient: class {
    constructor(options: unknown) {
      clientOptions(options);
    }

    createAppBackendSession = createSession;

    revokeAppBackendSession = revokeSession;
  },
}));

const backend: Backend = {
  id: "local",
  name: "Local",
  host: "http://127.0.0.1:18000",
  apiKey: "session-key",
  kind: "local",
};

const INGRESS = "http://localhost:18000";
const FIVE_MINUTES = 5 * 60 * 1000;

function target(extensionName = "library"): AppBackendTarget {
  return { backend, extensionName, ingressUrl: INGRESS };
}

function sessionFor(extensionName: string, lifetimeMs = FIVE_MINUTES) {
  return {
    ingress_url: `${INGRESS}/app-backends/${extensionName}/`,
    expires_at: new Date(Date.now() + lifetimeMs).toISOString(),
    iframe_sandbox: "allow-forms allow-scripts allow-same-origin",
  };
}

const live = () => new AbortController().signal;

describe("acquireAppBackendSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createSession.mockReset();
    revokeSession.mockReset().mockResolvedValue(undefined);
    clientOptions.mockReset();
    createSession.mockImplementation(async (name: string) => sessionFor(name));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mints one session per App on its ingress with the session key, shared by every lease", async () => {
    const first = await acquireAppBackendSession(target(), live());
    const second = await acquireAppBackendSession(target(), live());

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(clientOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        host: backend.host,
        apiKey: backend.apiKey,
        appBackendIngressUrl: INGRESS,
      }),
    );
    expect(first.url).toBe(`${INGRESS}/app-backends/library/`);
    expect(second.url).toBe(first.url);
    expect(first.iframeSandbox).toBe(
      "allow-forms allow-scripts allow-same-origin",
    );
    first.release();
    second.release();
  });

  // @spec CX-005 — An App's backend session is revoked only when that App's last frame closes
  it("revokes the session at the last release and not before", async () => {
    const first = await acquireAppBackendSession(target(), live());
    const second = await acquireAppBackendSession(target(), live());

    first.release();
    first.release();
    await vi.runOnlyPendingTimersAsync();
    expect(revokeSession).not.toHaveBeenCalled();

    second.release();
    await vi.waitFor(() =>
      expect(revokeSession).toHaveBeenCalledWith("library"),
    );
  });

  it("refreshes the session a minute before it expires, and stops after the last release", async () => {
    const lease = await acquireAppBackendSession(target(), live());

    await vi.advanceTimersByTimeAsync(
      FIVE_MINUTES - APP_BACKEND_SESSION_REFRESH_MARGIN_MS - 1,
    );
    expect(createSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(createSession).toHaveBeenCalledTimes(2);

    lease.release();
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES);
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it("never refreshes sooner than its floor, however short the session", async () => {
    createSession.mockImplementation(async (name: string) =>
      sessionFor(name, 30_000),
    );
    const lease = await acquireAppBackendSession(target(), live());

    await vi.advanceTimersByTimeAsync(APP_BACKEND_SESSION_MIN_REFRESH_MS - 1);
    expect(createSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(createSession).toHaveBeenCalledTimes(2);
    lease.release();
  });

  it("tells every live lease of the App when a refresh fails", async () => {
    const first = await acquireAppBackendSession(target(), live());
    const second = await acquireAppBackendSession(target(), live());
    const firstLost = vi.fn();
    const secondLost = vi.fn();
    first.onLost(firstLost);
    second.onLost(secondLost);
    createSession.mockRejectedValue(
      Object.assign(new Error("HTTP 403"), { name: "HttpError", status: 403 }),
    );

    await vi.advanceTimersByTimeAsync(FIVE_MINUTES);

    for (const lost of [firstLost, secondLost]) {
      expect(lost).toHaveBeenCalledTimes(1);
      expect(lost).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "session-refused" }),
      );
    }
    first.release();
    second.release();
  });

  it("keeps Apps apart: each has its own session", async () => {
    const library = await acquireAppBackendSession(target("library"), live());
    const notes = await acquireAppBackendSession(target("notes"), live());

    library.release();
    await vi.waitFor(() =>
      expect(revokeSession).toHaveBeenCalledWith("library"),
    );
    expect(revokeSession).not.toHaveBeenCalledWith("notes");
    expect(notes.url).toBe(`${INGRESS}/app-backends/notes/`);
    notes.release();
  });

  it("leaves nothing behind when the acquisition is abandoned before the session exists", async () => {
    let answer: (session: unknown) => void = () => undefined;
    createSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const controller = new AbortController();
    const acquired = acquireAppBackendSession(target(), controller.signal);

    controller.abort();
    await expect(acquired).rejects.toThrow();
    answer(sessionFor("library"));

    await vi.waitFor(() =>
      expect(revokeSession).toHaveBeenCalledWith("library"),
    );
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES);
    expect(createSession).toHaveBeenCalledTimes(1);
  });
});
