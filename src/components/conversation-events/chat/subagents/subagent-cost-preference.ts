import React from "react";

/** Where this browser keeps the choice, so it survives a reload. */
export const SHOW_SUBAGENT_COSTS_STORAGE_KEY = "openhands-show-subagent-costs";
const CHANGE_EVENT = "openhands-show-subagent-costs-change";

const readShowSubagentCosts = () =>
  typeof window !== "undefined" &&
  window.localStorage.getItem(SHOW_SUBAGENT_COSTS_STORAGE_KEY) === "true";

const subscribeShowSubagentCosts = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
};

// @spec SUB-006 — Costs show only when the setting is on; then each sub-agent shows its latest reported cost, never a sum
/** Whether sub-agent rows show their cost: off until the user turns it on. */
export function useShowSubagentCosts(): boolean {
  return React.useSyncExternalStore(
    subscribeShowSubagentCosts,
    readShowSubagentCosts,
    () => false,
  );
}

/** Save the choice; this tab applies it at once, others on `storage`. */
export function writeShowSubagentCosts(show: boolean): void {
  window.localStorage.setItem(
    SHOW_SUBAGENT_COSTS_STORAGE_KEY,
    show ? "true" : "false",
  );
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
