export const CONVERSATION_APP_PANEL_ROUTE =
  "/conversations/:conversationId/panel/:extensionName/:panelId";

/** The narrow-window page of one App panel in a conversation. */
export function buildConversationAppPanelPath(
  conversationId: string,
  extensionName: string,
  panelId: string,
): string {
  return `/conversations/${encodeURIComponent(conversationId)}/panel/${encodeURIComponent(extensionName)}/${encodeURIComponent(panelId)}`;
}
