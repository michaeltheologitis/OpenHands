import { useQuery } from "@tanstack/react-query";
import CanvasExtensionsService from "#/api/canvas-extensions-service";
import type { RegisteredCanvasExtensionPanel } from "#/components/features/canvas-extensions/canvas-extensions-runtime";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { CANVAS_EXTENSIONS_QUERY_KEYS } from "#/hooks/query/query-keys";
import { convertImageToBase64 } from "#/utils/convert-image-to-base-64";

/**
 * A data: URL for the panel's icon, or null (no icon, loading, or any
 * failure). The icon needs the session key, so it is fetched as a Blob rather
 * than referenced by URL; an SVG shown through <img> runs no script.
 */
export function useCanvasExtensionPanelIcon(
  panel: RegisteredCanvasExtensionPanel,
): string | null {
  const { backend, orgId } = useActiveBackend();
  const { extension, contribution } = panel;
  // The key names the backend by id; the queryFn needs the whole object.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const { data } = useQuery({
    queryKey: CANVAS_EXTENSIONS_QUERY_KEYS.panelIcon(
      backend.id,
      orgId,
      extension.name,
      extension.resolved_ref ?? null,
      contribution.id,
    ),
    queryFn: async () =>
      convertImageToBase64(
        await CanvasExtensionsService.fetchPanelIcon(
          extension.name,
          contribution.id,
          backend,
        ),
      ),
    enabled: Boolean(contribution.icon),
    retry: false,
    staleTime: Infinity,
    meta: { disableToast: true },
  });
  return data ?? null;
}
