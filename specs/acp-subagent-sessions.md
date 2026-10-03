# ACP Sub-agent Sessions Specs

ACP agents that run sub-agents (ACP schema 1.24.1's unstable sub-agent sessions, stored by the
Agent Server as `ACPSubagentEvent`, `ACPSessionMessageEvent`, `ACPSessionTextEvent` and
`ACPToolCallEvent.acp_session_id`) show each sub-agent nested in the chat.

---

### SUB-001: Nested under the spawning call
- [x] Each ACP sub-agent session shall render inside the tool call that spawned it, recursively.

### SUB-002: Placed without a spawning call
- [x] A sub-agent without a loaded spawning call shall render at its parent's message to it, else at its announcement, once the conversation's history is complete.

### SUB-003: Unplaceable sub-agents apart
- [x] A sub-agent whose parent session is not in the conversation shall be shown apart, never in the root's flow.

### SUB-004: The root's flow is the root's
- [x] The root's flow shall show only the root session's work.

### SUB-005: Latest state, never a stale spinner
- [x] Each sub-agent shall show its latest state; an unconfirmed state shall never show a spinner.

### SUB-006: Latest cost, never added
- [x] Each sub-agent shall show its latest reported cost; costs shall never be added.

### SUB-007: Stop only when granted
- [x] Stop shall be offered only for a running sub-agent that granted cancel on the live connection; success shall be shown only when the agent reports it.

### SUB-008: History a fan-out needs
- [x] Opening a conversation shall load the older history its visible sub-agents need, and no more.

### SUB-009: Agents without sub-agent sessions
- [x] Agents without sub-agent sessions shall render as before.

### SUB-010: Responsive under load
- [x] 50 sub-agents × 5 tool calls arriving at 60 events per second shall leave the chat responsive to scrolling within 1 s, with every sub-agent expanded.

### SUB-011: Stable test ids
- [x] These test ids and data attributes are stable; renaming one is a breaking change for the end-to-end tests that use them:
  - `acp-tool-call` (root or child call): `data-acp-tool-call-id`; `data-acp-session-id` (absent for the root); `data-acp-tool-call-status`: `pending`, `in_progress`, `completed`, `failed`.
  - `subagent-block` (the sub-agents of one call): `data-subagent-count`; its toggle `subagent-block-toggle` with `aria-expanded`.
  - `subagent-row` (one sub-agent): `data-acp-session-id`; `data-subagent-status`: `running`, `waiting`, `done`, `stopped`, `limited`, `refused`, `unconfirmed`, `other`; `data-subagent-stale` when the state is the last known one; its toggle `subagent-row-toggle` with `aria-expanded`.
  - Within a row: `subagent-title`, `subagent-status`, `subagent-answer`, `subagent-tool-calls`, `subagent-cost`; `subagent-stop` with `data-subagent-stop`: `ready`, `stopping` or `withheld` (`aria-disabled` in the last two).
  - `subagent-transcript` (an expanded row's transcript) and `subagent-task` (the task at its top).
  - `subagent-unplaced` (sub-agents whose parent session is missing): `data-missing-parent-session-id`.
  - `subagent-loading-earlier` ("Loading earlier sub-agent activity…").
