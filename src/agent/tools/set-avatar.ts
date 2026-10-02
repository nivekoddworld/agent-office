import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

/**
 * Lets an agent choose its own avatar: a DiceBear style and seed word,
 * saved as an "Avatar: <url>" line in instructions/IDENTITY.md. The Discord
 * bridge reads that line; you can also put any image URL there yourself.
 */

/** DiceBear avatar styles (https://www.dicebear.com/styles). */
export const AVATAR_STYLES = [
  "adventurer",
  "adventurer-neutral",
  "avataaars",
  "avataaars-neutral",
  "big-ears",
  "big-ears-neutral",
  "big-smile",
  "bottts",
  "bottts-neutral",
  "croodles",
  "croodles-neutral",
  "dylan",
  "fun-emoji",
  "glass",
  "icons",
  "identicon",
  "lorelei",
  "lorelei-neutral",
  "micah",
  "miniavs",
  "notionists",
  "notionists-neutral",
  "open-peeps",
  "personas",
  "pixel-art",
  "pixel-art-neutral",
  "rings",
  "shapes",
  "thumbs",
] as const;

export const SET_AVATAR = {
  name: "set_avatar" as const,
  label: "Set Avatar",
  description:
    "Choose the picture shown next to your messages in Discord. Pick a DiceBear style that fits your personality (e.g. pixel-art, adventurer, bottts, lorelei, notionists, fun-emoji, thumbs) and any seed word: the same style and seed always give the same picture, so try another seed for a different look. Saved in your instructions/IDENTITY.md.",
  parameters: Type.Object({
    style: Type.Union(
      AVATAR_STYLES.map((s) => Type.Literal(s)),
      { description: "DiceBear style" },
    ),
    seed: Type.String({
      description: "Any word or phrase; it decides the exact picture",
    }),
    backgroundColor: Type.Optional(
      Type.String({ description: "Background colour as hex, e.g. b6e3f4" }),
    ),
  }),
};

export function avatarUrl(
  style: string,
  seed: string,
  backgroundColor?: string,
): string {
  const bg = backgroundColor?.replace(/^#/, "");
  return (
    `https://api.dicebear.com/9.x/${style}/png?seed=${encodeURIComponent(seed)}` +
    (bg ? `&backgroundColor=${bg}` : "")
  );
}

const AVATAR_LINE = /^Avatar:[^\n]*$/im;

/** IDENTITY.md text with its Avatar line set to `url`. */
export function withAvatarLine(identity: string, url: string): string {
  const line = `Avatar: ${url}`;
  if (AVATAR_LINE.test(identity)) return identity.replace(AVATAR_LINE, line);
  const body = identity.trimEnd();
  return body ? `${body}\n\nAvatar: ${url}\n` : `${line}\n`;
}

/** The https image URL on IDENTITY.md's Avatar line, if any. */
export function avatarFromIdentity(identity: string): string | undefined {
  const m = identity.match(/^Avatar:\s*(https:\/\/\S+)\s*$/im);
  return m?.[1];
}

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export function createSetAvatarTool(
  workspaceDir: string,
): AgentTool<typeof SET_AVATAR.parameters> {
  return {
    ...SET_AVATAR,
    execute: async (
      _id,
      params: { style: string; seed: string; backgroundColor?: string },
    ) => {
      const seed = params.seed.trim().slice(0, 64);
      if (!seed) return textResult("Error: seed must not be empty");
      if (
        params.backgroundColor &&
        !/^#?[0-9a-f]{6}$/i.test(params.backgroundColor)
      )
        return textResult(
          "Error: backgroundColor must be a hex colour like b6e3f4",
        );
      const url = avatarUrl(params.style, seed, params.backgroundColor);
      const dir = join(workspaceDir, "instructions");
      const file = join(dir, "IDENTITY.md");
      let identity = "";
      try {
        identity = readFileSync(file, "utf-8");
      } catch {
        // no IDENTITY.md yet
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, withAvatarLine(identity, url));
      return textResult(
        `Your avatar is now ${url} (saved in instructions/IDENTITY.md). It shows on your next Discord message.`,
      );
    },
  };
}
