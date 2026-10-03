import React from "react";
import { useNavigate } from "react-router";
import { localAgentServerHasCapability } from "#/api/agent-server-compatibility";
import CanvasExtensionsService from "#/api/canvas-extensions-service";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { loadCanvasExtensionModule } from "#/extensions/canvas-extension-module-loader";
import { mountAppBackendFrame } from "#/extensions/mount-app-backend-frame";
import { useCanvasExtensions } from "#/hooks/query/use-canvas-extensions";
import {
  CANVAS_EXTENSION_HOST_API_VERSION,
  type CanvasExtensionDispose,
  type CanvasExtensionHost,
  type CanvasExtensionConversationPanelContribution,
  type CanvasExtensionModule,
  type CanvasExtensionPageContribution,
  type CanvasExtensionPageMount,
  type CanvasExtensionPanelTabContribution,
  type InstalledCanvasExtensionInfo,
} from "#/types/canvas-extension";
import { I18nKey } from "#/i18n/declaration";
import {
  toConversationAppPanelKey,
  type ConversationAppPanelKey,
} from "#/stores/conversation-store";

export interface RegisteredCanvasExtensionPage {
  extension: InstalledCanvasExtensionInfo;
  contribution: CanvasExtensionPageContribution;
  mount: CanvasExtensionPageMount;
  href: string;
}

export interface RegisteredCanvasExtensionPanelTab {
  extension: InstalledCanvasExtensionInfo;
  panel: CanvasExtensionConversationPanelContribution;
  /** The tab, its path without the leading "/" ("" for "/"). */
  contribution: CanvasExtensionPanelTabContribution;
  mount: CanvasExtensionPageMount;
}

export interface RegisteredCanvasExtensionPanel {
  key: ConversationAppPanelKey;
  extension: InstalledCanvasExtensionInfo;
  contribution: CanvasExtensionConversationPanelContribution;
  /** Registered tabs in manifest order; never empty. */
  tabs: RegisteredCanvasExtensionPanelTab[];
}

interface CanvasExtensionsRuntimeValue {
  pages: RegisteredCanvasExtensionPage[];
  panels: RegisteredCanvasExtensionPanel[];
  activating: boolean;
  errors: ReadonlyMap<string, string>;
  /** Per App: a condition that is not an activation failure, as an i18n key. */
  notices: ReadonlyMap<string, string>;
}

const EMPTY_RUNTIME: CanvasExtensionsRuntimeValue = {
  pages: [],
  panels: [],
  activating: false,
  errors: new Map(),
  notices: new Map(),
};

const CanvasExtensionsRuntimeContext =
  React.createContext<CanvasExtensionsRuntimeValue>(EMPTY_RUNTIME);

export function useCanvasExtensionsRuntime(): CanvasExtensionsRuntimeValue {
  return React.useContext(CanvasExtensionsRuntimeContext);
}

/** The registered panel with this key, or null. */
export function useRegisteredAppPanel(
  key: ConversationAppPanelKey | null,
): RegisteredCanvasExtensionPanel | null {
  const { panels } = useCanvasExtensionsRuntime();
  return key ? (panels.find((panel) => panel.key === key) ?? null) : null;
}

function isValidSegment(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function buildCanvasExtensionPageHref(
  extensionName: string,
  contributionPath: string,
): string {
  return `/extensions/${encodeURIComponent(extensionName)}/${contributionPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function normalizeContributionPath(path: string): string {
  // The backend declares paths as absolute routes (e.g. "/dashboard");
  // normalize to the relative form used for hrefs and mount contexts.
  return path.replace(/^\/+/, "");
}

function isValidContributionPath(normalizedPath: string): boolean {
  return normalizedPath.split("/").every(isValidSegment);
}

type DeclaredContribution =
  | { kind: "page"; contribution: CanvasExtensionPageContribution }
  | {
      kind: "panel-tab";
      panel: CanvasExtensionConversationPanelContribution;
      tab: CanvasExtensionPanelTabContribution;
    }
  | { kind: "panels-unsupported" };

function resolveDeclaredPage(
  extension: InstalledCanvasExtensionInfo,
  contribution: CanvasExtensionPageContribution,
): DeclaredContribution {
  const normalizedPath = normalizeContributionPath(contribution.path);
  if (
    !isValidSegment(extension.name) ||
    !isValidSegment(contribution.id) ||
    !isValidContributionPath(normalizedPath)
  ) {
    throw new Error(
      `Extension ${extension.name} has an invalid page name, id, or path.`,
    );
  }
  return {
    kind: "page",
    contribution: { ...contribution, path: normalizedPath },
  };
}

function resolveDeclaredPanelTab(
  extension: InstalledCanvasExtensionInfo,
  panel: CanvasExtensionConversationPanelContribution,
  tab: CanvasExtensionPanelTabContribution,
): DeclaredContribution {
  // Re-validated as pages are, against a server that validated less.
  const normalizedPath = normalizeContributionPath(tab.path);
  if (
    !isValidSegment(extension.name) ||
    !isValidSegment(panel.id) ||
    !isValidSegment(tab.id) ||
    !tab.path.startsWith("/") ||
    (normalizedPath !== "" && !isValidContributionPath(normalizedPath))
  ) {
    throw new Error(
      `Extension ${extension.name} has an invalid panel id, tab id, or tab path.`,
    );
  }
  return { kind: "panel-tab", panel, tab: { ...tab, path: normalizedPath } };
}

/** Throws for a panel id, a malformed declaration or an undeclared id on a server that serves panels. */
// @spec CX-004 — A registration the manifest does not declare is refused
function resolveDeclaredContribution(
  extension: InstalledCanvasExtensionInfo,
  contributionId: string,
): DeclaredContribution {
  const contributes = extension.manifest?.contributes;
  const page = contributes?.pages?.find(({ id }) => id === contributionId);
  if (page) return resolveDeclaredPage(extension, page);

  const panels = contributes?.conversation_panels ?? [];
  for (const panel of panels) {
    const tab = panel.tabs.find(({ id }) => id === contributionId);
    if (tab) return resolveDeclaredPanelTab(extension, panel, tab);
  }
  if (panels.some(({ id }) => id === contributionId)) {
    throw new Error(
      `Extension ${extension.name} registered panel "${contributionId}"; register its tabs instead.`,
    );
  }
  // An agent-server without panels drops the manifest key, so an App's tab
  // ids look undeclared there; refusing them must not fail the App.
  if (!localAgentServerHasCapability("canvas_conversation_panels_v1")) {
    return { kind: "panels-unsupported" };
  }
  throw new Error(
    `Extension ${extension.name} registered undeclared page "${contributionId}".`,
  );
}

function toRegisteredPanels(
  extensions: InstalledCanvasExtensionInfo[],
  tabs: RegisteredCanvasExtensionPanelTab[],
): RegisteredCanvasExtensionPanel[] {
  return extensions.flatMap((extension) =>
    (extension.manifest?.contributes?.conversation_panels ?? []).flatMap(
      (panel) => {
        const panelTabs = panel.tabs.flatMap(
          (declared) =>
            tabs.find(
              (tab) =>
                tab.extension.name === extension.name &&
                tab.panel.id === panel.id &&
                tab.contribution.id === declared.id,
            ) ?? [],
        );
        if (panelTabs.length === 0) return [];
        return [
          {
            key: toConversationAppPanelKey(extension.name, panel.id),
            extension,
            contribution: panel,
            tabs: panelTabs,
          },
        ];
      },
    ),
  );
}

type CanvasExtensionModuleLoader = (
  source: string,
) => Promise<CanvasExtensionModule>;

interface CanvasExtensionsRuntimeProviderProps {
  children: React.ReactNode;
  /** Test seam for environments that cannot import browser Blob URLs. */
  moduleLoader?: CanvasExtensionModuleLoader;
}

export function CanvasExtensionsRuntimeProvider({
  children,
  moduleLoader = loadCanvasExtensionModule,
}: CanvasExtensionsRuntimeProviderProps) {
  const active = useActiveBackend();
  const navigate = useNavigate();
  const query = useCanvasExtensions();
  const [pages, setPages] = React.useState<RegisteredCanvasExtensionPage[]>([]);
  const [panelTabs, setPanelTabs] = React.useState<
    RegisteredCanvasExtensionPanelTab[]
  >([]);
  const [errors, setErrors] = React.useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [notices, setNotices] = React.useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [activating, setActivating] = React.useState(false);

  const enabledExtensions = React.useMemo(
    () => (query.data ?? []).filter((extension) => extension.enabled),
    [query.data],
  );

  // `useActiveBackend` can synthesize a fresh `backend` object on every render
  // (e.g. when mounted without an <ActiveBackendProvider>), and refetches
  // produce new extension arrays with identical content. The activation effect
  // therefore keys on this value signature — backend identity plus the enabled
  // inventory, whose `installedAt` catches a same-version refresh — and reads
  // the current objects from refs, so referential churn never tears down and
  // re-activates extensions.
  const activationSignature = React.useMemo(
    () =>
      JSON.stringify({
        backendId: active.backend.id,
        backendKind: active.backend.kind,
        connectionRevision: active.backend.connectionRevision ?? 0,
        orgId: active.orgId,
        extensions: enabledExtensions.map((extension) => ({
          name: extension.name,
          version: extension.version,
          resolvedRef: extension.resolved_ref ?? null,
          installedAt: extension.installed_at,
          pages: extension.manifest?.contributes?.pages ?? [],
          conversationPanels:
            extension.manifest?.contributes?.conversation_panels ?? [],
        })),
      }),
    [
      active.backend.id,
      active.backend.kind,
      active.backend.connectionRevision,
      active.orgId,
      enabledExtensions,
    ],
  );
  const activeRef = React.useRef(active);
  activeRef.current = active;
  const enabledExtensionsRef = React.useRef(enabledExtensions);
  enabledExtensionsRef.current = enabledExtensions;

  React.useEffect(() => {
    let cancelled = false;
    const disposers: CanvasExtensionDispose[] = [];
    const { backend, orgId } = activeRef.current;
    const extensionsToActivate = enabledExtensionsRef.current;
    setPages([]);
    setPanelTabs([]);
    setErrors(new Map());
    setNotices(new Map());
    setActivating(extensionsToActivate.length > 0);

    const activateExtension = async (
      extension: InstalledCanvasExtensionInfo,
    ) => {
      const registeredPages = new Map<string, RegisteredCanvasExtensionPage>();
      const registeredTabs = new Map<
        string,
        RegisteredCanvasExtensionPanelTab
      >();
      let notice: string | null = null;
      const registrationDisposers: CanvasExtensionDispose[] = [];
      try {
        const source = await CanvasExtensionsService.fetchBundle(
          extension.name,
          backend,
        );
        if (cancelled) return;
        const extensionModule = await moduleLoader(source);
        if (cancelled) return;

        const host: CanvasExtensionHost = {
          apiVersion: CANVAS_EXTENSION_HOST_API_VERSION,
          extension: Object.freeze({
            name: extension.name,
            version: extension.version,
            resolvedRef: extension.resolved_ref ?? null,
          }),
          backend: Object.freeze({
            id: backend.id,
            kind: backend.kind,
            orgId,
          }),
          registerPage: (contributionId, mount) => {
            if (
              registeredPages.has(contributionId) ||
              registeredTabs.has(contributionId)
            ) {
              throw new Error(
                `Extension ${extension.name} registered page "${contributionId}" more than once.`,
              );
            }
            const declared = resolveDeclaredContribution(
              extension,
              contributionId,
            );
            if (declared.kind === "panels-unsupported") {
              notice = I18nKey.SETTINGS$APPS_PANELS_UNSUPPORTED;
              return () => undefined;
            }
            if (declared.kind === "panel-tab") {
              registeredTabs.set(contributionId, {
                extension,
                panel: declared.panel,
                contribution: declared.tab,
                mount,
              });
              const unregister = () => registeredTabs.delete(contributionId);
              registrationDisposers.push(unregister);
              return unregister;
            }
            const { contribution } = declared;
            const page: RegisteredCanvasExtensionPage = {
              extension,
              contribution,
              mount,
              href: buildCanvasExtensionPageHref(
                extension.name,
                contribution.path,
              ),
            };
            registeredPages.set(contributionId, page);
            const unregister = () => registeredPages.delete(contributionId);
            registrationDisposers.push(unregister);
            return unregister;
          },
          navigate: (path) => navigate(path),
          agentServer: {
            request: (request) =>
              CanvasExtensionsService.requestAgentServer(request, backend),
          },
          appBackend: {
            mountFrame: (container, options) =>
              mountAppBackendFrame(
                { backend, extensionName: extension.name },
                container,
                options,
              ),
          },
        };

        const disposeActivation = await extensionModule.activate(host);
        if (cancelled) {
          if (typeof disposeActivation === "function") disposeActivation();
          return;
        }
        if (typeof disposeActivation === "function") {
          disposers.push(disposeActivation);
        }
        disposers.push(...registrationDisposers);
        setPages((current) => [
          ...current.filter((page) => page.extension.name !== extension.name),
          ...registeredPages.values(),
        ]);
        setPanelTabs((current) => [
          ...current.filter((tab) => tab.extension.name !== extension.name),
          ...registeredTabs.values(),
        ]);
        const extensionNotice = notice;
        if (extensionNotice) {
          setNotices((current) =>
            new Map(current).set(extension.name, extensionNotice),
          );
        }
      } catch (error) {
        registrationDisposers.forEach((dispose) => dispose());
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : "Extension activation failed.";
        setErrors((current) => {
          const next = new Map(current);
          next.set(extension.name, message);
          return next;
        });
      }
    };

    void Promise.all(extensionsToActivate.map(activateExtension)).finally(
      () => {
        if (!cancelled) setActivating(false);
      },
    );

    return () => {
      cancelled = true;
      setPages([]);
      setPanelTabs([]);
      for (const dispose of disposers.reverse()) {
        try {
          dispose();
        } catch (error) {
          console.error("Canvas Extension cleanup failed", error);
        }
      }
    };
  }, [activationSignature, moduleLoader, navigate]);

  // Ordered by installed App, then manifest panel and tab order, whatever
  // order the Apps activated or registered in.
  const panels = React.useMemo(
    () => toRegisteredPanels(enabledExtensions, panelTabs),
    [enabledExtensions, panelTabs],
  );

  const value = React.useMemo(
    () => ({ pages, panels, activating, errors, notices }),
    [pages, panels, activating, errors, notices],
  );

  return (
    <CanvasExtensionsRuntimeContext.Provider value={value}>
      {children}
    </CanvasExtensionsRuntimeContext.Provider>
  );
}
