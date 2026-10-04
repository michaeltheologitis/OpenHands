# Canvas Extensions

## Status

Implementation plan and v1 contract. The frontend vertical slice may ship behind
Agent Server capability detection while the backend endpoints are implemented.

## Product definition

Canvas Extensions are installable packages that change Agent Canvas itself.
They contribute UI and local product behavior such as routed pages, conversation
panels, renderers, slots, and themes. Skills and plugins change the agent;
Canvas Extensions change the app.

The Customize area remains the single inventory for Skills, Plugins, MCP, and
Canvas Extensions. The inventory item is named **Extensions**; "addon" is an
informal alias only.

## Decisions

1. **The active Agent Server owns extensions.** An extension is installed on the
   computer or container running the Agent Server. Its source, resolved revision,
   files, manifest, and enabled state live there. Canvas only discovers and loads
   extensions from the currently active backend. Switching backends replaces the
   active extension set.
2. **Extension code is trusted, same-realm code.** There is no iframe, worker
   sandbox, or granular permission system. Once enabled, an extension has the
   same ambient browser authority as Canvas code. Shadow DOM may be offered later
   as optional style isolation, but never as a security boundary.
3. **Install and enable are separate.** Installation always produces a disabled
   extension. An agent may install or update an extension, but the user returns
   to Customize -> Extensions and explicitly enables it. In v1 this is a product
   consent invariant, not proof of human presence against an agent that can call
   the same authenticated APIs. A future backend policy may allow agent-driven
   enablement.
4. **Enablement is hot.** Enabling loads and activates the extension without an
   app or Agent Server restart. Disabling unmounts registered surfaces and calls
   lifecycle cleanup. Because code is trusted same-realm JavaScript, cleanup is
   best-effort; an extension can create global effects the host cannot revoke.
5. **Distribution follows plugins, not their runtime.** Install coordinates are
   `source`, optional `ref`, and optional `repo_path`, resolved and pinned by the
   Agent Server. A repository may contain multiple extensions and other artifact
   types under subpaths. Backend-local paths are interpreted on the backend
   machine, never in the frontend process.
6. **Updates preserve enablement.** Refresh resolves and installs a new revision
   atomically and keeps the prior enabled state. The UI shows the resulting
   resolved revision. Since v1 is a trusted-code model, there is no misleading
   permission-diff approval gate. The staged check/apply flow currently exists
   only at the Agent Server service layer; until it is exposed over HTTP, the
   Customize UI offers no Refresh action.

## Trust disclosure

Before enabling, Canvas says plainly that the extension can access and modify the
Canvas page and can make authenticated requests available to the current browser
session. The review screen shows source, requested ref, resolved revision,
manifest metadata, and contributed surfaces. It does not show fictitious
fine-grained permissions.

Install and update are still meaningful trust actions because they select the
code revision stored by the backend. Enable is the explicit point at which Canvas
executes that code.

## Package contract

The manifest filename is `canvas-extension.json`.

```json
{
  "schema_version": 1,
  "name": "example-dashboard",
  "display_name": "Example dashboard",
  "version": "0.1.0",
  "description": "A backend-specific project dashboard.",
  "entrypoint": "dist/extension.js",
  "contributes": {
    "pages": [
      {
        "id": "dashboard",
        "title": "Dashboard",
        "path": "/dashboard",
        "nav_label": "Dashboard"
      }
    ]
  }
}
```

Rules for v1:

- `name` and contribution IDs use lowercase letters, digits, and hyphens.
- Page `path` values are absolute kebab-case routes (leading `/`); Canvas
  mounts them relative to `/extensions/{name}`.
- `entrypoint` is a path inside the installed package.
- The entrypoint is one self-contained browser ESM bundle. It must not contain
  unresolved bare imports or external chunks; dependencies, CSS, and small
  assets are bundled or embedded by the authoring template.
- The backend validates that the manifest, entrypoint, and any future asset path
  remain inside the installed extension root.
- Host compatibility fields will be added before marketplace distribution. The
  initial schema is intentionally small while the page ABI is proven by a
  separately built sample extension.

The v1 module exports `activate`:

```ts
export function activate(host: CanvasExtensionHost): void | (() => void) {
  return host.registerPage("dashboard", ({ container, path, navigate }) => {
    container.textContent = `Extension route: ${path}`;
    return () => container.replaceChildren();
  });
}
```

`CanvasExtensionHost` is versioned independently from the manifest. The first
host API contains:

- `apiVersion: "1"`
- immutable extension/backend metadata
- `registerPage(id, mount)` for page factories declared by the manifest
- `navigate(path)` using Canvas base-path-aware routing
- `agentServer.request(...)`, an authenticated request helper targeting the
  extension's owning backend

### Conversation header panels

An App may also contribute panels to the conversation header. Each panel gets
a button after Show panel; it opens the drawer's column with the App's tabs,
and each tab is an App page:

```json
{
  "contributes": {
    "conversation_panels": [
      {
        "id": "insights",
        "title": "Insights",
        "icon": "assets/insights.svg",
        "tabs": [
          { "id": "summary", "title": "Summary", "path": "/" },
          { "id": "history", "title": "History", "path": "/history" }
        ]
      }
    ]
  }
}
```

- Panel and tab ids are contribution ids, unique across the App's pages,
  panels, and tabs. A panel has at least one tab; a tab's `path` is `/` or an
  absolute kebab-case path, unique in its panel; `icon` is an optional
  package-relative `.svg` or `.png`, fetched with the session key.
- The App registers each tab with `registerPage(<tab id>, mount)`. Registering
  a panel's own id, an undeclared id, or an id twice fails activation. An
  Agent Server without `canvas_conversation_panels_v1` in `/server_info` drops
  the key; there a tab registration is refused without failing the App, and the
  Apps page says why.
- Every mount receives `conversationId` and `surface`. A routed page gets
  `conversationId: null` and `surface: { kind: "page" }`; a panel tab gets the
  conversation's id and
  `surface: { kind: "conversation-panel", panelId, tabId, selectTab(tabId) }`,
  and `path` is the tab's path without its leading `/`.
- A tab is mounted while it is visible and disposed when another tab is
  selected, the panel closes, the conversation changes (then mounted again for
  the new one), the window crosses the narrow-window breakpoint, the App is
  disabled or re-activated, or the backend switches. Its container fills the
  panel body and scrolls.
- On a narrow window a panel is the page
  `/conversations/{id}/panel/{extension-name}/{panel-id}`.

The runtime fetches the bundle as authenticated text and imports it through a
temporary Blob URL. A direct `<script src>` or `import(backendUrl)` cannot carry
`X-Session-API-Key`, so it is not the v1 loading path. Importing the bundle does
not activate it; Canvas calls `activate` only for an enabled installation.

## Agent Server API

The API deliberately mirrors plugin distribution management while remaining a
separate runtime:

| Method   | Path                                              | Purpose                                                   |
| -------- | ------------------------------------------------- | --------------------------------------------------------- |
| `GET`    | `/api/canvas-extensions/installed`                | List installed extensions and parsed manifests            |
| `POST`   | `/api/canvas-extensions/install`                  | Install from git or a backend-local path; always disabled |
| `GET`    | `/api/canvas-extensions/installed/{name}`         | Read one installation                                     |
| `PATCH`  | `/api/canvas-extensions/installed/{name}`         | Set enabled state                                         |
| `DELETE` | `/api/canvas-extensions/installed/{name}`         | Uninstall                                                 |
| `GET`    | `/api/canvas-extensions/installed/{name}/bundle`  | Return the entrypoint as JavaScript text                  |

A refresh endpoint (`POST /api/canvas-extensions/installed/{name}/refresh`) is
planned but not part of the current router; the service-layer staged check/apply
flow backs it and is tracked separately.

The list endpoint wraps its results in a `canvas_extensions` array.

Install request:

```json
{
  "source": "github:owner/repository",
  "ref": "main",
  "repo_path": "extensions/example-dashboard",
  "force": false
}
```

Installed response:

```json
{
  "name": "example-dashboard",
  "version": "0.1.0",
  "description": "A backend-specific project dashboard.",
  "enabled": false,
  "source": "github:owner/repository",
  "resolved_ref": "6f5f9a...",
  "repo_path": "extensions/example-dashboard",
  "installed_at": "2026-08-01T12:00:00Z",
  "install_path": "/home/user/.openhands/canvas-extensions/installed/example-dashboard",
  "manifest": {}
}
```

The `manifest` field (parsed `canvas-extension.json`, including
`contributes.pages`) is not returned by the current router yet; until it ships,
Canvas treats it as optional and renders installations without page
contributions or a display name.

The backend must prevent install requests from setting `enabled: true`. The
frontend's enable control calls the patch endpoint. Backend authorization and
multi-user installation scope follow the Agent Server deployment's existing
session trust model; v1 does not introduce a separate approval credential.

Until the API exists, Canvas treats HTTP 404 as "this backend does not support
Canvas Extensions". Customize shows an upgrade message, while the global runtime
stays silent. It must not collapse unsupported, unreachable, and an empty
inventory into the same state.

## Frontend runtime

The runtime is keyed by backend ID, organization scope, and connection revision.
This prevents an enabled bundle or cached inventory from one backend appearing
on another after a switch or reconnect.

For each enabled installation:

1. Fetch the authenticated entrypoint text from the owning backend.
2. Import the self-contained ESM bundle from a Blob URL.
3. Validate `activate` and its host API version.
4. Create an extension-scoped registry and call `activate`.
5. Admit registrations only when their IDs were declared in the manifest.
6. Render each surface inside an error boundary owned by Canvas.
7. On disable, uninstall, update, or backend switch, unmount every surface,
   invoke the extension disposer, and remove its registry entries.

The initial route shape is
`/extensions/{extension-name}/{declared-page-path}`. `/extensions` itself is the
Customize inventory. All routing goes through React Router so `VITE_BASE_PATH`
continues to work.

## Delivery plan

### Slice 1: contract and management

- Land this spec and shared TypeScript manifest/installation types.
- Add a backend-keyed service and query hooks for list, install, enable/disable,
  uninstall, and authenticated bundle fetch.
- Add Customize -> Extensions with an unsupported-backend state, source install
  form, source/revision/contribution review, and explicit enable control.
- Keep the global runtime silent when the active backend returns 404.

### Slice 2: routed page proof

- Add the versioned host API, module loader, lifecycle registry, and error
  boundary.
- Add dynamic page routes and left-rail navigation for enabled page
  contributions.
- Build a standalone fixture extension with the same scaffold authors will use.
- Verify enable, hot activation, navigation, disable cleanup, update, backend
  switching, session-key-authenticated bundle loading, and `VITE_BASE_PATH`.

### Slice 3: theme proof

- Define a code-free theme contribution with a strict Canvas token schema.
- Validate theme manifests on the backend and surface installed themes in
  Settings.
- Keep theme selection browser/user scoped while availability follows the active
  backend; fall back cleanly when switching away from the providing backend.

### Slice 4: conversation surfaces

- Replace the closed conversation tab union with namespaced runtime IDs and
  centralized persistence admission.
- Add extension tabs/panels, then host-owned header/footer/badge slots.
  Delivered: conversation header panels (above), beside the drawer's tabs
  rather than among them.
- Define mobile behavior, ordering, conflicts, missing-extension fallback, and
  per-conversation lifecycle context before opening each surface to authors.

### Slice 5: visualizers and authoring loop

- Add augment/replace visualizer registrations with explicit event matching,
  precedence, and built-in fallback.
- Publish the stable extension SDK types, bundler template, validation command,
  and sample repository.
- Only then ship `/build-canvas-extension`, including backend-local versus remote
  workspace guidance, temporary install, manual enable instructions, and git
  publication/update flow.

## Verification

Each slice adds service and runtime unit tests. The routed page slice also adds a
mock-LLM end-to-end spec (`tests/e2e/mock-llm/canvas-extensions/`) that drives
the production build through install → enable → page render → disable →
uninstall. Until the pinned agent-server ships the endpoints, the spec serves
the API contract from `src/fixtures/canvas-extensions/demo-page` through
Playwright route interception; once it does, the stub is removed and the same
steps run against the real backend.
Changing the mock-LLM feature layout or mapping requires updating
`.agents/skills/e2e-testing/references/guide.md` in the same change. Before merge,
run `npm run lint`, `npm test`, `npm run build`, and `npm run build:lib`.

## Invariants

### CX-001: One right-hand panel
- [x] An App panel never shares the right side with the drawer or the overview.

### CX-002: A panel tab belongs to its conversation
- [x] A panel tab is mounted for the conversation it is shown in; changing the
  conversation remounts it.

### CX-003: Panel tab state
- [x] A panel's selected tab and pins are kept per conversation; whether a
  panel is open is session-only.

### CX-004: Declared registrations only
- [x] A registration the manifest does not declare is refused; on an Agent
  Server without conversation panels the refusal does not fail the App.

### CX-006: Stable test ids for header panels
- [x] These `data-testid`s are a contract for end-to-end tests; renaming one is
  a breaking change.

| Element | `data-testid` |
| --- | --- |
| A panel's header button (`aria-pressed` while open) | `conversation-app-panel-toggle-{extension}-{panel}` |
| The open panel (a region named after the panel) | `conversation-app-panel` |
| One tab in its row | `conversation-app-panel-tab-{tab}` |
| The ⋯ menu button, and its open and pin rows | `conversation-app-panel-menu-button`, `conversation-app-panel-menu-open-{tab}`, `conversation-app-panel-menu-pin-{tab}` |
| The mounted tab's container (`data-tab-id` names the tab) | `conversation-app-panel-content` |
| The narrow-window page, and its back button | `conversation-app-panel-page`, `conversation-app-panel-page-back` |

## Explicit non-goals for v1

- iframe/worker isolation or enforceable fine-grained permissions
- arbitrary lifecycle scripts during installation
- automatic enablement by agents
- marketplace ranking or publisher signing
- conversation tabs, slots, or visualizer replacement in the first vertical
  slice
- treating `@openhands/extensions` as an installable runtime format
