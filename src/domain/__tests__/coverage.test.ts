import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "@/domain/commands";

/** 每个命令都要有测试：命令名至少在一个 commands.*.test.ts 里被跑过。 */
describe("命令都有测试", () => {
  const dir = join(process.cwd(), "src/domain/__tests__");
  const text = readdirSync(dir)
    .filter((f) => f.startsWith("commands.") && f.endsWith(".test.ts"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  for (const name of Object.keys(COMMANDS)) {
    it(name, () => {
      expect(text.includes(`"${name}"`), `${name} 没有测试`).toBe(true);
    });
  }
});
