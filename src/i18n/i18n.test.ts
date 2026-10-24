import { describe, expect, it } from "vitest";
import { ERRORS } from "@/domain/errors";
import { detectLang, fmt } from "./core";
import { en } from "./en";
import { zh } from "./zh";

type Tree = { [k: string]: string | Tree };

function leaves(t: Tree, prefix = ""): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(key, [v]);
    else if (v && typeof v === "object" && "other" in v && typeof (v as { other: unknown }).other === "string") out.set(key, Object.values(v as Record<string, string>));
    else for (const [kk, vv] of Array.from(leaves(v as Tree, key))) out.set(kk, vv);
  }
  return out;
}

const params = (s: string) => Array.from(new Set(Array.from(s.matchAll(/\{(\w+)\}/g)).map((m) => m[1]))).sort();

describe("词典（SPEC §16）", () => {
  const z = leaves(zh as unknown as Tree);
  const e = leaves(en as unknown as Tree);

  it("zh / en 键名一样（少一个键就报错）", () => {
    const missingEn = Array.from(z.keys()).filter((k) => !e.has(k));
    const extraEn = Array.from(e.keys()).filter((k) => !z.has(k));
    expect(missingEn).toEqual([]);
    expect(extraEn).toEqual([]);
  });

  it("占位符一样；英文里没有汉字；中文不是空的", () => {
    const bad: string[] = [];
    for (const [k, zv] of Array.from(z)) {
      const ev = e.get(k) ?? [];
      const zp = params(zv.join(" "));
      const ep = params(ev.join(" ")).filter((p) => p !== "n" || zp.includes("n"));
      if (zp.join(",") !== ep.join(",")) bad.push(`${k}: ${zp} ≠ ${ep}`);
      if (ev.some((x) => /[一-鿿]/.test(x))) bad.push(`${k}: 英文里有汉字`);
      if (!zv.join("").trim()) bad.push(`${k}: 空的`);
    }
    expect(bad).toEqual([]);
  });

  it("命令被拒的原因：每条中英都有，占位符一样，英文没有汉字", () => {
    const bad = Object.entries(ERRORS).filter(([, v]) => params(v.zh).join() !== params(v.en).join() || /[一-鿿]/.test(v.en));
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it("英文单复数对；第一次按浏览器语言选", () => {
    expect(fmt(en.zero.cutsTotal, { n: 1 }, "en")).toBe("1 cut in total");
    expect(fmt(en.zero.cutsTotal, { n: 3 }, "en")).toBe("3 cuts in total");
    expect(fmt(zh.zero.cutsTotal, { n: 3 }, "zh")).toBe("一共 3 卡");
    expect(detectLang(["zh-CN", "en"])).toBe("zh");
    expect(detectLang(["zh-TW"])).toBe("zh");
    expect(detectLang(["en-CA", "zh"])).toBe("en");
    expect(detectLang(["fr-FR"])).toBe("en");
  });
});
