import React from "react";
import type {
  CanvasExtensionPageMount,
  CanvasExtensionPageMountContext,
} from "#/types/canvas-extension";

export interface CanvasExtensionMountState {
  /** The mount's own error, if it threw or rejected. */
  error: string | null;
}

/**
 * Mount `mount` into the container while `mountKey` is unchanged; dispose and
 * remount when it or `mount` changes. `context` is read through a ref, so only
 * `mount` and `mountKey` decide remounting.
 */
export function useCanvasExtensionMount(
  containerRef: React.RefObject<HTMLDivElement | null>,
  mount: CanvasExtensionPageMount | null,
  context: Omit<CanvasExtensionPageMountContext, "container"> | null,
  mountKey: string,
): CanvasExtensionMountState {
  const [error, setError] = React.useState<string | null>(null);
  const contextRef = React.useRef(context);
  contextRef.current = context;

  React.useEffect(() => {
    const container = containerRef.current;
    const mountContext = contextRef.current;
    if (!container || !mount || !mountContext) return undefined;
    let disposed = false;
    let disposeMount: (() => void) | undefined;
    setError(null);
    container.replaceChildren();

    Promise.resolve()
      .then(() => mount({ ...mountContext, container }))
      .then((dispose) => {
        if (typeof dispose !== "function") return;
        if (disposed) dispose();
        else disposeMount = dispose;
      })
      .catch((mountError: unknown) => {
        if (!disposed) {
          setError(
            mountError instanceof Error
              ? mountError.message
              : "Extension page failed.",
          );
        }
      });

    return () => {
      disposed = true;
      try {
        disposeMount?.();
      } catch (cleanupError) {
        console.error("Canvas Extension page cleanup failed", cleanupError);
      }
      container.replaceChildren();
    };
  }, [containerRef, mount, mountKey]);

  return { error };
}
