import { describe, expect, it } from "vitest";
import { PLATFORM_RULES, defaultLinkName, linkHints, linkKey, normalizeLink, recognizeLink, ruleIndex } from "@/domain/links";

/** 每条规则一个真实形状的例子（id 都是编的）。 */
const EXAMPLES: [string, { platform: string; type: string; kind: string; expires: boolean; needsAccess: boolean }][] = [
  ["https://abc123.feishu.cn/docx/AbCdEfGh1234", { platform: "feishu", type: "doc", kind: "doc", expires: false, needsAccess: true }],
  ["https://abc123.feishu.cn/sheets/ShtFake0001?sheet=0a1b2c", { platform: "feishu", type: "sheet", kind: "sheet", expires: false, needsAccess: true }],
  ["https://abc123.feishu.cn/base/BascFake0001?table=tbl1", { platform: "feishu", type: "base", kind: "sheet", expires: false, needsAccess: true }],
  ["https://abc123.feishu.cn/wiki/WikFake0001", { platform: "feishu", type: "wiki", kind: "doc", expires: false, needsAccess: true }],
  ["https://abc123.feishu.cn/file/BoxFake0001", { platform: "feishu", type: "file", kind: "file", expires: false, needsAccess: true }],
  ["https://abc123.feishu.cn/drive/folder/FldFake0001", { platform: "feishu", type: "folder", kind: "folder", expires: false, needsAccess: true }],
  ["https://abc123.feishu.cn/minutes/obcnFake", { platform: "feishu", type: "link", kind: "file", expires: false, needsAccess: true }],
  ["https://docs.qq.com/sheet/DFakeSheet01", { platform: "tencent_docs", type: "sheet", kind: "sheet", expires: false, needsAccess: true }],
  ["https://docs.qq.com/doc/DFakeDoc01", { platform: "tencent_docs", type: "doc", kind: "doc", expires: false, needsAccess: true }],
  ["https://qfile.qq.com/q/FakeCode01", { platform: "qq_flash", type: "file", kind: "file", expires: true, needsAccess: false }],
  ["https://qun.qq.com/qqweb/qunpro/share?inviteCode=Fake01", { platform: "qq_group", type: "file", kind: "file", expires: true, needsAccess: false }],
  ["https://pan.baidu.com/s/1FakeShareCode", { platform: "baidu_pan", type: "share", kind: "file", expires: false, needsAccess: false }],
  ["https://www.alipan.com/s/FakeShare01", { platform: "aliyun_drive", type: "share", kind: "file", expires: false, needsAccess: false }],
  ["https://shimo.im/sheets/FakeSheet01", { platform: "shimo", type: "sheet", kind: "sheet", expires: false, needsAccess: false }],
  ["https://shimo.im/folder/FakeFolder01", { platform: "shimo", type: "folder", kind: "folder", expires: false, needsAccess: false }],
  ["https://shimo.im/docs/FakeDoc01", { platform: "shimo", type: "doc", kind: "doc", expires: false, needsAccess: false }],
  ["https://docs.google.com/document/d/1FakeDocId/edit", { platform: "google", type: "docs", kind: "doc", expires: false, needsAccess: true }],
  ["https://docs.google.com/spreadsheets/d/1FakeSheetId/edit#gid=0", { platform: "google", type: "sheets", kind: "sheet", expires: false, needsAccess: true }],
  ["https://docs.google.com/presentation/d/1FakeSlidesId/edit", { platform: "google", type: "slides", kind: "doc", expires: false, needsAccess: true }],
  ["https://docs.google.com/forms/d/e/1FakeFormId/viewform", { platform: "google", type: "forms", kind: "doc", expires: false, needsAccess: true }],
  ["https://forms.gle/FakeShort01", { platform: "google", type: "forms", kind: "doc", expires: false, needsAccess: true }],
  ["https://docs.google.com/drawings/d/1FakeDrawId/edit", { platform: "google", type: "docs", kind: "doc", expires: false, needsAccess: true }],
  ["https://drive.google.com/drive/folders/1FakeFolderId", { platform: "google", type: "drive_folder", kind: "folder", expires: false, needsAccess: true }],
  ["https://drive.google.com/drive/u/0/folders/1FakeFolderId", { platform: "google", type: "drive_folder", kind: "folder", expires: false, needsAccess: true }],
  ["https://drive.google.com/file/d/1FakeFileId/view?usp=sharing", { platform: "google", type: "drive_file", kind: "file", expires: false, needsAccess: true }],
  ["https://www.dropbox.com/scl/fo/fakefolder01/AAfake?rlkey=fake&dl=0", { platform: "dropbox", type: "folder", kind: "folder", expires: false, needsAccess: true }],
  ["https://www.dropbox.com/sh/fakeoldfolder/AAfake", { platform: "dropbox", type: "folder", kind: "folder", expires: false, needsAccess: true }],
  ["https://www.dropbox.com/scl/fi/fakefile01/C005.clip?rlkey=fake&dl=0", { platform: "dropbox", type: "file", kind: "file", expires: false, needsAccess: true }],
  ["https://www.dropbox.com/s/fakeold01/C005.clip?dl=0", { platform: "dropbox", type: "file", kind: "file", expires: false, needsAccess: true }],
  ["https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333", { platform: "discord", type: "message", kind: "doc", expires: false, needsAccess: true }],
  ["https://cdn.discordapp.com/attachments/111/222/C005.png?ex=6700aaaa&is=66ff0000&hm=fake", { platform: "discord", type: "attachment", kind: "file", expires: true, needsAccess: false }],
  ["https://media.discordapp.net/attachments/111/222/C005.png?ex=6700aaaa&is=66ff0000&hm=fake", { platform: "discord", type: "attachment", kind: "file", expires: true, needsAccess: false }],
  ["https://cdn.discordapp.com/attachments/111/222/old.png", { platform: "discord", type: "attachment", kind: "file", expires: false, needsAccess: false }],
  ["https://contoso-my.sharepoint.com/:x:/g/personal/fake/EFakeExcel", { platform: "onedrive", type: "excel", kind: "sheet", expires: false, needsAccess: true }],
  ["https://contoso-my.sharepoint.com/:w:/g/personal/fake/EFakeWord", { platform: "onedrive", type: "office", kind: "doc", expires: false, needsAccess: true }],
  ["https://contoso-my.sharepoint.com/:f:/g/personal/fake/EFakeFolder", { platform: "onedrive", type: "folder", kind: "folder", expires: false, needsAccess: true }],
  ["https://1drv.ms/u/s!FakeOneDrive", { platform: "onedrive", type: "file", kind: "file", expires: false, needsAccess: true }],
  ["https://app.box.com/folder/123456789", { platform: "box", type: "folder", kind: "folder", expires: false, needsAccess: true }],
  ["https://app.box.com/s/fakeshare01", { platform: "box", type: "file", kind: "file", expires: false, needsAccess: true }],
  ["https://we.tl/t-FakeTransfer", { platform: "wetransfer", type: "transfer", kind: "file", expires: true, needsAccess: false }],
  ["https://studio.wetransfer.com/downloads/fake01", { platform: "wetransfer", type: "transfer", kind: "file", expires: true, needsAccess: false }],
  ["https://www.notion.so/team/Fake-Page-0123456789abcdef", { platform: "notion", type: "page", kind: "doc", expires: false, needsAccess: true }],
  ["https://team.notion.site/Fake-Page-0123456789abcdef", { platform: "notion", type: "page", kind: "doc", expires: false, needsAccess: true }],
  ["https://www.figma.com/board/FakeBoard01/Retakes", { platform: "figma", type: "figjam", kind: "doc", expires: false, needsAccess: true }],
  ["https://www.figma.com/proto/FakeProto01/Flow", { platform: "figma", type: "prototype", kind: "doc", expires: false, needsAccess: true }],
  ["https://www.figma.com/design/FakeDesign01/Layouts", { platform: "figma", type: "design", kind: "doc", expires: false, needsAccess: true }],
  ["https://www.icloud.com/iclouddrive/0FakeICloud#C005", { platform: "icloud", type: "file", kind: "file", expires: false, needsAccess: false }],
  ["https://mega.nz/folder/FakeFold#FakeKey", { platform: "mega", type: "folder", kind: "folder", expires: false, needsAccess: false }],
  ["https://mega.nz/file/FakeFile#FakeKey", { platform: "mega", type: "file", kind: "file", expires: false, needsAccess: false }],
  ["https://www.youtube.com/watch?v=FakeVideo01", { platform: "youtube", type: "video", kind: "file", expires: false, needsAccess: false }],
  ["https://vimeo.com/123456789", { platform: "vimeo", type: "video", kind: "file", expires: false, needsAccess: false }],
  ["https://f.io/FakeReview", { platform: "frameio", type: "review", kind: "file", expires: false, needsAccess: false }],
];

describe("认平台（SPEC §15.1）", () => {
  it.each(EXAMPLES)("%s", (url, want) => {
    expect(recognizeLink(url)).toMatchObject(want);
  });

  it("每一条规则都有例子", () => {
    const covered = new Set(EXAMPLES.map(([url]) => ruleIndex(new URL(url))));
    const missing = PLATFORM_RULES.map((r, i) => (covered.has(i) ? null : `${r.platform}/${r.type}`)).filter(Boolean);
    expect(missing).toEqual([]);
  });

  it("认不出来的显示域名", () => {
    expect(recognizeLink("https://example.com/a")).toMatchObject({ platform: "other", host: "example.com", kind: "file" });
    expect(defaultLinkName(recognizeLink("https://example.com/a"))).toBe("example.com");
    expect(defaultLinkName(recognizeLink("https://docs.google.com/spreadsheets/d/x/edit"))).toBe("Google Sheets 表格");
    expect(defaultLinkName(recognizeLink("https://docs.google.com/spreadsheets/d/x/edit"), "en")).toBe("Google Sheets");
  });
});

describe("格式检查", () => {
  it("去掉前后空白和中文标点；一段话里取出链接；只收 http / https", () => {
    expect(normalizeLink("  「https://abc.feishu.cn/sheets/x」。 ")).toEqual({ ok: true, url: "https://abc.feishu.cn/sheets/x" });
    expect(normalizeLink("链接：https://pan.baidu.com/s/1abc 提取码：x1y2")).toEqual({ ok: true, url: "https://pan.baidu.com/s/1abc" });
    expect(normalizeLink("（https://we.tl/t-abc）")).toEqual({ ok: true, url: "https://we.tl/t-abc" });
    expect(normalizeLink("ftp://example.com/a")).toEqual({ ok: false, reason: "scheme" });
    expect(normalizeLink("www.example.com/a")).toEqual({ ok: false, reason: "scheme" });
    expect(normalizeLink("javascript:alert(1)")).toEqual({ ok: false, reason: "scheme" });
    expect(normalizeLink("随便写的东西")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeLink("https://localhost/x")).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeLink("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("Dropbox 的 dl=0 / dl=1 算同一条；参数顺序不算", () => {
    expect(linkKey("https://www.dropbox.com/scl/fi/abc/x.clip?rlkey=k&dl=0")).toBe(linkKey("https://www.dropbox.com/scl/fi/abc/x.clip?dl=1&rlkey=k"));
    expect(linkKey("https://docs.google.com/spreadsheets/d/x/edit?usp=sharing")).toBe(linkKey("https://docs.google.com/spreadsheets/d/x/edit/"));
    expect(linkKey("https://a.com/x?id=1")).not.toBe(linkKey("https://a.com/x?id=2"));
  });

  it("提示：会过期 · 要权限 · 类型对不上", () => {
    expect(linkHints(recognizeLink("https://qfile.qq.com/q/abc")).map((h) => h.kind)).toEqual(["expires"]);
    expect(linkHints(recognizeLink("https://cdn.discordapp.com/attachments/1/2/a.png?ex=1")).map((h) => h.kind)).toEqual(["expires"]);
    expect(linkHints(recognizeLink("https://discord.com/channels/1/2/3")).map((h) => h.kind)).toEqual(["access"]);
    expect(linkHints(recognizeLink("https://docs.google.com/spreadsheets/d/x"), "folder").map((h) => h.kind)).toEqual(["access", "kind_mismatch"]);
    expect(linkHints(recognizeLink("https://www.dropbox.com/scl/fo/x/y"), "folder").map((h) => h.kind)).toEqual(["access"]);
    expect(linkHints(recognizeLink("https://example.com/x"), "folder")).toEqual([]);
  });
});
