export const CANVAS_EXTENSION_MANIFEST_SCHEMA_VERSION = 1 as const;
export const CANVAS_EXTENSION_HOST_API_VERSION = "1" as const;

export interface CanvasExtensionPageContribution {
  id: string;
  title: string;
  path: string;
  nav_label?: string | null;
  description?: string | null;
}

export interface CanvasExtensionPanelTabContribution {
  /** Contribution id; the id the App registers this tab's page under. */
  id: string;
  /** Label in the panel's tab row. */
  title: string;
  /** "/" or an absolute kebab-case path; where the tab's page starts. */
  path: string;
}

export interface CanvasExtensionConversationPanelContribution {
  /** Contribution id of the panel. */
  id: string;
  /** Tooltip "Show <title>" and the panel's accessible name. */
  title: string;
  /** Package-relative .svg or .png for the header button. */
  icon?: string | null;
  /** The panel's tabs, in tab-row order; never empty. */
  tabs: CanvasExtensionPanelTabContribution[];
}

export interface CanvasExtensionContributions {
  pages?: CanvasExtensionPageContribution[] | null;
  conversation_panels?: CanvasExtensionConversationPanelContribution[] | null;
}

/** Parsed contents of `canvas-extension.json`. */
export interface CanvasExtensionManifest {
  schema_version: typeof CANVAS_EXTENSION_MANIFEST_SCHEMA_VERSION;
  name: string;
  display_name?: string | null;
  version: string;
  description?: string | null;
  entrypoint: string;
  contributes?: CanvasExtensionContributions | null;
}

export interface InstalledCanvasExtensionInfo {
  name: string;
  version: string;
  description?: string | null;
  enabled: boolean;
  source: string;
  requested_ref?: string | null;
  resolved_ref?: string | null;
  repo_path?: string | null;
  installed_at: string;
  install_path: string;
  /** Absent until the backend exposes page contributions (OSS-10048). */
  manifest?: CanvasExtensionManifest | null;
}

export interface InstallCanvasExtensionRequest {
  source: string;
  ref?: string | null;
  repo_path?: string | null;
  force?: boolean;
}

export type CanvasExtensionDispose = () => void;

export interface CanvasExtensionPageSurface {
  kind: "page";
}

export interface CanvasExtensionConversationPanelSurface {
  kind: "conversation-panel";
  /** The panel's contribution id. */
  panelId: string;
  /** The tab's contribution id. */
  tabId: string;
  /** Select another tab of this panel, as a click on it would. */
  selectTab: (tabId: string) => void;
}

export type CanvasExtensionMountSurface =
  | CanvasExtensionPageSurface
  | CanvasExtensionConversationPanelSurface;

export interface CanvasExtensionPageMountContext {
  container: HTMLElement;
  /** Remainder of the route below the page's path, or the tab's path without its leading "/". */
  path: string;
  navigate: (path: string) => void;
  /** The conversation a panel is shown for; null on a routed page. */
  conversationId: string | null;
  /** Where the page is mounted. */
  surface: CanvasExtensionMountSurface;
}

export type CanvasExtensionPageMount = (
  context: CanvasExtensionPageMountContext,
) => void | CanvasExtensionDispose | Promise<void | CanvasExtensionDispose>;

export interface CanvasExtensionAgentServerRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export type CanvasExtensionAppBackendErrorReason =
  | "no-ingress"
  | "not-ready"
  | "session-refused"
  | "unsupported-backend";

export interface CanvasExtensionAppBackendError {
  reason: CanvasExtensionAppBackendErrorReason;
  /** Localized sentence, the one the host shows in the container. */
  message: string;
}

export interface CanvasExtensionAppBackendFrameOptions {
  /** Path on the App's backend below its ingress root; "/" by default; may carry a query string. */
  path?: string;
  /** Accessible name of the frame. */
  title: string;
  /** Called once if the frame cannot be shown. */
  onError?: (error: CanvasExtensionAppBackendError) => void;
}

export interface CanvasExtensionAppBackendHost {
  /**
   * Show the App's own backend in a sandboxed frame filling the container.
   * The frame is the `<iframe>` appended to the container, kept there (also
   * across session refreshes) until the returned disposer runs.
   */
  mountFrame: (
    container: HTMLElement,
    options: CanvasExtensionAppBackendFrameOptions,
  ) => CanvasExtensionDispose;
}

export interface CanvasExtensionHost {
  readonly apiVersion: typeof CANVAS_EXTENSION_HOST_API_VERSION;
  readonly extension: Readonly<{
    name: string;
    version: string;
    resolvedRef: string | null;
  }>;
  readonly backend: Readonly<{
    id: string;
    kind: "local" | "cloud";
    orgId: string | null;
  }>;
  registerPage: (
    contributionId: string,
    mount: CanvasExtensionPageMount,
  ) => CanvasExtensionDispose;
  navigate: (path: string) => void;
  /** Requests to the owning agent-server's API; each may take up to 60 s. */
  agentServer: {
    request: <T = unknown>(
      request: CanvasExtensionAgentServerRequest,
    ) => Promise<T>;
  };
  /** The App's own backend, through the agent-server's App ingress. */
  readonly appBackend: CanvasExtensionAppBackendHost;
}

export interface CanvasExtensionModule {
  activate: (
    host: CanvasExtensionHost,
  ) => void | CanvasExtensionDispose | Promise<void | CanvasExtensionDispose>;
}
