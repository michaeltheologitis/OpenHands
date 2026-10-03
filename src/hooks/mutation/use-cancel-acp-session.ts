import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CancelAcpSessionResponse } from "@openhands/typescript-client";
import EventService from "#/api/event-service/event-service.api";
import { isSdkHttpError } from "#/api/agent-server-compatibility";
import { I18nKey } from "#/i18n/declaration";
import { displayErrorToast } from "#/utils/custom-toast-handlers";

export interface CancelAcpSessionVariables {
  conversationId: string;
  conversationUrl: string | null;
  sessionApiKey: string | null;
  sessionId: string;
}

const FIRST_SERVER_ERROR_STATUS = 500;
const STATUS_PREFIX = /^\d{3}: /;

/**
 * The agent-server's reason for refusing: a 4xx's `detail`; for a 5xx, its
 * error handler sets `detail` to "Internal Server Error" and moves the reason
 * under `exception` as "<status>: <reason>".
 */
function refusalReason(error: unknown): string | null {
  if (!isSdkHttpError(error)) return null;
  const { status, response } = error as { status: number; response?: unknown };
  if (typeof response !== "object" || response === null) return null;
  const body = response as Record<string, unknown>;
  const reason =
    status >= FIRST_SERVER_ERROR_STATUS ? body.exception : body.detail;
  return typeof reason === "string" && reason
    ? reason.replace(STATUS_PREFIX, "")
    : null;
}

/**
 * Cancel one ACP sub-agent session. Success means only that the request was
 * sent: the row shows "Stopping…" until the child's own idle/cancelled
 * snapshot arrives. A refusal shows the server's reason in an error toast.
 */
export function useCancelAcpSession() {
  const { t } = useTranslation("openhands");
  return useMutation<
    CancelAcpSessionResponse,
    Error,
    CancelAcpSessionVariables
  >({
    mutationFn: ({
      conversationId,
      conversationUrl,
      sessionApiKey,
      sessionId,
    }) =>
      EventService.cancelAcpSession(
        conversationId,
        sessionId,
        conversationUrl,
        sessionApiKey,
      ),
    onError: (error) => {
      displayErrorToast(
        refusalReason(error) ?? t(I18nKey.SUBAGENTS$STOP_FAILED),
      );
    },
    meta: { disableToast: true },
  });
}
