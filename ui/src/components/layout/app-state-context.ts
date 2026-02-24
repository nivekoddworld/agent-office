import { createContext, useContext } from "react";
import type { BootstrapState } from "../../api/types.js";

export const AppStateContext = createContext<BootstrapState | null>(null);

export function useAppState(): BootstrapState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateContext");
  return ctx;
}
