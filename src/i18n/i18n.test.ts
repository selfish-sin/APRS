import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ERRORS } from "@/domain/errors";
import { WHAT_EN } from "@/domain/what";
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

const params = (s: string) => Array.from(new Set(Array.from(s.matchAll(/\{\^?(\w+)\}/g)).map((m) => m[1]))).sort();

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

  it("命令里写的中文「什么」都有英文（被拒的原因拼英文时用）", () => {
    const dir = join(process.cwd(), "src/domain/commands");
    const pats = [
      /mustText\([^,()]+,\s*"([^"]+)"/g,
      /mustGet\(rm,\s*ctx,\s*"\w+",\s*[^,]+,\s*"([^"]+)"/g,
      /mustBeOneOf\([^,]+,\s*[^,]+,\s*"([^"]+)"\)/g,
      /opt(?:Date|Url|When|Number|DateTime|Integer|Link)\([^,()]+,\s*"([^"]+)"/g,
      /mustAdmin\(rm,\s*ctx,\s*"([^"]+)"\)/g,
      /mustNumber\([^,()]+,\s*"([^"]+)"/g,
      /\bint\([^,()]+,\s*"([^"]+)"/g,
      /\bratio\([^,()]+,\s*"([^"]+)"\)/g,
      /checkKey\([^,()]+,\s*"([^"]+)"\)/g,
    ];
    const missing = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const re of pats) for (const m of Array.from(src.matchAll(re))) if (/[一-鿿]/.test(m[1]) && !(m[1] in WHAT_EN)) missing.add(`${f}: ${m[1]}`);
    }
    expect(Array.from(missing)).toEqual([]);
    expect(Object.values(WHAT_EN).filter((v) => /[一-鿿]/.test(v))).toEqual([]);
  });

  it("被拒的原因：参数是用户写的照原样，英文句首大写", async () => {
    const { errorText } = await import("./I18n");
    expect(errorText({ message: "", key: "empty", params: { what: { zh: "项目名字", en: "project name" } } }, "en")).toBe("Project name can't be empty.");
    expect(errorText({ message: "", key: "nickname_taken", params: { name: { uc: "青柠" } } }, "en")).toBe("Someone is already called “青柠”. Pick another nickname.");
    expect(errorText({ message: "", key: "claim_full", params: { n: 1, stage: { zh: "中割", en: "In-between" } } }, "en")).toBe("You already have 1 “In-between” task. Hand one in first.");
    expect(errorText({ message: "", key: "claim_full", params: { n: 3, stage: { zh: "中割", en: "In-between" } } }, "zh")).toBe("你手上已经有 3 张「中割」了，先交掉一张");
  });
});

describe("日期 · 数字 · 时间按语言（SPEC §16）", () => {
  it("10月23日 周五 / Fri, Oct 23；数字千分位；相对时间", async () => {
    const f = await import("./format");
    expect(f.fmtDay("2026-10-23", "zh")).toBe("10月23日 周五");
    expect(f.fmtDay("2026-10-23", "en")).toBe("Fri, Oct 23");
    expect(f.fmtNumber(1234.5, "en")).toBe("1,234.5");
    expect(f.fmtRelative("2026-10-22T10:00:00+08:00", "2026-10-23T10:00:00+08:00", "zh")).toBe("昨天");
    expect(f.fmtRelative("2026-10-22T10:00:00+08:00", "2026-10-23T10:00:00+08:00", "en")).toBe("yesterday");
  });
});
