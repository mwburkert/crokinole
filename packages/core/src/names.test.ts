import { describe, expect, it } from "vitest";

import { defaultNickname, fullName, normaliseName } from "./names.js";
import { MAX_NAME_LENGTH } from "./types.js";

describe("defaultNickname", () => {
  it("uses the first name when nothing claims it", () => {
    expect(defaultNickname("Kinsey", "Mead", [])).toBe("Kinsey");
  });

  it("falls back to first name plus last initial on a collision", () => {
    expect(defaultNickname("Matt", "Burton", ["Matt"])).toBe("Matt B");
  });

  it("goes to the full last name when the initial collides too", () => {
    // The real case: Matt Burkert and Matt Burton both want "Matt B".
    expect(defaultNickname("Matt", "Burkert", ["Matt", "Matt B"])).toBe("Matt Burkert");
  });

  it("never hands back a name that is already taken", () => {
    const taken = ["Matt", "Matt B", "Matt Burton"];
    const chosen = defaultNickname("Matt", "Burton", taken);
    expect(taken).not.toContain(chosen);
    expect(chosen).not.toBe("");
  });

  it("treats collisions case- and space-insensitively", () => {
    // "matt" and "Matt" would be indistinguishable in every table that shows them.
    expect(defaultNickname("Matt", "Burton", ["  matt  "])).toBe("Matt B");
  });

  it("copes with no last name at all", () => {
    expect(defaultNickname("Marley", undefined, [])).toBe("Marley");
    expect(defaultNickname("Marley", undefined, ["Marley"])).toBe("Marley 2");
  });

  it("never exceeds the display cap", () => {
    const chosen = defaultNickname("Bartholomew", "Fotheringay", ["Bartholomew"]);
    expect(chosen.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
  });

  it("still yields a name when the first name is only whitespace", () => {
    expect(defaultNickname("   ", "Mead", [])).toBe("Mead");
  });
});

describe("normaliseName", () => {
  it("trims, collapses inner whitespace, and caps length", () => {
    expect(normaliseName("  Matt   Burton  ")).toBe("Matt Burton");
    expect(normaliseName("x".repeat(MAX_NAME_LENGTH + 5))).toHaveLength(MAX_NAME_LENGTH);
  });
});

describe("fullName", () => {
  it("joins the two, and copes with no surname", () => {
    expect(fullName("Kinsey", "Mead")).toBe("Kinsey Mead");
    expect(fullName("Marley")).toBe("Marley");
    expect(fullName("Marley", "  ")).toBe("Marley");
  });
});
