/**
 * 示范盘点（SPEC §18.9）：「安娜的旅程」一次已经读进来、还没复查完的盘点；「（示范）星期三的猫」一次已经写回的盘点。
 * 文件名照命名规范编的（覆盖几种问题），缩略图是代码画的占位图（demoThumbs.ts，标「示范」）——不是任何真实文件。
 */
import type { AuditItemInput } from "@/domain/commands/audit";
import type { AuditFileInfo } from "@/domain/model";
import { demoThumb, type DemoThumbKind } from "./demoThumbs";

const MTIME = "2026-10-22T10:00:00.000Z";
const pad = (n: number, w: number) => String(n).padStart(w, "0");

function item(path: string, kind: DemoThumbKind | null, label: string, info: AuditFileInfo, size = 4_200_000): AuditItemInput {
  const name = path.split("/").pop()!;
  const t = kind ? demoThumb(kind, label) : null;
  return {
    name,
    path,
    size,
    mtime: MTIME,
    origin: "file",
    fingerprint: `${size}:${MTIME}:${t?.sha256 ?? ""}:${path}`,
    thumb: t ? { sha256: t.sha256, mime: "image/svg+xml", width: t.width, height: t.height } : null,
    info,
    demo: true,
  };
}

const clipInfo = (seconds: number, folders: string[]): AuditFileInfo => ({ kind: "clip", canvas: { width: 1920, height: 1080, dpi: 350 }, fps: 24, frames: Math.round(seconds * 24), seconds, folders });
const png: AuditFileInfo = { kind: "image", canvas: { width: 1920, height: 1080, dpi: null } };

/** 安娜的旅程 · 拖进来的 EP01 文件夹（编的）。 */
export function andlcAuditItems(): AuditItemInput[] {
  const out: AuditItemInput[] = [];
  const P = "ANDLC_EP01";
  const cut = (n: number) => `CUT${pad(n, 3)}`;
  // 项目级：策划 · 剧本 · 分镜 · 美术设计 · 色指定（文档的占位图）
  for (const [code, folder] of [["PLAN", "策划"], ["SCR", "剧本"], ["STB", "分镜"], ["ART", "设定"], ["COL", "色指定"]] as const) {
    out.push(item(`EP01/${folder}/${P}_${code}_v01.pdf`, "doc", code, { kind: "other" }, 2_400_000));
  }
  for (let n = 1; n <= 14; n++) {
    const c = cut(n);
    const C = `C${pad(n, 3)}`;
    // Layout：C011 没有；C004 没补零
    if (n !== 11) out.push(item(`EP01/LO/SC001/${c}/${P}_SC001_${n === 4 ? "CUT4" : c}_LO_v01.clip`, "lo", `${C} · LO · v01`, clipInfo(5, ["参考", "原画", "标注"])));
    // 原画：C011 没有；C009 放到了 /CUT008/ 里
    if (n !== 11) out.push(item(`EP01/H/SC001/${n === 9 ? cut(8) : c}/${P}_SC001_${c}_H_v01.clip`, "key", `${C} · H · v01`, clipInfo(5, ["原画", "修线"])));
    // 清线：A · B；C014 B 没有；C008 B 同一版两个文件
    for (const layer of ["A", "B"]) {
      if (n === 14 && layer === "B") continue;
      out.push(item(`EP01/CLN/SC001/${c}/${P}_SC001_${c}_${layer}_CLN_v01.png`, "clean", `${C} · ${layer} · CLN · v01`, png, 1_800_000));
      if (n === 8 && layer === "B") out.push(item(`EP01/CLN/SC001/${c}/${P}_SC001_${c}_${layer}_CLN_v01改.png`, "clean", `${C} · ${layer} · CLN · v01改`, png, 1_900_000));
    }
    // 中割：照系统里交到的那一版；C011 A 没找到；C011 B 有文件系统没记；C010 B 版本后面带了字；C014 A 同一版两个文件
    const ibVersion: Record<string, number> = { "3A": 2, "4B": 2, "6B": 2, "9B": 3, "10B": 5 };
    for (const layer of ["A", "B"]) {
      if (n === 11 && layer === "A") continue;
      const v = ibVersion[`${n}${layer}`] ?? 1;
      const note = n === 10 && layer === "B" ? "改" : "";
      const secs = n === 13 ? 6 : 5;
      out.push(item(`EP01/ANI/SC001/${c}/${P}_SC001_${c}_${layer}_ANI_v${pad(v, 2)}${note}.clip`, "ib", `${C} · ${layer} · ANI · v${pad(v, 2)}${note}`, clipInfo(secs, ["原画", "修线", "动画"])));
      if (n === 14 && layer === "A") out.push(item(`EP01/ANI/SC001/${c}/${P}_SC001_${c}_${layer}_ANI_v01第一次修改后.clip`, "ib", `${C} · A · ANI · v01*`, clipInfo(6, ["原画", "修线", "动画"])));
    }
    // 场景：C001–C005 有文件、系统里还没记
    if (n <= 5) out.push(item(`EP01/BG/SC001/${c}/${P}_SC001_${c}_BG_v01.png`, "bg", `${C} · BG · v01`, png, 3_100_000));
  }
  // 卡不在卡表里 · 不认识的流程代码 · 不是这个项目的 · 认不出的
  out.push(item(`EP01/ANI/SC001/CUT021/${P}_SC001_CUT021_A_ANI_v01.clip`, "ib", "CUT021 · ANI", clipInfo(5, ["动画"])));
  out.push(item(`EP01/ANI/SC001/CUT012/${P}_SC001_CUT012_A_ANM_v02.png`, "ib", "C012 · ANM · v02", png));
  out.push(item(`EP01/ANI/DMDS_EP01_SC001_CUT002_A_ANI_v01.png`, "ib", "DMDS", png));
  out.push(item(`EP01/.DS_Store`, null, "", { kind: "other" }, 6_148));
  out.push(item(`EP01/ANI/SC001/CUT005/${P}_SC001_CUT005_A_ANI_v04.rar`, null, "", { kind: "archive" }, 17_900_000));
  return out;
}

/** 星期三的猫 · 粘贴的名字（只有策划 · 剧本，写回过了）。 */
export function catAuditItems(): AuditItemInput[] {
  return [
    item("XQSM/策划/XQSM_EP01_PLAN_v01.pdf", "doc", "PLAN · v01", { kind: "other" }, 900_000),
    item("XQSM/剧本/XQSM_EP01_SCR_v01.pdf", "doc", "SCR · v01", { kind: "other" }, 600_000),
    item("XQSM/剧本/XQSM_EP01_SCR_v02.pdf", "doc", "SCR · v02", { kind: "other" }, 640_000),
    item("XQSM/分镜/XQSM_EP01_STB_v01.pdf", "doc", "STB · v01", { kind: "other" }, 5_200_000),
  ];
}
