import { describe, it, expect } from "vitest";
import {
  resolveEnvRefs,
  isEnvRef,
  validateRefSyntax,
  MissingEnvVarError,
} from "../src/config/env-substitution.js";

describe("resolveEnvRefs", () => {
  const env = {
    MY_VAR: "hello",
    OTHER: "world",
    EMPTY: "",
  } as NodeJS.ProcessEnv;

  it("resolves single ${VAR}", () => {
    expect(resolveEnvRefs({ FOO: "${MY_VAR}" }, env)).toEqual({ FOO: "hello" });
  });

  it("resolves multiple vars in one value", () => {
    expect(resolveEnvRefs({ FOO: "${MY_VAR}-${OTHER}" }, env)).toEqual({
      FOO: "hello-world",
    });
  });

  it("resolves mixed text and refs", () => {
    expect(resolveEnvRefs({ FOO: "prefix_${MY_VAR}_suffix" }, env)).toEqual({
      FOO: "prefix_hello_suffix",
    });
  });

  it("passes through literal values (no refs)", () => {
    expect(resolveEnvRefs({ FOO: "literal" }, env)).toEqual({ FOO: "literal" });
  });

  it("throws MissingEnvVarError on missing var", () => {
    expect(() =>
      resolveEnvRefs({ FOO: "${MISSING}" }, env, "agents.bot.env"),
    ).toThrow(MissingEnvVarError);
    try {
      resolveEnvRefs({ FOO: "${MISSING}" }, env, "agents.bot.env");
    } catch (e) {
      const err = e as MissingEnvVarError;
      expect(err.varName).toBe("MISSING");
      expect(err.configPath).toBe("agents.bot.env.FOO");
    }
  });

  it("treats empty string as missing", () => {
    expect(() => resolveEnvRefs({ FOO: "${EMPTY}" }, env)).toThrow(
      MissingEnvVarError,
    );
  });

  it("ignores lowercase vars (not matched by pattern)", () => {
    expect(resolveEnvRefs({ FOO: "${lowercase}" }, env)).toEqual({
      FOO: "${lowercase}",
    });
  });

  it("unescapes $${VAR} to literal ${VAR}", () => {
    expect(resolveEnvRefs({ FOO: "$${MY_VAR}" }, env)).toEqual({
      FOO: "${MY_VAR}",
    });
  });

  it("resolves multiple entries", () => {
    const result = resolveEnvRefs({ A: "${MY_VAR}", B: "${OTHER}" }, env);
    expect(result).toEqual({ A: "hello", B: "world" });
  });

  it("includes pathPrefix in error message", () => {
    expect(() =>
      resolveEnvRefs({ KEY: "${NOPE}" }, env, "agents.x.env"),
    ).toThrow("agents.x.env.KEY");
  });
});

describe("isEnvRef", () => {
  it("returns true for ${VAR}", () => {
    expect(isEnvRef("${MY_VAR}")).toBe(true);
  });

  it("returns true for mixed text with ref", () => {
    expect(isEnvRef("prefix_${VAR}_suffix")).toBe(true);
  });

  it("returns false for literal text", () => {
    expect(isEnvRef("literal")).toBe(false);
  });

  it("returns false for escaped $${VAR}", () => {
    expect(isEnvRef("$${MY_VAR}")).toBe(false);
  });

  it("returns false for lowercase vars", () => {
    expect(isEnvRef("${lowercase}")).toBe(false);
  });
});

describe("validateRefSyntax", () => {
  it("returns empty for all valid refs", () => {
    expect(validateRefSyntax({ A: "${VAR}", B: "${OTHER}" })).toEqual([]);
  });

  it("returns keys without ${VAR} pattern", () => {
    expect(validateRefSyntax({ A: "${VAR}", B: "literal" })).toEqual(["B"]);
  });

  it("returns all keys if none have refs", () => {
    expect(validateRefSyntax({ X: "foo", Y: "bar" })).toEqual(["X", "Y"]);
  });
});
