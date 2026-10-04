import type {
  ACPAvailableCommand,
  ACPConfigOption,
  ACPConfigOptionValues,
  ACPSessionControls,
} from "@openhands/typescript-client";
import { localAgentServerHasCapability } from "#/api/agent-server-compatibility";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { useSetAcpConfigOption } from "#/hooks/mutation/use-set-acp-config-option";
import { useActiveConversation } from "#/hooks/query/use-active-conversation";
import { useLatestAcpSessionControls } from "#/hooks/query/use-latest-acp-session-controls";

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
      setConfigOption.mutate({ conversationId, configId, value }),
  };
}
