import type { ACPConfigOptionValues } from "@openhands/typescript-client";
import { create } from "zustand";

export interface HomeAgentOptionsState {
  /** The launch agent the values were picked for; values under another key are ignored. */
  launchKey: string | null;
  values: ACPConfigOptionValues;
  /** Picking under a new launch key replaces the map. */
  setValue: (
    launchKey: string,
    configId: string,
    value: string | boolean,
  ) => void;
  /** Replaces the values picked for a launch agent. */
  setValues: (launchKey: string, values: ACPConfigOptionValues) => void;
}

/**
 * The ACP config option values picked on the home screen, for the next
 * conversation the launch agent starts. Session-only: they stay after a start
 * (several conversations in one namespace need one pick) and reset with the
 * app.
 */
export const useHomeAgentOptionsStore = create<HomeAgentOptionsState>()(
  (set) => ({
    launchKey: null,
    values: {},
    setValue: (launchKey, configId, value) =>
      set((state) => ({
        launchKey,
        values: {
          ...(state.launchKey === launchKey ? state.values : {}),
          [configId]: value,
        },
      })),
    setValues: (launchKey, values) => set({ launchKey, values }),
  }),
);
