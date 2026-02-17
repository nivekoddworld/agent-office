import { useEffect } from "react";

/** Listen for a keyboard shortcut (e.g. Cmd+K / Ctrl+K). */
export function useKeyboardShortcut(
  key: string,
  callback: () => void,
  opts: { meta?: boolean; ctrl?: boolean } = {},
) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      const needsMeta = opts.meta ?? false;
      const needsCtrl = opts.ctrl ?? false;
      if (needsMeta && !e.metaKey) return;
      if (needsCtrl && !e.ctrlKey) return;
      e.preventDefault();
      callback();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [key, callback, opts.meta, opts.ctrl]);
}
