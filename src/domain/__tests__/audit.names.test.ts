import { describe, expect, it } from "vitest";
import { folderHints, namesFromPaste, parseName, splitExt, toHalfWidth } from "@/domain/audit/names";

const ctx = { projectCode: "ANDLC", stageCodes: ["PLAN", "SCR", "STB", "ART", "COL", "LO", "H", "CLN", "ANI", "CMP", "BG", "SND", "FIN"] };
const codes = (name: string) => parseName(name, ctx).issues.map((i) => i.code);

describe("读名字（SPEC §18.4）", () => {
  it("规范的名字：每一段都认出来，没有问题", () => {
    const p = parseName("ANDLC_EP01_SC001_CUT005_A_ANI_v04.clip", ctx);
    expect(p).toMatchObject({ kind: "cut", project: "ANDLC", episode: "EP01", scene: "SC001", cut: { number: 5, suffix: "" }, layer: "A", code: "ANI", version: 4, note: null, exts: ["clip"], foreign: false });
    expect(p.issues).toEqual([]);
    expect(p.canonical).toBe("ANDLC_EP01_SC001_CUT005_A_ANI_v04");
    expect(p.parts.map((x) => x.as)).toEqual(["project", "episode", "scene", "cut", "layer", "code", "version"]);
  });

  it("去扩展名（双扩展名）· 全角转半角 · 去前后空格", () => {
    expect(splitExt("a_b_v01.clip.rar")).toEqual({ base: "a_b_v01", exts: ["clip", "rar"] });
    expect(splitExt("a_b_v01.png")).toEqual({ base: "a_b_v01", exts: ["png"] });
    expect(toHalfWidth("ＡＮＤＬＣ＿ＥＰ０１")).toBe("ANDLC_EP01");
    const p = parseName("  ＡＮＤＬＣ＿EP01_SC001_CUT005_A_ANI_v04.clip.rar ", ctx);
    expect(p.canonical).toBe("ANDLC_EP01_SC001_CUT005_A_ANI_v04");
    expect(p.exts).toEqual(["clip", "rar"]);
  });

  it("版本号后面带了字：收下来当备注，建议改成下一个版本号", () => {
    const p = parseName("ANDLC_EP01_SC001_CUT014_A_ANI_v02第一次修改后.clip", ctx);
    expect(p.version).toBe(2);
    expect(p.note).toBe("第一次修改后");
    expect(p.issues).toEqual([{ code: "version_note", params: { note: "第一次修改后", want: "v03" } }]);
    expect(p.canonical).toBe("ANDLC_EP01_SC001_CUT014_A_ANI_v02");
    expect(parseName("ANDLC_EP01_SC001_CUT014_A_ANI_v02_final.png", ctx).note).toBe("final");
  });

  it("项目级的文件（没有场景 / 镜头 / 层）", () => {
    const p = parseName("ANDLC_EP01_STB_v03.pdf", ctx);
    expect(p).toMatchObject({ kind: "project", code: "STB", version: 3, cut: null, scene: null });
    expect(p.issues).toEqual([]);
  });

  it("插进去的卡（CUT005a）", () => {
    expect(parseName("ANDLC_EP01_SC001_CUT005a_A_ANI_v01.png", ctx).cut).toEqual({ number: 5, suffix: "a" });
  });

  it("项目代号差一两个字母：是不是 ANDLC？完全不一样：不是这个项目的", () => {
    expect(parseName("ANLDC_EP01_SC001_CUT005_A_ANI_v04.clip", ctx).issues).toContainEqual({ code: "project_typo", params: { got: "ANLDC", want: "ANDLC" } });
    const other = parseName("DMDS_EP01_SC001_CUT002_A_ANI_v01.clip", ctx);
    expect(other.foreign).toBe(true);
    expect(other.kind).toBe("cut");
  });

  it("没补零 · 大小写不统一：照样认出来，说应写成什么", () => {
    const p = parseName("ANDLC_EP1_SC1_CUT5_A_ANI_v4.clip", ctx);
    expect(p.cut?.number).toBe(5);
    expect(p.issues).toEqual(
      expect.arrayContaining([
        { code: "no_pad", params: { got: "EP1", want: "EP01" } },
        { code: "no_pad", params: { got: "SC1", want: "SC001" } },
        { code: "no_pad", params: { got: "CUT5", want: "CUT005" } },
        { code: "no_pad", params: { got: "v4", want: "v04" } },
      ])
    );
    expect(codes("ANDLC_EP01_SC001_cut005_a_ani_V04.clip")).toEqual(["case", "case", "case", "case"]);
    expect(parseName("ANDLC_EP01_SC001_cut005_a_ani_V04.clip", ctx).canonical).toBe("ANDLC_EP01_SC001_CUT005_A_ANI_v04");
  });

  it("不认识的流程代码：给最像的那个", () => {
    expect(parseName("ANDLC_EP01_SC001_CUT005_A_ANM_v04.clip", ctx).issues).toContainEqual({ code: "unknown_code", params: { got: "ANM", want: "ANI" } });
    expect(parseName("ANDLC_EP01_SC001_CUT005_A_QQQQ_v04.clip", ctx).issues).toContainEqual({ code: "unknown_code", params: { got: "QQQQ", want: "" } });
  });

  it("不认识的层", () => {
    expect(parseName("ANDLC_EP01_SC001_CUT005_AB_ANI_v04.clip", ctx).issues).toContainEqual({ code: "unknown_layer", params: { got: "AB" } });
  });

  it("顺序不对 · 少一段", () => {
    expect(codes("ANDLC_EP01_CUT005_SC001_A_ANI_v04.clip")).toContain("order");
    expect(parseName("ANDLC_EP01_SC001_CUT005_A_ANI.clip", ctx).issues).toContainEqual({ code: "missing", params: { what: "version" } });
    expect(parseName("ANDLC_EP01_SC001_CUT005_A_v04.clip", ctx).issues).toContainEqual({ code: "missing", params: { what: "code" } });
    // BG 既是层也是流程：只有一段时当流程（背景）
    expect(parseName("ANDLC_EP01_SC001_CUT005_BG_v01.png", ctx)).toMatchObject({ code: "BG", layer: null });
    expect(parseName("ANDLC_EP01_SC001_CUT005_BG_CMP_v01.png", ctx)).toMatchObject({ code: "CMP", layer: "BG" });
  });

  it("认不出的文件", () => {
    for (const n of [".DS_Store", "截图-20261023-0950.png", "IMG_1234.png", "README.txt"]) expect(parseName(n, ctx).kind, n).toBe("none");
  });

  it("粘贴的列表：每行找像规范文件名的一段；认出整条路径", () => {
    const text = [
      "ANDLC_EP01_SC001_CUT001_A_ANI_v02.clip    18.2 MB   2026-10-20 14:02   测试员",
      "名称\t大小\t修改时间",
      "/EP01/ANI/SC001/CUT002/ANDLC_EP01_SC001_CUT002_B_ANI_v01.clip 3MB",
      "· ANDLC_EP01_STB_v03.pdf，上传者 测试员",
      "随便一行字",
    ].join("\n");
    expect(namesFromPaste(text)).toEqual([
      { name: "ANDLC_EP01_SC001_CUT001_A_ANI_v02.clip", path: null },
      { name: "ANDLC_EP01_SC001_CUT002_B_ANI_v01.clip", path: "/EP01/ANI/SC001/CUT002/ANDLC_EP01_SC001_CUT002_B_ANI_v01.clip" },
      { name: "ANDLC_EP01_STB_v03.pdf", path: null },
    ]);
  });

  it("从文件夹路径认出 卡 · 流程", () => {
    expect(folderHints("/EP01/ANI/SC001/CUT005/x.clip")).toEqual({ cut: 5, code: "ANI", episode: "EP01", scene: "SC001" });
    expect(folderHints(null)).toEqual({ cut: null, code: null, episode: null, scene: null });
  });
});
