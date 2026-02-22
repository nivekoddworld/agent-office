import type { SourceKind } from "../types.js";

export function sessionKey(kind: SourceKind, target: string): string {
  switch (kind) {
    case "dm":
      return `dm:${target}`;
    case "channel":
      return `ch:${target}`;
    case "internal":
      return `internal:${target}`;
  }
}
