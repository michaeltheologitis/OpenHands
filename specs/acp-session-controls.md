# ACP Session Controls Specs

An ACP agent may offer slash commands and session config options (S2's
`ACPSessionControlsEvent`). On a local backend whose agent-server advertises
`acp_session_controls_v1`, Canvas lists the agent's commands in the slash menu
and shows its options, except the model, as pickers above the message input. On
the home screen both come from `POST /api/acp/preview`, which is sent the body a
start would send, and the values the user picked go with the new conversation
as `acp_config_options`; in a conversation they come from the newest
`ACPSessionControlsEvent`, and a pick is set live through
`POST /api/conversations/{id}/acp/config-options`.

---

### ASC-001: The slash menu lists the agent's current commands
- [x] The slash menu lists exactly the commands of the agent's newest report,
  after the built-in commands and before skills; a new report replaces the last.
  A command that repeats an earlier item is not listed.

### ASC-002: A conversation starts with values the preview accepted
- [x] The option values a conversation starts with are values the home screen's
  most recent successful preview accepted: only options it reported, and for a
  select only values it listed. A value the agent refused is never sent. A
  refused pick is withdrawn: the picker shows the agent's value again, and
  picking the refused value again asks the agent again.

### ASC-003: The model option belongs to the model picker
- [x] The option picker never offers the `model` option; the model picker owns
  it.

### ASC-004: Only where the agent-server supports them
- [x] Agent commands and options appear only on a local backend whose
  agent-server advertises `acp_session_controls_v1`, for an ACP agent; elsewhere
  the composer is unchanged. A preview the agent-server cannot answer (400, 429,
  501, 502, 504) shows no commands and no picker, and the user can still start.

### ASC-005: Stable test ids for agent controls
- [x] These `data-testid`s are a contract for end-to-end tests; renaming one is
  a breaking change.

| Element | `data-testid` |
| --- | --- |
| The slash menu | `slash-command-menu` |
| One slash menu item (`data-command` holds its command, e.g. `/compare`) | `slash-command-item` |
| An agent command's input hint in its item | `slash-command-hint` |
| The option picker row | `agent-options` |
| One option's pill (`data-value` holds the value shown; `data-fixed` when it cannot change) | `agent-option-{option id}` |
| One value in an option's menu | `agent-option-{option id}-value-{value}` |
| The agent's sentence for a value it refused | `agent-option-rejection` |
