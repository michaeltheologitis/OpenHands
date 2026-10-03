# Demo panel Canvas Extension

This fixture is a standalone, dependency-free App with one conversation header
panel (`demo`) of two tabs, `overview` and `details`, registered with one mount
function. Each mount writes `conversation=<id> path=<path> tab=<tab id>` into its
container with a button that selects the `details` tab through
`surface.selectTab`, and counts mounts and disposes in
`globalThis.__demoPanelMounts`, so tests read the lifecycle from the page.

The unit tests import `extension.js` directly; the mock-LLM end-to-end spec
installs this directory by absolute path on an agent-server that serves
conversation panels (`canvas_conversation_panels_v1`).
