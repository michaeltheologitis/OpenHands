import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ACPConfigOption } from "@openhands/typescript-client";
import { renderWithProviders } from "test-utils";
import { ChatInputAgentOptions } from "#/components/features/chat/components/chat-input-agent-options";
import {
  NO_AGENT_CONTROLS,
  type AgentControls,
} from "#/hooks/chat/use-agent-controls";

const namespace: ACPConfigOption = {
  id: "namespace",
  name: "Namespace",
  type: "select",
  current_value: "router",
  options: [
    { value: "router", name: "Router", group: "Built in" },
    {
      value: "course_advisor",
      name: "Course advisor",
      description: "Advice on courses",
      group: "Saved",
    },
  ],
};

const fixedNamespace: ACPConfigOption = {
  ...namespace,
  description: "The namespace is fixed once the conversation has started.",
  options: [namespace.options[0]],
};

function renderOptions(controls: Partial<AgentControls>, disabled = false) {
  const setOption = vi.fn();
  renderWithProviders(
    <ChatInputAgentOptions
      controls={{ ...NO_AGENT_CONTROLS, setOption, ...controls }}
      disabled={disabled}
    />,
  );
  return { setOption };
}

describe("ChatInputAgentOptions", () => {
  it("renders no row when the agent offers no options", () => {
    renderOptions({ options: [] });

    expect(screen.queryByTestId("agent-options")).not.toBeInTheDocument();
  });

  it("shows each option as a pill naming the option and its current value", () => {
    renderOptions({ options: [namespace] });

    const row = screen.getByRole("group", {
      name: "CHAT_INTERFACE$AGENT_OPTIONS",
    });
    const pill = within(row).getByTestId("agent-option-namespace");
    expect(pill).toHaveTextContent("Namespace: Router");
    expect(pill).toHaveAttribute("data-value", "router");
  });

  it("lists the values under a header per group, and choosing one sets it", async () => {
    const user = userEvent.setup();
    const { setOption } = renderOptions({ options: [namespace] });

    await user.click(screen.getByTestId("agent-option-namespace"));

    const menu = screen.getByTestId("agent-option-namespace-menu");
    expect(
      within(menu)
        .getAllByRole("presentation")
        .map((header) => header.textContent),
    ).toEqual(["Built in", "Saved"]);
    const value = screen.getByTestId(
      "agent-option-namespace-value-course_advisor",
    );
    expect(within(value).getByTitle("Advice on courses")).toBeVisible();
    await user.click(value);
    expect(setOption).toHaveBeenCalledWith("namespace", "course_advisor");
  });

  it("shows a value in flight with a spinner, and takes no other pick meanwhile", () => {
    renderOptions({
      options: [namespace],
      pendingValues: { namespace: "course_advisor" },
    });

    const pill = screen.getByTestId("agent-option-namespace");
    expect(pill).toHaveTextContent("Namespace: Course advisor");
    expect(within(pill).getByTestId("loading-spinner")).toBeInTheDocument();
    expect(pill).toBeDisabled();
  });

  it("shows an option with one value as fixed, with the option's description as its tooltip", () => {
    renderOptions({ options: [fixedNamespace] });

    const pill = screen.getByTestId("agent-option-namespace");
    expect(pill).toHaveAttribute("data-fixed", "true");
    expect(pill).not.toHaveRole("button");
    expect(pill).toHaveAttribute(
      "title",
      "The namespace is fixed once the conversation has started.",
    );
  });

  it("explains a fixed option without a description in Canvas's words", () => {
    renderOptions({
      options: [{ ...fixedNamespace, description: null }],
    });

    expect(screen.getByTestId("agent-option-namespace")).toHaveAttribute(
      "title",
      "CHAT_INTERFACE$AGENT_OPTION_FIXED",
    );
  });

  it("disables the pickers while the composer is disabled", () => {
    renderOptions({ options: [namespace] }, true);

    expect(screen.getByTestId("agent-option-namespace")).toBeDisabled();
  });

  it("shows the agent's sentence for a value it refused", () => {
    renderOptions({
      options: [namespace],
      rejection: "unknown namespace 'nope'",
    });

    expect(screen.getByTestId("agent-option-rejection")).toHaveTextContent(
      "unknown namespace 'nope'",
    );
  });
});
