import { useMutation } from "@tanstack/react-query";
import { isSdkHttpStatusError } from "#/api/agent-server-compatibility";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import { getApiErrorMessage } from "#/utils/api-error-message";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { retrieveAxiosErrorMessage } from "#/utils/retrieve-axios-error-message";

export interface SetAcpConfigOptionVariables {
  conversationId: string;
  configId: string;
  value: string | boolean;
}

const AGENT_REFUSAL_STATUS = 422;

/**
 * Sets a live ACP session's config option. On success nothing else is done:
 * the agent-server publishes the next `ACPSessionControlsEvent`, which
 * replaces the controls. A refusal (422) toasts the agent's own sentence, and
 * any other failure what the model picker's failures say. The toast belongs
 * to the mutation rather than to `mutate`, whose callbacks React Query drops
 * once the picker unmounts, which it may well do before the agent answers.
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
    onError: (error) =>
      displayErrorToast(
        isSdkHttpStatusError(error, AGENT_REFUSAL_STATUS)
          ? getApiErrorMessage(error, error.message)
          : retrieveAxiosErrorMessage(error),
      ),
  });
}
