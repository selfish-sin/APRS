import { describe, expect, it } from "vitest";
import { AVATAR_TONES, avatarTone } from "./avatarTone";

describe("avatarTone", () => {
  it("keeps the same color for the same id", () => {
    expect(avatarTone("mem_a")).toBe(avatarTone("mem_a"));
    expect(avatarTone("mem_b")).toBe(avatarTone("mem_b"));
  });

  it("only uses avatar colors", () => {
    for (const id of ["mem_a", "mem_c", "mem_b", "mem_d", "mem_e"]) {
      expect(AVATAR_TONES).toContain(avatarTone(id));
    }
  });
});
