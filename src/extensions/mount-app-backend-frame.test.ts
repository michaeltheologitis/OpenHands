import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@openhands/typescript-client";
import { getCachedAgentServerInfo } from "#/api/agent-server-compatibility";
import type { Backend } from "#/api/backend-registry/types";
import { mountAppBackendFrame } from "./mount-app-backend-frame";

const { createSession, revokeSession } = vi.hoisted(() => ({
  createSession: vi.fn(),
  revokeSession: vi.fn(),
}));

vi.mock("@openhands/typescript-client/clients", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@openhands/typescript-client/clients")
  >()),
  CanvasExtensionsClient: class {
    createAppBackendSession = createSession;

    revokeAppBackendSession = revokeSession;
  },
}));

vi.mock("#/api/agent-server-compatibility", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#/api/agent-server-compatibility")
  >()),
  getCachedAgentServerInfo: vi.fn(),
}));

const INGRESS = "http://localhost:18000";
const SANDBOX =
  "allow-forms allow-modals allow-popups allow-same-origin allow-scripts";

const local: Backend = {
  id: "local",
  name: "Local",
  host: "http://127.0.0.1:18000",
  apiKey: "session-key",
  kind: "local",
};

const owner = { backend: local, extensionName: "library" };

// The agent-server's own error bodies: a 4xx carries the route's reason as
// `detail`; a 5xx carries "Internal Server Error" there and the reason under
// `exception`.
const httpError = (status: number, reason: string) =>
  new HttpError(
    status,
    "",
    status >= 500
      ? { detail: "Internal Server Error", exception: `${status}: ${reason}` }
      : { detail: reason },
  );

function serveBridge(ingress: string | null = INGRESS) {
  vi.mocked(getCachedAgentServerInfo).mockReturnValue({
    version: "1.50.1",
    uptime: 1,
    idle_time: 1,
    capabilities: ingress ? ["canvas_app_backend_bridge_v1"] : [],
    app_backend_ingress_url: ingress,
  });
}

function mount(onError = vi.fn(), path?: string) {
  const container = document.createElement("div");
  document.body.append(container);
  const dispose = mountAppBackendFrame(owner, container, {
    title: "Create decomposition",
    path,
    onError,
  });
  return { container, dispose, onError };
}

describe("mountAppBackendFrame", () => {
  beforeEach(() => {
    serveBridge();
    createSession.mockReset().mockResolvedValue({
      ingress_url: `${INGRESS}/app-backends/library/`,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      iframe_sandbox: SANDBOX,
    });
    revokeSession.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("appends a sandboxed frame of the App's backend to the container, at the page's path", async () => {
    const { container, dispose, onError } = mount(
      undefined,
      "/ui/create?conversation=conv%201",
    );

    await vi.waitFor(() =>
      expect(container.querySelector("iframe")).not.toBeNull(),
    );
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(
      `${INGRESS}/app-backends/library/ui/create?conversation=conv%201`,
    );
    expect(frame.getAttribute("sandbox")).toBe(SANDBOX);
    expect(frame.title).toBe("Create decomposition");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(onError).not.toHaveBeenCalled();
    dispose();
  });

  it("removes its frame and releases the session when disposed", async () => {
    const { container, dispose } = mount();
    await vi.waitFor(() =>
      expect(container.querySelector("iframe")).not.toBeNull(),
    );

    dispose();

    expect(container.childElementCount).toBe(0);
    await vi.waitFor(() =>
      expect(revokeSession).toHaveBeenCalledWith("library"),
    );
  });

  it.each([
    [
      "unsupported-backend",
      "a Cloud backend",
      () => ({ ...owner, backend: { ...local, kind: "cloud" as const } }),
    ],
    [
      "no-ingress",
      "an agent-server without an App ingress",
      () => {
        serveBridge(null);
        return owner;
      },
    ],
    [
      "not-ready",
      "a backend that is not running",
      () => {
        createSession.mockRejectedValue(
          httpError(503, "Canvas App backend is not ready"),
        );
        return owner;
      },
    ],
    [
      "no-ingress",
      "an ingress the agent-server lacks",
      () => {
        createSession.mockRejectedValue(
          httpError(503, "Canvas App backend ingress is not configured"),
        );
        return owner;
      },
    ],
    [
      "session-refused",
      "a refused session",
      () => {
        createSession.mockRejectedValue(
          httpError(
            421,
            "Canvas App request must use the configured ingress origin",
          ),
        );
        return owner;
      },
    ],
  ])(
    "reports %s once, with a notice in the container, for %s",
    async (reason, _label, arrange) => {
      const frameOwner = arrange();
      const container = document.createElement("div");
      const onError = vi.fn();

      mountAppBackendFrame(frameOwner, container, {
        title: "Library",
        onError,
      });

      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      const [{ message }] = onError.mock.calls[0];
      expect(onError).toHaveBeenCalledWith({
        reason,
        message: expect.any(String),
      });
      expect(container.querySelector("iframe")).toBeNull();
      expect(container.textContent).toBe(message);
    },
  );

  it("leaves nothing behind when disposed while the session is being minted", async () => {
    let answer: (session: unknown) => void = () => undefined;
    createSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { container, dispose, onError } = mount();

    dispose();
    answer({
      ingress_url: `${INGRESS}/app-backends/library/`,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      iframe_sandbox: SANDBOX,
    });

    await vi.waitFor(() =>
      expect(revokeSession).toHaveBeenCalledWith("library"),
    );
    expect(container.childElementCount).toBe(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps its frame in the container through session refreshes, and when one fails adds the notice beside it", async () => {
    vi.useFakeTimers();
    try {
      const { container, dispose, onError } = mount();
      await vi.waitFor(() =>
        expect(container.querySelector("iframe")).not.toBeNull(),
      );
      const frame = container.querySelector("iframe");

      await vi.advanceTimersByTimeAsync(4 * 60_000);
      expect(createSession).toHaveBeenCalledTimes(2);
      expect(container.querySelector("iframe")).toBe(frame);

      createSession.mockRejectedValue(httpError(403, "Origin is not allowed"));
      await vi.advanceTimersByTimeAsync(5 * 60_000);

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "session-refused" }),
      );
      expect(container.querySelector("iframe")).toBe(frame);
      expect(container.querySelector('[role="status"]')).not.toBeNull();
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
