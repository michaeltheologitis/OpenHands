import React from "react";
import type {
  ACPAvailableCommand,
  ACPConfigOption,
  ACPConfigOptionValues,
  ACPSessionControls,
} from "@openhands/typescript-client";
import {
  getSdkHttpErrorDetail,
  isSdkHttpStatusError,
  localAgentServerHasCapability,
} from "#/api/agent-server-compatibility";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { useSetAcpConfigOption } from "#/hooks/mutation/use-set-acp-config-option";
import { useActiveConversation } from "#/hooks/query/use-active-conversation";
import { useAgentProfiles } from "#/hooks/query/use-agent-profiles";
import {
  resolveAcpLaunchProfile,
  useAcpSessionPreview,
  type AcpSessionPreview,
  type HomeLaunchContext,
} from "#/hooks/query/use-acp-session-preview";
import { useLatestAcpSessionControls } from "#/hooks/query/use-latest-acp-session-controls";
import { useAcpModelContext } from "#/hooks/use-acp-model-context";
import { useHomeAgentOptionsStore } from "#/stores/home-agent-options-store";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { retrieveAxiosErrorMessage } from "#/utils/retrieve-axios-error-message";

export type { HomeLaunchContext };

export interface AgentControls {
  /** The agent's slash commands now; replaced on every report. */
  commands: ACPAvailableCommand[];
  /** Options the picker shows: never "model", never booleans. */
  options: ACPConfigOption[];
  /** Value shown per option id while a change is in flight. */
  pendingValues: ACPConfigOptionValues;
  /** The agent's own sentence for the last refused value, if any. */
  rejection: string | null;
  /** True until the first controls arrive. */
  isLoading: boolean;
  setOption: (configId: string, value: string | boolean) => void;
}

export interface HomeAgentControls extends AgentControls {
  /** Values to send as acp_config_options: those the last successful preview accepted. */
  startValues: ACPConfigOptionValues;
}

const NO_VALUES: ACPConfigOptionValues = {};

export const NO_AGENT_CONTROLS: HomeAgentControls = {
  commands: [],
  options: [],
  pendingValues: NO_VALUES,
  rejection: null,
  isLoading: false,
  setOption: () => undefined,
  startValues: NO_VALUES,
};

const LOADING_AGENT_CONTROLS: HomeAgentControls = {
  ...NO_AGENT_CONTROLS,
  isLoading: true,
};

const AGENT_REFUSAL_STATUS = 422;

// @spec ASC-003 — The model option belongs to the model picker
// Boolean options are left out until the bridge advertises boolean support.
function pickerOptions(controls: ACPSessionControls): ACPConfigOption[] {
  return controls.config_options.filter(
    (option) => option.id !== "model" && option.type === "select",
  );
}

function hasAgentControls(isAcp: boolean, isLocal: boolean): boolean {
  return (
    isAcp && isLocal && localAgentServerHasCapability("acp_session_controls_v1")
  );
}

// @spec ASC-002 — A conversation starts with values the preview accepted
function acceptedValues(preview: AcpSessionPreview): ACPConfigOptionValues {
  return Object.fromEntries(
    Object.entries(preview.values).filter(([id, value]) => {
      const option = preview.controls.config_options.find(
        (candidate) => candidate.id === id,
      );
      if (!option) return false;
      return (
        option.type !== "select" ||
        option.options.some((choice) => choice.value === value)
      );
    }),
  );
}

/** Values the user picked that the shown options do not have yet. */
function changedValues(
  values: ACPConfigOptionValues,
  options: ACPConfigOption[],
): ACPConfigOptionValues {
  return Object.fromEntries(
    Object.entries(values).filter(
      ([id, value]) =>
        options.find((option) => option.id === id)?.current_value !== value,
    ),
  );
}

/**
 * The agent controls of a conversation: its newest `ACPSessionControlsEvent`,
 * and a pick set live. Only for an ACP conversation on a local agent-server
 * with `acp_session_controls_v1`; otherwise none.
 */
// @spec ASC-004 — Only where the agent-server supports them
export function useConversationAgentControls(
  conversationId: string | null,
): AgentControls {
  const { backend } = useActiveBackend();
  const { data: conversation } = useActiveConversation();
  const enabled =
    !!conversationId &&
    hasAgentControls(
      conversation?.agent_kind === "acp",
      backend.kind === "local",
    );
  const event = useLatestAcpSessionControls(conversationId, enabled);
  const setConfigOption = useSetAcpConfigOption();

  if (!enabled || !conversationId) return NO_AGENT_CONTROLS;
  const pending = setConfigOption.isPending ? setConfigOption.variables : null;
  return {
    commands: event?.available_commands ?? [],
    options: event ? pickerOptions(event) : [],
    pendingValues: pending ? { [pending.configId]: pending.value } : NO_VALUES,
    rejection: null,
    isLoading: !event,
    setOption: (configId, value) =>
      setConfigOption.mutate(
        { conversationId, configId, value },
        {
          onError: (error) =>
            displayErrorToast(
              getSdkHttpErrorDetail(error) ?? retrieveAxiosErrorMessage(error),
            ),
        },
      ),
  };
}

/**
 * The agent controls of the next conversation, from the agent-server's
 * preview of the launch agent with the values the user picked. Only when the
 * home screen's agent is ACP on a local agent-server with
 * `acp_session_controls_v1`; otherwise none.
 */
// @spec ASC-004 — Only where the agent-server supports them
export function useHomeAgentControls(
  launchContext: HomeLaunchContext,
): HomeAgentControls {
  const { backend, orgId } = useActiveBackend();
  const { isHomeAcp } = useAcpModelContext();
  const enabled = hasAgentControls(isHomeAcp, backend.kind === "local");
  const { data: profiles } = useAgentProfiles({ enabled });
  const launch =
    enabled && profiles
      ? resolveAcpLaunchProfile(profiles, backend.id, orgId)
      : null;
  const stored = useHomeAgentOptionsStore();
  const values =
    stored.launchKey === launch?.launchKey ? stored.values : NO_VALUES;
  const preview = useAcpSessionPreview(launch, launchContext, values);

  // The last preview the agent answered for this launch agent; a refusal
  // keeps showing it, and its values are the ones a start may send.
  const lastAnswered = React.useRef<{
    launchKey: string;
    preview: AcpSessionPreview;
  } | null>(null);
  if (launch && preview.data && !preview.isPlaceholderData) {
    lastAnswered.current = {
      launchKey: launch.launchKey,
      preview: preview.data,
    };
  }
  const answered =
    launch && lastAnswered.current?.launchKey === launch.launchKey
      ? lastAnswered.current.preview
      : null;

  if (!launch) return enabled ? LOADING_AGENT_CONTROLS : NO_AGENT_CONTROLS;
  const isRefusal =
    preview.isError &&
    isSdkHttpStatusError(preview.error, AGENT_REFUSAL_STATUS);
  // Any other failure (400, 429, 501, 502, 504, …) shows no controls; the
  // user can still start.
  const shown = preview.isError && !isRefusal ? null : answered;
  const options = shown ? pickerOptions(shown.controls) : [];
  return {
    commands: shown?.controls.available_commands ?? [],
    options,
    pendingValues: preview.isFetching
      ? changedValues(values, options)
      : NO_VALUES,
    rejection: isRefusal
      ? (getSdkHttpErrorDetail(preview.error) ?? preview.error.message)
      : null,
    isLoading: preview.isLoading,
    setOption: (configId, value) =>
      stored.setValue(launch.launchKey, configId, value),
    startValues: shown ? acceptedValues(shown) : NO_VALUES,
  };
}
