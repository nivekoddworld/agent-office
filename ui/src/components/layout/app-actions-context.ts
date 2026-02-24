import { createContext, useContext } from "react";

export interface AppActions {
  openAgentProfile: (name: string) => void;
}

export const AppActionsContext = createContext<AppActions | null>(null);

export function useAppActions(): AppActions {
  const ctx = useContext(AppActionsContext);
  if (!ctx)
    throw new Error("useAppActions must be used within AppActionsContext");
  return ctx;
}
