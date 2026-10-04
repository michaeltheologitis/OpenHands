import React from "react";
import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  ACPConfigOptionValues,
  ACPSessionControls,
  AgentKind,
} from "@openhands/typescript-client";
import type { AgentProfileListResponse } from "#/api/agent-profiles-service/agent-profiles-service.api";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import type { WorkspaceMode } from "#/api/conversation-metadata-store";
import { ACP_SESSION_CONTROLS_QUERY_KEYS } from "#/hooks/query/query-keys";

const AGENT_SETTINGS_LAUNCH = "agent-settings";

export interface AcpLaunchProfile {
  /** `${backendId}:${orgId}:${profile id or "agent-settings"}`. */
  launchKey: string;
  agentProfileId?: string;
  agentProfileKind?: AgentKind;
}

export interface HomeLaunchContext {
  /** The pending workspace's path; undefined for none or an isolated backend. */
  workingDir: string | undefined;
  workspaceMode: WorkspaceMode;
}

export interface AcpSessionPreview {
  controls: ACPSessionControls;
  /** The values this preview was asked with, which the agent accepted. */
  values: ACPConfigOptionValues;
}

/**
 * The ACP agent a home-screen start would launch: the active agent profile,
 * else `agent_settings`. For an ACP agent this is all of
 * `useCreateConversation`'s resolution; its fallbacks to `agent_settings` are
 * scoped to OpenHands profiles.
 */
export function resolveAcpLaunchProfile(
  profiles: AgentProfileListResponse,
  backendId: string,
  orgId: string | null,
): AcpLaunchProfile {
  const activeId = profiles.active_agent_profile_id ?? undefined;
  if (!activeId) {
    return { launchKey: `${backendId}:${orgId}:${AGENT_SETTINGS_LAUNCH}` };
  }
  return {
    launchKey: `${backendId}:${orgId}:${activeId}`,
    agentProfileId: activeId,
    agentProfileKind: profiles.profiles.find(({ id }) => id === activeId)
      ?.agent_kind,
  };
}

/**
 * What the launch agent would offer, asked with the values the user picked.
 * Each preview starts the agent once, so it runs only when the inputs (all
 * discrete user actions) change to ones the agent has not answered since this
 * hook mounted, never on focus, and is not retried. A remount asks again.
 */
export function useAcpSessionPreview(
  launch: AcpLaunchProfile | null,
  context: HomeLaunchContext,
  values: ACPConfigOptionValues,
): UseQueryResult<AcpSessionPreview, Error> {
  // A start sends a workspace mode only with a workspace.
  const workspaceMode = context.workingDir ? context.workspaceMode : undefined;
  const [mountedAt] = React.useState(Date.now);
  // The launch key names the profile; its kind follows from it.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  return useQuery({
    queryKey: ACP_SESSION_CONTROLS_QUERY_KEYS.preview(
      launch?.launchKey ?? "",
      context.workingDir ?? null,
      workspaceMode ?? null,
      values,
    ),
    queryFn: async () => ({
      controls: await AgentServerConversationService.previewAcpSession({
        workingDirOverride: context.workingDir,
        workspaceMode,
        agentProfileId: launch?.agentProfileId,
        agentProfileKind: launch?.agentProfileKind,
        acpConfigOptions: values,
      }),
      values,
    }),
    enabled: launch !== null,
    staleTime: (query) =>
      query.state.dataUpdatedAt >= mountedAt ? Infinity : 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    retry: false,
    placeholderData: keepPreviousData,
    meta: { disableToast: true },
  });
}
