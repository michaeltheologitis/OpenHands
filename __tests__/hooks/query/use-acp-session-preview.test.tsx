import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HttpError,
  type ACPConfigOptionValues,
  type ACPSessionControls,
} from "@openhands/typescript-client";
import AgentProfilesService from "#/api/agent-profiles-service/agent-profiles-service.api";
import { localAgentServerHasCapability } from "#/api/agent-server-compatibility";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import SettingsService from "#/api/settings-service/settings-service.api";
import {
  NO_AGENT_CONTROLS,
  useHomeAgentControls,
  type HomeLaunchContext,
} from "#/hooks/chat/use-agent-controls";
import { useHomeAgentOptionsStore } from "#/stores/home-agent-options-store";
import type { Settings } from "#/types/settings";
import { createQueryWrapper } from "../../helpers/query-wrapper";

vi.mock("#/api/agent-server-compatibility", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#/api/agent-server-compatibility")
  >()),
  localAgentServerHasCapability: vi.fn(() => true),
}));

vi.mock("#/hooks/query/use-active-conversation", () => ({
  useActiveConversation: () => ({ data: undefined }),
}));

const BACKEND = {
  id: "local-acp",
  name: "Local",
  host: "http://127.0.0.1:8000",
  apiKey: "key",
  kind: "local" as const,
};
const LAUNCH_KEY = `${BACKEND.id}:null:acp-profile`;

/** The scripted agent: commands per profile; it refuses "turbo". */
function previewOf(values: ACPConfigOptionValues): ACPSessionControls {
  const profile = values.profile === "thorough" ? "thorough" : "fast";
  return {
    available_commands:
      profile === "fast"
        ? [{ name: "summarize", description: "Summarize the input" }]
        : [
            { name: "summarize", description: "Summarize the input" },
            {
              name: "compare",
              description: "Compare two things",
              input: { hint: "what to compare" },
            },
          ],
    config_options: [
      {
        id: "profile",
        name: "Profile",
        type: "select",
        current_value: profile,
        options: [
          { value: "fast", name: "fast" },
          { value: "thorough", name: "thorough" },
        ],
      },
      {
        id: "model",
        name: "Model",
        type: "select",
        current_value: "m1",
        options: [
          { value: "m1", name: "M1" },
          { value: "m2", name: "M2" },
        ],
      },
      {
        id: "verbose",
        name: "Verbose",
        type: "boolean",
        current_value: false,
        options: [],
      },
    ],
  };
}

const httpError = (status: number, detail?: string) =>
  new HttpError(status, "", detail ? { detail } : null);

function renderHome(
  launch: HomeLaunchContext = {
    workingDir: "/repo",
    workspaceMode: "local_repo",
  },
) {
  return renderHook(({ context }) => useHomeAgentControls(context), {
    wrapper: createQueryWrapper(),
    initialProps: { context: launch },
  });
}

const preview = () =>
  vi.mocked(AgentServerConversationService.previewAcpSession);
const commandsOf = (controls: { commands: { name: string }[] }) =>
  controls.commands.map(({ name }) => name);
/** Lets a preview the hook might still start reach the service. */
const settle = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      }),
  );

describe("useHomeAgentControls", () => {
  beforeEach(() => {
    __resetActiveStoreForTests();
    setRegisteredBackends([BACKEND]);
    setActiveSelection({ backendId: BACKEND.id });
    useHomeAgentOptionsStore.setState({ launchKey: null, values: {} });
    vi.mocked(localAgentServerHasCapability).mockReturnValue(true);
    vi.spyOn(AgentProfilesService, "listProfiles").mockResolvedValue({
      profiles: [
        { id: "acp-profile", name: "scripted", agent_kind: "acp" },
      ] as never,
      active_agent_profile_id: "acp-profile",
    });
    vi.spyOn(SettingsService, "getSettings").mockResolvedValue({
      agent_settings: { agent_kind: "acp" },
    } as unknown as Settings);
    vi.spyOn(
      AgentServerConversationService,
      "previewAcpSession",
    ).mockImplementation(async ({ acpConfigOptions }) => {
      if (acpConfigOptions.profile === "turbo") {
        throw httpError(422, "unknown profile 'turbo'");
      }
      return previewOf(acpConfigOptions);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetActiveStoreForTests();
  });

  it("previews the launch agent with the start's workspace, and again for each pick and workspace", async () => {
    const { result, rerender } = renderHome();
    await waitFor(() =>
      expect(commandsOf(result.current)).toEqual(["summarize"]),
    );
    expect(preview()).toHaveBeenLastCalledWith({
      workingDirOverride: "/repo",
      workspaceMode: "local_repo",
      agentProfileId: "acp-profile",
      agentProfileKind: "acp",
      acpConfigOptions: {},
    });

    act(() => result.current.setOption("profile", "thorough"));
    await waitFor(() =>
      expect(commandsOf(result.current)).toEqual(["summarize", "compare"]),
    );
    expect(preview()).toHaveBeenLastCalledWith(
      expect.objectContaining({ acpConfigOptions: { profile: "thorough" } }),
    );

    rerender({
      context: { workingDir: undefined, workspaceMode: "local_repo" },
    });
    await waitFor(() =>
      expect(preview()).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workingDirOverride: undefined,
          workspaceMode: undefined,
          acpConfigOptions: { profile: "thorough" },
        }),
      ),
    );
    expect(preview()).toHaveBeenCalledTimes(3);
  });

  it("asks the agent again when the home screen returns", async () => {
    const wrapper = createQueryWrapper();
    const context: HomeLaunchContext = {
      workingDir: "/repo",
      workspaceMode: "local_repo",
    };
    const first = renderHook(() => useHomeAgentControls(context), { wrapper });
    await waitFor(() =>
      expect(commandsOf(first.result.current)).toEqual(["summarize"]),
    );
    first.unmount();
    await settle();

    renderHook(() => useHomeAgentControls(context), { wrapper });

    await waitFor(() => expect(preview()).toHaveBeenCalledTimes(2));
  });

  // @spec ASC-003 — The model option belongs to the model picker
  it("offers the agent's select options except the model, and no boolean", async () => {
    const { result } = renderHome();

    await waitFor(() =>
      expect(result.current.options.map(({ id }) => id)).toEqual(["profile"]),
    );
  });

  it("does not send values picked for another launch agent", async () => {
    useHomeAgentOptionsStore.setState({
      launchKey: `${BACKEND.id}:null:another-profile`,
      values: { profile: "thorough" },
    });

    const { result } = renderHome();

    await waitFor(() =>
      expect(commandsOf(result.current)).toEqual(["summarize"]),
    );
    expect(preview()).toHaveBeenCalledWith(
      expect.objectContaining({ acpConfigOptions: {} }),
    );
    expect(result.current.startValues).toEqual({});
  });

  // @spec ASC-002 — A conversation starts with values the preview accepted
  it("returns the picks to the last accepted values when the agent refuses one, without asking again, and says why", async () => {
    const { result } = renderHome();
    await waitFor(() =>
      expect(commandsOf(result.current)).toEqual(["summarize"]),
    );
    act(() => result.current.setOption("profile", "thorough"));
    await waitFor(() =>
      expect(result.current.startValues).toEqual({ profile: "thorough" }),
    );

    act(() => result.current.setOption("profile", "turbo"));

    await waitFor(() =>
      expect(useHomeAgentOptionsStore.getState()).toMatchObject({
        launchKey: LAUNCH_KEY,
        values: { profile: "thorough" },
      }),
    );
    await settle();
    expect(result.current.rejection).toBe("unknown profile 'turbo'");
    expect(commandsOf(result.current)).toEqual(["summarize", "compare"]);
    expect(result.current.options[0].current_value).toBe("thorough");
    expect(result.current.pendingValues).toEqual({});
    expect(result.current.startValues).toEqual({ profile: "thorough" });
    expect(preview()).toHaveBeenCalledTimes(3);
  });

  // A refusal that lands after the home screen has gone (a start sent while
  // the pick's preview ran) leaves nothing answered to return to.
  it("returns refused picks to the agent's defaults when the home screen has no answer yet", async () => {
    useHomeAgentOptionsStore.setState({
      launchKey: LAUNCH_KEY,
      values: { profile: "turbo" },
    });

    const { result } = renderHome();

    await waitFor(() =>
      expect(result.current.options[0]?.current_value).toBe("fast"),
    );
    expect(useHomeAgentOptionsStore.getState().values).toEqual({});
    expect(result.current.rejection).toBe("unknown profile 'turbo'");
  });

  it("asks the agent again when the value it refused is picked again", async () => {
    const { result } = renderHome();
    await waitFor(() =>
      expect(commandsOf(result.current)).toEqual(["summarize"]),
    );
    act(() => result.current.setOption("profile", "turbo"));
    await waitFor(() =>
      expect(result.current.rejection).toBe("unknown profile 'turbo'"),
    );
    await waitFor(() =>
      expect(useHomeAgentOptionsStore.getState().values).toEqual({}),
    );

    act(() => result.current.setOption("profile", "turbo"));

    await waitFor(() => expect(preview()).toHaveBeenCalledTimes(3));
    expect(preview()).toHaveBeenLastCalledWith(
      expect.objectContaining({ acpConfigOptions: { profile: "turbo" } }),
    );
    await waitFor(() =>
      expect(useHomeAgentOptionsStore.getState().values).toEqual({}),
    );
    expect(result.current.rejection).toBe("unknown profile 'turbo'");
  });

  it("shows a pick in flight until its preview settles", async () => {
    let answer: (controls: ACPSessionControls) => void = () => undefined;
    const { result } = renderHome();
    await waitFor(() =>
      expect(commandsOf(result.current)).toEqual(["summarize"]),
    );
    preview().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );

    act(() => result.current.setOption("profile", "thorough"));

    await waitFor(() =>
      expect(result.current.pendingValues).toEqual({ profile: "thorough" }),
    );
    expect(commandsOf(result.current)).toEqual(["summarize"]);
    await act(async () => answer(previewOf({ profile: "thorough" })));
    await waitFor(() => expect(result.current.pendingValues).toEqual({}));
  });

  it("starts only with option ids and select values the last accepted preview reported", async () => {
    preview().mockResolvedValue({
      available_commands: [],
      config_options: [
        {
          id: "profile",
          name: "Profile",
          type: "select",
          current_value: "fast",
          options: [
            { value: "fast", name: "fast" },
            { value: "thorough", name: "thorough" },
          ],
        },
        {
          id: "depth",
          name: "Depth",
          type: "select",
          current_value: "low",
          options: [
            { value: "low", name: "low" },
            { value: "high", name: "high" },
          ],
        },
      ],
    });
    useHomeAgentOptionsStore.setState({
      launchKey: LAUNCH_KEY,
      values: { profile: "thorough", depth: "extreme", retired: "x" },
    });

    const { result } = renderHome();

    await waitFor(() =>
      expect(result.current.startValues).toEqual({ profile: "thorough" }),
    );
  });

  // @spec ASC-004 — Only where the agent-server supports them
  it.each([400, 429, 501, 502, 504])(
    "shows no commands and no picker, and starts with no values, when the preview answers %i",
    async (status) => {
      preview().mockRejectedValue(httpError(status, "unavailable"));

      const { result } = renderHome();

      await waitFor(() => expect(preview()).toHaveBeenCalled());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current).toMatchObject({
        commands: [],
        options: [],
        rejection: null,
        startValues: {},
      });
    },
  );

  it.each([
    [
      "the agent-server lacks acp_session_controls_v1",
      () => vi.mocked(localAgentServerHasCapability).mockReturnValue(false),
    ],
    [
      "the launch agent is not ACP",
      () =>
        vi.mocked(AgentProfilesService.listProfiles).mockResolvedValue({
          profiles: [
            { id: "oh-profile", name: "default", agent_kind: "openhands" },
          ] as never,
          active_agent_profile_id: "oh-profile",
        }),
    ],
  ])("previews nothing when %s", async (_label, arrange) => {
    arrange();

    const { result } = renderHome();
    await waitFor(() =>
      expect(AgentProfilesService.listProfiles).toHaveBeenCalled(),
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(result.current).toBe(NO_AGENT_CONTROLS);
    expect(preview()).not.toHaveBeenCalled();
  });
});
