// Mount and dispose counts, read by tests to check the panel lifecycle.
const lifecycle = (globalThis.__demoPanelMounts ??= {
  mounted: 0,
  disposed: 0,
});

function mountTab({ container, path, conversationId, surface }) {
  lifecycle.mounted += 1;
  const context = document.createElement("p");
  context.dataset.testid = "demo-panel-context";
  context.textContent = `conversation=${conversationId} path=${path} tab=${surface.tabId}`;

  const selectDetails = document.createElement("button");
  selectDetails.type = "button";
  selectDetails.dataset.testid = "demo-panel-select-details";
  selectDetails.textContent = "Select details";
  selectDetails.addEventListener("click", () => surface.selectTab("details"));

  container.append(context, selectDetails);
  return () => {
    lifecycle.disposed += 1;
    context.remove();
    selectDetails.remove();
  };
}

export function activate(host) {
  const disposers = [
    host.registerPage("overview", mountTab),
    host.registerPage("details", mountTab),
  ];
  return () => disposers.forEach((dispose) => dispose());
}
