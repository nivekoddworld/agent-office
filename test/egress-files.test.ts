import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importFiles, MAX_FILES } from "../src/egress/files.js";
import {
  messageUser,
  onEgress,
  postChannel,
  mentionsInText,
  _resetRateLimits,
} from "../src/egress/egress-impl.js";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

describe("importFiles", () => {
  let dir: string;
  let office: string;
  let ws: string;
  let shared: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "images-"));
    office = join(dir, "office");
    ws = join(office, "agents", "artist", "workspace");
    shared = join(office, "shared");
    mkdirSync(join(ws, "art"), { recursive: true });
    mkdirSync(shared, { recursive: true });
    writeFileSync(join(ws, "art", "logo.png"), PNG);
    writeFileSync(join(shared, "banner.jpg"), PNG);
    writeFileSync(join(ws, "notes.txt"), "hi");
    writeFileSync(join(dir, "secret.png"), PNG);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const uploads = () => readdirSync(join(office, "uploads"));

  it("copies images from the workspace and shared folder into uploads", () => {
    const r = importFiles(office, { workspace: ws, shared }, [
      "art/logo.png",
      join(shared, "banner.jpg"),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attachments.map((a) => [a.filename, a.mimeType])).toEqual([
      ["logo.png", "image/png"],
      ["banner.jpg", "image/jpeg"],
    ]);
    expect(uploads()).toHaveLength(2);
    expect(readFileSync(join(office, "uploads", r.attachments[0]!.id))).toEqual(
      PNG,
    );
  });

  it("attaches any file type, e.g. a zipped build, with its size", () => {
    writeFileSync(join(ws, "build.zip"), Buffer.alloc(1234));
    const r = importFiles(office, { workspace: ws }, [
      "build.zip",
      "notes.txt",
    ]);
    expect(r).toMatchObject({
      ok: true,
      attachments: [
        { filename: "build.zip", mimeType: "application/zip", size: 1234 },
        { filename: "notes.txt", mimeType: "text/plain", size: 2 },
      ],
    });
  });

  it("maps a sandbox's /workspace and /shared paths", () => {
    const roots = { workspace: ws, shared, sandbox: true };
    expect(importFiles(office, roots, ["/workspace/art/logo.png"]).ok).toBe(
      true,
    );
    expect(importFiles(office, roots, ["/shared/banner.jpg"]).ok).toBe(true);
    expect(importFiles(office, roots, ["art/logo.png"]).ok).toBe(true);
    const outside = importFiles(office, roots, ["/etc/passwd.png"]);
    expect(outside).toEqual({
      ok: false,
      error: "/etc/passwd.png: not in /workspace or /shared",
    });
  });

  it("refuses files outside the agent's folders, folders and too many", () => {
    const roots = { workspace: ws, shared };
    expect(importFiles(office, roots, [join(dir, "secret.png")])).toMatchObject(
      {
        ok: false,
        error: expect.stringContaining(
          "only files in your workspace or the shared folder",
        ),
      },
    );
    expect(
      importFiles(office, roots, ["../../../../secret.png"]),
    ).toMatchObject({
      ok: false,
    });
    expect(importFiles(office, roots, ["art"])).toMatchObject({
      ok: false,
      error: expect.stringContaining("zip it first"),
    });
    expect(importFiles(office, roots, ["missing.png"])).toMatchObject({
      ok: false,
      error: "missing.png: file not found",
    });
    expect(
      importFiles(office, roots, Array(MAX_FILES + 1).fill("art/logo.png")),
    ).toMatchObject({ ok: false });
    expect(importFiles(office, undefined, ["art/logo.png"])).toMatchObject({
      ok: false,
    });
  });
});

describe("sending images and mentions", () => {
  let dir: string;
  let ws: string;
  const seen: unknown[] = [];
  let off: () => void;
  const deps = () => ({
    baseDir: dir,
    bus: { send: vi.fn() } as any,
    channels: new Map([["work", { members: ["artist", "coder"] }]]),
    agentFiles: () => ({ workspace: ws }),
  });
  beforeEach(() => {
    _resetRateLimits();
    dir = mkdtempSync(join(tmpdir(), "egress-img-"));
    ws = join(dir, "ws");
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "logo.png"), PNG);
    seen.length = 0;
    off = onEgress((e) => seen.push(e));
  });
  afterEach(() => {
    off();
    rmSync(dir, { recursive: true, force: true });
  });

  it("attaches images to a DM to the user", () => {
    const store = { saveDm: vi.fn(() => true) } as any;
    const r = messageUser(
      { agentName: "artist", hopCount: 0 },
      { ...deps(), messageStore: store },
      "here's the logo",
      ["logo.png"],
    );
    expect(r.ok).toBe(true);
    const saved = store.saveDm.mock.calls[0][0];
    expect(JSON.parse(saved.attachments)[0].filename).toBe("logo.png");
    expect(seen[0]).toMatchObject({
      kind: "dm",
      attachments: [{ filename: "logo.png", mimeType: "image/png" }],
    });
  });

  it("allows an image-only channel post and reports bad paths", () => {
    expect(
      postChannel(
        { agentName: "artist", hopCount: 0 },
        deps(),
        "work",
        "",
        undefined,
        undefined,
        ["logo.png"],
      ).ok,
    ).toBe(true);
    expect(seen[0]).toMatchObject({
      kind: "channel",
      attachments: [{ filename: "logo.png" }],
    });
    expect(
      postChannel(
        { agentName: "artist", hopCount: 0 },
        deps(),
        "work",
        "x",
        undefined,
        undefined,
        ["nope.png"],
      ),
    ).toEqual({
      ok: false,
      reason: "validation",
      error: "nope.png: file not found",
    });
  });

  it("treats @name in the text as a mention, and skips non-members instead of failing", () => {
    const d = deps();
    const r = postChannel(
      { agentName: "artist", hopCount: 0 },
      d,
      "work",
      "@Coder can you wire this up? cc @lead",
      ["lead"],
    );
    expect(r).toMatchObject({
      ok: true,
      targets: ["coder"],
      skippedMentions: ["lead"],
    });
    expect(d.bus.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "coder" }),
    );
    expect(mentionsInText("mail me@coder.dev, @CODER!", ["coder"])).toEqual([
      "coder",
    ]);
  });
});
