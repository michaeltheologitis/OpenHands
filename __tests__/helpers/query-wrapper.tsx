import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";

/**
 * A wrapper giving React Query, with a client of its own that does not
 * retry, and the active backend. Every render through one wrapper shares its
 * cache, as a screen that unmounts and mounts again shares the app's.
 */
export function createQueryWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ActiveBackendProvider>{children}</ActiveBackendProvider>
      </QueryClientProvider>
    );
  };
}
