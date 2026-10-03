// Separate route module so React Router does not see duplicate ids for
// `conversations/:id` and an App panel's narrow-window page (same handlers as conversation).
export { default, ConversationView } from "./conversation";
