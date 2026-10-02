import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  avatarFromIdentity,
  createSetAvatarTool,
  withAvatarLine,
} from "../src/agent/tools/set-avatar.js";
import { avatarLookup } from "../src/integrations/discord/index.js";

describe("set_avatar", () => {
  let ws: string;
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "avatar-"));
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));
  const identity = () =>
    readFileSync(join(ws, "instructions", "IDENTITY.md"), "utf-8");
  const run = (params: Record<string, string>) =>
    createSetAvatarTool(ws).execute(
      "id",
      params as any,
      undefined as any,
      undefined as any,
    );

  it("saves the chosen avatar in IDENTITY.md, keeping what's there", async () => {
    mkdirSync(join(ws, "instructions"));
    writeFileSync(
      join(ws, "instructions", "IDENTITY.md"),
      "I am the artist.\n",
    );
    const r = await run({ style: "pixel-art", seed: "sunflower field" });
    expect((r.content[0] as { text: string }).text).toContain(
      "Your avatar is now",
    );
    expect(identity()).toBe(
      "I am the artist.\n\nAvatar: https://api.dicebear.com/9.x/pixel-art/png?seed=sunflower%20field\n",
    );
    await run({ style: "lorelei", seed: "x", backgroundColor: "#b6e3f4" });
    expect(identity()).toBe(
      "I am the artist.\n\nAvatar: https://api.dicebear.com/9.x/lorelei/png?seed=x&backgroundColor=b6e3f4\n",
    );
  });

  it("rejects an empty seed or a bad colour", async () => {
    const bad = async (p: Record<string, string>) =>
      ((await run(p)).content[0] as { text: string }).text;
    expect(await bad({ style: "bottts", seed: " " })).toContain("Error");
    expect(
      await bad({ style: "bottts", seed: "a", backgroundColor: "red" }),
    ).toContain("Error");
  });

  it("reads the Avatar line back", () => {
    expect(
      avatarFromIdentity("Name: x\nAvatar: https://example.com/me.png\n"),
    ).toBe("https://example.com/me.png");
    expect(avatarFromIdentity("Avatar: not a url")).toBeUndefined();
    expect(withAvatarLine("", "https://a")).toBe("Avatar: https://a\n");
  });
});

describe("avatarLookup", () => {
  let ws: string;
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "avatar-lookup-"));
    mkdirSync(join(ws, "instructions"));
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("uses the agent's chosen avatar, else the default, and notices changes", () => {
    const file = join(ws, "instructions", "IDENTITY.md");
    const lookup = avatarLookup(
      (n) => (n === "artist" ? ws : undefined),
      undefined,
    );
    expect(lookup("artist")).toBe(
      "https://api.dicebear.com/9.x/bottts-neutral/png?seed=artist",
    );
    writeFileSync(file, "Avatar: https://example.com/one.png\n");
    expect(lookup("artist")).toBe("https://example.com/one.png");
    writeFileSync(file, "Avatar: https://example.com/two.png\n");
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(lookup("artist")).toBe("https://example.com/two.png");
    expect(lookup("user")).toBe(
      "https://api.dicebear.com/9.x/bottts-neutral/png?seed=user",
    );
    expect(avatarLookup(() => undefined, "none")("user")).toBeUndefined();
  });
});
