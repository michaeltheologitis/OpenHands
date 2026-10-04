import { beforeEach, describe, expect, it } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "test-utils";
import { SubagentCostsSwitch } from "#/components/features/settings/app-settings/subagent-costs-switch";
import { AcpToolCallCell } from "#/components/conversation-events/chat/subagents/acp-tool-call-cell";
import { SHOW_SUBAGENT_COSTS_STORAGE_KEY } from "#/components/conversation-events/chat/subagents/subagent-cost-preference";
import { useEventStore } from "#/stores/use-event-store";
import { call, child } from "../../../helpers/subagent-events";

const cell = call(1, "c1");
const user = userEvent.setup();

/** The switch beside a call whose finished sub-agent reported a cost. */
async function renderSwitchBesideSubagent() {
  const view = renderWithProviders(
    <>
      <SubagentCostsSwitch />
      <AcpToolCallCell event={cell} depth={0} />
    </>,
  );
  await user.click(screen.getByTestId("subagent-block-toggle"));
  return view;
}

const toggle = () => screen.getByTestId("show-subagent-costs-switch");
const cost = () => screen.queryByTestId("subagent-cost");

describe("SubagentCostsSwitch", () => {
  beforeEach(() => {
    window.localStorage.clear();
    act(() => {
      const store = useEventStore.getState();
      store.clearEvents();
      store.addEvents([
        cell,
        child(2, "n2", {
          cell: "c1",
          state: "idle",
          stopReason: "end_turn",
          cost: 0.0004,
        }),
      ]);
    });
  });

  // @spec SUB-006 — Costs show only when the setting is on; then each sub-agent shows its latest reported cost, never a sum
  it("is off by default and shows sub-agent costs while on", async () => {
    await renderSwitchBesideSubagent();
    expect(toggle()).not.toBeChecked();
    expect(cost()).not.toBeInTheDocument();

    await user.click(toggle());
    expect(toggle()).toBeChecked();
    expect(cost()).toHaveTextContent("$0.0004");

    await user.click(toggle());
    expect(toggle()).not.toBeChecked();
    expect(cost()).not.toBeInTheDocument();
  });

  // @spec SUB-006 — Costs show only when the setting is on; then each sub-agent shows its latest reported cost, never a sum
  it("keeps sub-agent costs shown across a reload", async () => {
    const { unmount } = await renderSwitchBesideSubagent();
    await user.click(toggle());
    unmount();

    await renderSwitchBesideSubagent();

    expect(window.localStorage.getItem(SHOW_SUBAGENT_COSTS_STORAGE_KEY)).toBe(
      "true",
    );
    expect(toggle()).toBeChecked();
    expect(cost()).toHaveTextContent("$0.0004");
  });

  // @spec SUB-006 — Costs show only when the setting is on; then each sub-agent shows its latest reported cost, never a sum
  it("follows the setting when another tab changes it", async () => {
    await renderSwitchBesideSubagent();

    act(() => {
      window.localStorage.setItem(SHOW_SUBAGENT_COSTS_STORAGE_KEY, "true");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: SHOW_SUBAGENT_COSTS_STORAGE_KEY,
          newValue: "true",
        }),
      );
    });

    expect(toggle()).toBeChecked();
    expect(cost()).toHaveTextContent("$0.0004");
  });
});
