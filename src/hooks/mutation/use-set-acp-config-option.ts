import { useMutation } from "@tanstack/react-query";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";

export interface SetAcpConfigOptionVariables {
  conversationId: string;
  configId: string;
  value: string | boolean;
}

/**
 * Sets a live ACP session's config option. On success nothing else is done:
 * the agent-server publishes the next `ACPSessionControlsEvent`, which
 * replaces the controls. Failures are the caller's to show (in the agent's
 * own words), so the global error toast stays out of it.
 */
export function useSetAcpConfigOption() {
  return useMutation({
    mutationFn: ({
      conversationId,
      configId,
      value,
    }: SetAcpConfigOptionVariables) =>
      AgentServerConversationService.setAcpConfigOption(
        conversationId,
        configId,
        value,
      ),
    meta: { disableToast: true },
  });
}
