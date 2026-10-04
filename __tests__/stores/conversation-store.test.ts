import { beforeEach, describe, expect, it, vi } from "vitest";

let useConversationStore: (typeof import("#/stores/conversation-store"))["useConversationStore"];

const defaultConversationState: {
  selectedTab: "files";
  unpinnedTabs: string[];
  conversationMode: "code" | "plan";
} = {
  selectedTab: "files" as const,
  unpinnedTabs: [] as string[],
  conversationMode: "code" as const,
};

const mockGetConversationState = vi.fn(
  (_id: string) => defaultConversationState,
);
const mockSetConversationState = vi.fn();

vi.mock("#/utils/conversation-local-storage", () => ({
  getConversationState: (id: string) => mockGetConversationState(id),
  setConversationState: (id: string, updates: object) =>
    mockSetConversationState(id, updates),
}));

const CONV_ID = "conv-test-1";

describe("conversation store", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetConversationState.mockReturnValue(defaultConversationState);
    Object.defineProperty(window, "location", {
      value: { pathname: `/conversations/${CONV_ID}` },
      writable: true,
    });
    vi.resetModules();
    ({ useConversationStore } = await import("#/stores/conversation-store"));
  });

  it("starts with the complete transient state reset", () => {
    expect(useConversationStore.getState()).toMatchObject({
      isRightPanelShown: false,
      selectedTab: "files",
      images: [],
      files: [],
      imagesMarkedUploadAsFile: [],
      pastedImageNames: [],
      loadingFiles: [],
      loadingImages: [],
      messageToSend: null,
      messageRestoreIfEmpty: null,
      shouldShownAgentLoading: false,
      submittedMessage: null,
      shouldHideSuggestions: false,
      hasRightPanelToggled: false,
      planContent: null,
      conversationMode: "code",
      subConversationTaskId: null,
    });
  });

  describe("setConversationMode", () => {
    it("updates store state and persists via setConversationState when conversation ID is in location", () => {
      useConversationStore.getState().setConversationMode("plan");

      expect(useConversationStore.getState().conversationMode).toBe("plan");
      expect(mockSetConversationState).toHaveBeenCalledWith(CONV_ID, {
        conversationMode: "plan",
      });
    });
  });

  describe("imagesMarkedUploadAsFile", () => {
    it("toggles per-image upload-as-file marks by file name", () => {
      expect(useConversationStore.getState().imagesMarkedUploadAsFile).toEqual(
        [],
      );

      useConversationStore.getState().toggleImageUploadAsFile("paste.png");
      expect(useConversationStore.getState().imagesMarkedUploadAsFile).toEqual([
        "paste.png",
      ]);

      useConversationStore.getState().toggleImageUploadAsFile("paste.png");
      expect(useConversationStore.getState().imagesMarkedUploadAsFile).toEqual(
        [],
      );
    });

    it("clears marks when an image is removed", () => {
      const image = new File(["x"], "paste.png", { type: "image/png" });
      useConversationStore.getState().addImages([image]);
      useConversationStore.getState().toggleImageUploadAsFile("paste.png");
      useConversationStore.getState().removeImage(0);

      expect(useConversationStore.getState().imagesMarkedUploadAsFile).toEqual(
        [],
      );
    });

    it("is reset by clearAllFiles", () => {
      useConversationStore.getState().toggleImageUploadAsFile("paste.png");
      useConversationStore.getState().clearAllFiles();
      expect(useConversationStore.getState().imagesMarkedUploadAsFile).toEqual(
        [],
      );
    });
  });

  describe("pastedImageNames", () => {
    it("tracks attached image names for the upload-as-file control", () => {
      useConversationStore.getState().markImagesAsPasted(["shot.png"]);
      expect(useConversationStore.getState().pastedImageNames).toEqual([
        "shot.png",
      ]);
    });

    it("clears pasted names when the image is removed", () => {
      const image = new File(["x"], "shot.png", { type: "image/png" });
      useConversationStore.getState().addImages([image]);
      useConversationStore.getState().markImagesAsPasted(["shot.png"]);
      useConversationStore.getState().removeImage(0);
      expect(useConversationStore.getState().pastedImageNames).toEqual([]);
    });
  });

  describe("resetConversationState", () => {
    it("sets conversationMode from getConversationState", () => {
      useConversationStore.setState({ conversationMode: "plan" });
      mockGetConversationState.mockReturnValue({
        selectedTab: "files",
        unpinnedTabs: [],
        conversationMode: "code",
      });

      useConversationStore.getState().resetConversationState();

      expect(useConversationStore.getState().conversationMode).toBe("code");
      expect(mockGetConversationState).toHaveBeenCalledWith(CONV_ID);
    });
  });

  it("updates the panel, tab, loading, and suggestion flags", () => {
    const store = useConversationStore.getState();
    store.setIsRightPanelShown(true);
    store.setSelectedTab("terminal");
    store.setShouldShownAgentLoading(true);
    store.setShouldHideSuggestions(true);
    store.setHasRightPanelToggled(true);

    expect(useConversationStore.getState()).toMatchObject({
      isRightPanelShown: true,
      selectedTab: "terminal",
      shouldShownAgentLoading: true,
      shouldHideSuggestions: true,
      hasRightPanelToggled: true,
    });
  });

  // @spec CX-001 — An App panel never shares the right side with the drawer or the overview
  describe("App header panels", () => {
    type Store = ReturnType<typeof useConversationStore.getState>;
    type Step = [label: string, act: (store: Store) => void];
    const openPanelA: Step = ["open panel A", (s) => s.openAppPanel("demo/a")];
    const openPanelB: Step = ["open panel B", (s) => s.openAppPanel("demo/b")];
    const openDrawer: Step = [
      "open drawer",
      (s) => {
        s.setHasRightPanelToggled(true);
        s.setIsRightPanelShown(true);
      },
    ];
    const closeDrawer: Step = [
      "close drawer",
      (s) => s.setIsRightPanelShown(false),
    ];
    const openOverview: Step = [
      "open overview",
      (s) => s.setIsOverviewPanelShown(true),
    ];
    const closePanel: Step = ["close panel", (s) => s.closeAppPanel()];

    it.each([
      {
        steps: [openPanelA, openDrawer],
        expected: { activeAppPanel: null, isRightPanelShown: true },
      },
      {
        steps: [openDrawer, openPanelA],
        expected: { activeAppPanel: "demo/a", isRightPanelShown: false },
      },
      {
        steps: [openOverview, openPanelA],
        expected: { activeAppPanel: "demo/a", isOverviewPanelShown: false },
      },
      {
        steps: [openPanelA, openOverview],
        expected: { activeAppPanel: null, isOverviewPanelShown: true },
      },
      {
        steps: [openPanelA, openPanelB],
        expected: { activeAppPanel: "demo/b", isRightPanelShown: false },
      },
      {
        steps: [openPanelA, closeDrawer],
        expected: { activeAppPanel: "demo/a", isRightPanelShown: false },
      },
      {
        steps: [openDrawer, openPanelA, closePanel],
        expected: {
          activeAppPanel: null,
          isRightPanelShown: false,
          isOverviewPanelShown: false,
        },
      },
    ])(
      "keeps one right-hand panel after $steps.0.0 then $steps.1.0",
      ({ steps, expected }) => {
        for (const [label, act] of steps) {
          act(useConversationStore.getState());
          const state = useConversationStore.getState();
          const sharesTheRightSide =
            state.activeAppPanel !== null &&
            (state.isRightPanelShown || state.isOverviewPanelShown);
          expect(sharesTheRightSide, `after ${label}`).toBe(false);
        }
        expect(useConversationStore.getState()).toMatchObject(expected);
      },
    );

    it("opening a panel clears the drawer's toggled flag so the composer does not reopen it", () => {
      openDrawer[1](useConversationStore.getState());

      useConversationStore.getState().openAppPanel("demo/a");

      expect(useConversationStore.getState()).toMatchObject({
        hasRightPanelToggled: false,
        isOverviewPanelPeeked: false,
      });
    });

    it("starts with no App panel open", () => {
      expect(useConversationStore.getState().activeAppPanel).toBeNull();
    });
  });

  it("appends and removes files and images while preserving unrelated entries", () => {
    const firstImage = new File(["a"], "first.png", { type: "image/png" });
    const secondImage = new File(["b"], "second.png", { type: "image/png" });
    const firstFile = new File(["a"], "first.txt");
    const secondFile = new File(["b"], "second.txt");
    const store = useConversationStore.getState();

    store.addImages([firstImage]);
    store.addImages([secondImage]);
    store.addFiles([firstFile]);
    store.addFiles([secondFile]);
    store.markImagesAsPasted(["first.png", "first.png", "second.png"]);
    store.toggleImageUploadAsFile("first.png");
    store.toggleImageUploadAsFile("second.png");
    store.removeImage(99);
    expect(useConversationStore.getState()).toMatchObject({
      images: [firstImage, secondImage],
      imagesMarkedUploadAsFile: ["first.png", "second.png"],
      pastedImageNames: ["first.png", "second.png"],
    });

    store.removeImage(0);
    store.removeFile(0);
    expect(useConversationStore.getState()).toMatchObject({
      images: [secondImage],
      files: [secondFile],
      imagesMarkedUploadAsFile: ["second.png"],
      pastedImageNames: ["second.png"],
    });

    store.removeFile(99);
    expect(useConversationStore.getState().files).toEqual([secondFile]);
    store.clearImages();
    store.clearFiles();
    expect(useConversationStore.getState()).toMatchObject({
      images: [],
      files: [],
    });
  });

  it("deduplicates and removes file and image loading indicators", () => {
    const store = useConversationStore.getState();
    store.addFileLoading("one.txt");
    store.addFileLoading("one.txt");
    store.addFileLoading("two.txt");
    store.addImageLoading("one.png");
    store.addImageLoading("one.png");
    store.addImageLoading("two.png");

    expect(useConversationStore.getState()).toMatchObject({
      loadingFiles: ["one.txt", "two.txt"],
      loadingImages: ["one.png", "two.png"],
    });

    store.removeFileLoading("one.txt");
    store.removeImageLoading("one.png");
    expect(useConversationStore.getState()).toMatchObject({
      loadingFiles: ["two.txt"],
      loadingImages: ["two.png"],
    });

    store.clearAllLoading();
    expect(useConversationStore.getState()).toMatchObject({
      loadingFiles: [],
      loadingImages: [],
    });
  });

  it("clears every attachment and loading collection together", () => {
    const image = new File(["a"], "one.png", { type: "image/png" });
    const file = new File(["a"], "one.txt");
    const store = useConversationStore.getState();
    store.addImages([image]);
    store.addFiles([file]);
    store.toggleImageUploadAsFile("one.png");
    store.markImagesAsPasted(["one.png"]);
    store.addFileLoading("one.txt");
    store.addImageLoading("one.png");

    store.clearAllFiles();

    expect(useConversationStore.getState()).toMatchObject({
      images: [],
      files: [],
      imagesMarkedUploadAsFile: [],
      pastedImageNames: [],
      loadingFiles: [],
      loadingImages: [],
    });
  });

  it("creates and consumes timestamped send and restore requests", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(200);
    const store = useConversationStore.getState();
    store.setMessageToSend("send me");
    store.restoreMessageToInputIfEmpty("restore me");
    expect(useConversationStore.getState()).toMatchObject({
      messageToSend: { text: "send me", timestamp: 100 },
      messageRestoreIfEmpty: { text: "restore me", timestamp: 200 },
    });

    store.clearMessageToSend();
    store.clearMessageRestoreIfEmpty();
    expect(useConversationStore.getState()).toMatchObject({
      messageToSend: null,
      messageRestoreIfEmpty: null,
    });
  });

  it("updates submitted, task, plan, and conversation-mode state without a route id", () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/" },
      writable: true,
    });
    const store = useConversationStore.getState();
    store.setSubmittedMessage("submitted");
    store.setSubConversationTaskId("task-1");
    store.setPlanContent("# Plan");
    store.setConversationMode("plan");

    expect(useConversationStore.getState()).toMatchObject({
      submittedMessage: "submitted",
      subConversationTaskId: "task-1",
      planContent: "# Plan",
      conversationMode: "plan",
    });
    expect(mockSetConversationState).not.toHaveBeenCalled();

    store.setSubmittedMessage(null);
    store.setSubConversationTaskId(null);
    store.setPlanContent(null);
    expect(useConversationStore.getState()).toMatchObject({
      submittedMessage: null,
      subConversationTaskId: null,
      planContent: null,
    });
  });

  it("resets transient conversation planning state from persisted mode", () => {
    mockGetConversationState.mockReturnValue({
      selectedTab: "files",
      unpinnedTabs: [],
      conversationMode: "plan",
    });
    useConversationStore.setState({
      shouldHideSuggestions: true,
      subConversationTaskId: "task",
      planContent: "plan",
    });

    useConversationStore.getState().resetConversationState();

    expect(useConversationStore.getState()).toMatchObject({
      shouldHideSuggestions: false,
      conversationMode: "plan",
      subConversationTaskId: null,
      planContent: null,
    });
  });

  it.each([
    [
      "setIsRightPanelShown",
      () => useConversationStore.getState().setIsRightPanelShown(true),
    ],
    ["clearImages", () => useConversationStore.getState().clearImages()],
    ["clearAllFiles", () => useConversationStore.getState().clearAllFiles()],
    [
      "clearAllLoading",
      () => useConversationStore.getState().clearAllLoading(),
    ],
    [
      "setMessageToSend",
      () => useConversationStore.getState().setMessageToSend("message"),
    ],
    [
      "clearMessageToSend",
      () => useConversationStore.getState().clearMessageToSend(),
    ],
    [
      "setSubmittedMessage",
      () => useConversationStore.getState().setSubmittedMessage("message"),
    ],
    [
      "resetConversationState",
      () => useConversationStore.getState().resetConversationState(),
    ],
  ])("%s preserves unrelated store state and actions", (_name, update) => {
    useConversationStore.setState({ selectedTab: "planner" });

    update();

    expect(useConversationStore.getState().selectedTab).toBe("planner");
    expect(useConversationStore.getState().setSelectedTab).toEqual(
      expect.any(Function),
    );
  });

  it("initializes safely without window and keeps mode changes in memory", async () => {
    vi.resetModules();
    vi.stubGlobal("window", undefined);

    const serverModule = await import("#/stores/conversation-store");
    expect(serverModule.useConversationStore.getState().conversationMode).toBe(
      "code",
    );
    serverModule.useConversationStore.getState().setConversationMode("plan");
    expect(serverModule.useConversationStore.getState().conversationMode).toBe(
      "plan",
    );
    expect(mockSetConversationState).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("initializes code mode without reading persistence when the route has no id", async () => {
    Object.defineProperty(window, "location", {
      value: { pathname: "/" },
      writable: true,
    });
    mockGetConversationState.mockClear();
    vi.resetModules();

    const freshModule = await import("#/stores/conversation-store");

    expect(freshModule.useConversationStore.getState().conversationMode).toBe(
      "code",
    );
    expect(mockGetConversationState).not.toHaveBeenCalled();
  });

  it("initializes a fresh module from persisted conversation mode", async () => {
    mockGetConversationState.mockReturnValue({
      selectedTab: "files",
      unpinnedTabs: [],
      conversationMode: "plan",
    });
    Object.defineProperty(window, "location", {
      value: { pathname: "/conversations/loaded-id/details" },
      writable: true,
    });
    vi.resetModules();

    const loadedModule = await import("#/stores/conversation-store");

    expect(loadedModule.useConversationStore.getState().conversationMode).toBe(
      "plan",
    );
    expect(mockGetConversationState).toHaveBeenCalledWith("loaded-id");
    vi.resetModules();
  });
});
