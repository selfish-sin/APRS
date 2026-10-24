/**
 * 交成果时挂的链接（SPEC §15.1）：认平台和类型 · 格式检查 · 会过期 / 要权限的提示。
 *
 * 平台规则是一张纯数据表：域名 + 路径 → 平台 · 类型 · 会不会过期 · 要不要权限。每条规则都有测试（links.test.ts）。
 * 浏览器不能替你去打开别家的网站看能不能打开（对方不让），所以「打不开」由审核员手动标（命令 link.mark_broken）。
 */

export type LinkKind = "file" | "folder" | "sheet" | "doc";
export const LINK_KINDS: readonly LinkKind[] = ["file", "folder", "sheet", "doc"];
export const LINK_KIND_LABEL: Record<LinkKind, { zh: string; en: string }> = {
  file: { zh: "文件", en: "File" },
  folder: { zh: "文件夹", en: "Folder" },
  sheet: { zh: "表格", en: "Spreadsheet" },
  doc: { zh: "文档", en: "Document" },
};

export interface Text2 {
  zh: string;
  en: string;
}

export interface PlatformRule {
  /** 平台的 key（界面上的小标按它画）。 */
  platform: string;
  platformLabel: Text2;
  /** 境内 / 境外。 */
  region: "cn" | "intl";
  /** 域名：完全一样，或者是它的子域名（`.feishu.cn` 这种写法 = 只认子域名）。 */
  hosts: string[];
  /** 路径（含查询串）要对得上；不写 = 这个域名下都算。 */
  path?: RegExp;
  /** 再细一点的条件（例如 Discord 附件带不带 ex=）。 */
  test?: (u: URL) => boolean;
  type: string;
  typeLabel: Text2;
  kind: LinkKind;
  expires: boolean;
  needsAccess: boolean;
}

const t = (zh: string, en: string): Text2 => ({ zh, en });

const FEISHU = ["feishu.cn", ".feishu.cn", "larksuite.com", ".larksuite.com", ".larkoffice.com", "larkoffice.com"];
const GOOGLE_DOCS = ["docs.google.com"];
const DROPBOX = ["dropbox.com", "www.dropbox.com", "dl.dropboxusercontent.com"];
const ONEDRIVE = ["onedrive.live.com", "1drv.ms", ".sharepoint.com"];

/**
 * 从上往下找第一条对得上的。同一个平台里，具体的路径写在前面，兜底的（不写 path）写在后面。
 */
export const PLATFORM_RULES: PlatformRule[] = [
  // —— 境内 ——
  { platform: "feishu", platformLabel: t("飞书", "Feishu"), region: "cn", hosts: FEISHU, path: /^\/(docx|docs)\//, type: "doc", typeLabel: t("文档", "Doc"), kind: "doc", expires: false, needsAccess: true },
  { platform: "feishu", platformLabel: t("飞书", "Feishu"), region: "cn", hosts: FEISHU, path: /^\/sheets\//, type: "sheet", typeLabel: t("表格", "Sheet"), kind: "sheet", expires: false, needsAccess: true },
  { platform: "feishu", platformLabel: t("飞书", "Feishu"), region: "cn", hosts: FEISHU, path: /^\/base\//, type: "base", typeLabel: t("多维表格", "Base"), kind: "sheet", expires: false, needsAccess: true },
  { platform: "feishu", platformLabel: t("飞书", "Feishu"), region: "cn", hosts: FEISHU, path: /^\/wiki\//, type: "wiki", typeLabel: t("知识库", "Wiki"), kind: "doc", expires: false, needsAccess: true },
  { platform: "feishu", platformLabel: t("飞书", "Feishu"), region: "cn", hosts: FEISHU, path: /^\/file\//, type: "file", typeLabel: t("文件", "File"), kind: "file", expires: false, needsAccess: true },
  { platform: "feishu", platformLabel: t("飞书", "Feishu"), region: "cn", hosts: FEISHU, path: /^\/drive\/folder\//, type: "folder", typeLabel: t("云盘文件夹", "Drive folder"), kind: "folder", expires: false, needsAccess: true },
  { platform: "feishu", platformLabel: t("飞书", "Feishu"), region: "cn", hosts: FEISHU, type: "link", typeLabel: t("链接", "Link"), kind: "file", expires: false, needsAccess: true },
  { platform: "tencent_docs", platformLabel: t("腾讯文档", "Tencent Docs"), region: "cn", hosts: ["docs.qq.com"], path: /^\/sheet\//, type: "sheet", typeLabel: t("表格", "Sheet"), kind: "sheet", expires: false, needsAccess: true },
  { platform: "tencent_docs", platformLabel: t("腾讯文档", "Tencent Docs"), region: "cn", hosts: ["docs.qq.com"], type: "doc", typeLabel: t("文档", "Doc"), kind: "doc", expires: false, needsAccess: true },
  { platform: "qq_flash", platformLabel: t("QQ 闪传", "QQ Flash Transfer"), region: "cn", hosts: ["qfile.qq.com"], type: "file", typeLabel: t("文件", "File"), kind: "file", expires: true, needsAccess: false },
  { platform: "qq_group", platformLabel: t("QQ 群文件", "QQ group files"), region: "cn", hosts: ["qun.qq.com", ".qun.qq.com", "pan.qun.qq.com", "groupfile.qq.com"], type: "file", typeLabel: t("群文件", "Group file"), kind: "file", expires: true, needsAccess: false },
  { platform: "baidu_pan", platformLabel: t("百度网盘", "Baidu Netdisk"), region: "cn", hosts: ["pan.baidu.com", "yun.baidu.com"], type: "share", typeLabel: t("分享", "Share"), kind: "file", expires: false, needsAccess: false },
  { platform: "aliyun_drive", platformLabel: t("阿里云盘", "Alibaba Cloud Drive"), region: "cn", hosts: ["alipan.com", "www.alipan.com", "aliyundrive.com", "www.aliyundrive.com"], type: "share", typeLabel: t("分享", "Share"), kind: "file", expires: false, needsAccess: false },
  { platform: "shimo", platformLabel: t("石墨", "Shimo"), region: "cn", hosts: ["shimo.im", ".shimo.im"], path: /^\/sheets\//, type: "sheet", typeLabel: t("表格", "Sheet"), kind: "sheet", expires: false, needsAccess: false },
  { platform: "shimo", platformLabel: t("石墨", "Shimo"), region: "cn", hosts: ["shimo.im", ".shimo.im"], path: /^\/folder\//, type: "folder", typeLabel: t("文件夹", "Folder"), kind: "folder", expires: false, needsAccess: false },
  { platform: "shimo", platformLabel: t("石墨", "Shimo"), region: "cn", hosts: ["shimo.im", ".shimo.im"], type: "doc", typeLabel: t("文档", "Doc"), kind: "doc", expires: false, needsAccess: false },

  // —— 境外 ——
  { platform: "google", platformLabel: t("Google", "Google"), region: "intl", hosts: GOOGLE_DOCS, path: /^\/document\//, type: "docs", typeLabel: t("Docs 文档", "Docs"), kind: "doc", expires: false, needsAccess: true },
  { platform: "google", platformLabel: t("Google", "Google"), region: "intl", hosts: GOOGLE_DOCS, path: /^\/spreadsheets\//, type: "sheets", typeLabel: t("Sheets 表格", "Sheets"), kind: "sheet", expires: false, needsAccess: true },
  { platform: "google", platformLabel: t("Google", "Google"), region: "intl", hosts: GOOGLE_DOCS, path: /^\/presentation\//, type: "slides", typeLabel: t("Slides 演示", "Slides"), kind: "doc", expires: false, needsAccess: true },
  { platform: "google", platformLabel: t("Google", "Google"), region: "intl", hosts: [...GOOGLE_DOCS, "forms.gle"], path: /^\/(forms\/|[A-Za-z0-9_-]+$)/, test: (u) => u.hostname === "forms.gle" || u.pathname.startsWith("/forms/"), type: "forms", typeLabel: t("Forms 表单", "Forms"), kind: "doc", expires: false, needsAccess: true },
  { platform: "google", platformLabel: t("Google", "Google"), region: "intl", hosts: GOOGLE_DOCS, type: "docs", typeLabel: t("文档", "Doc"), kind: "doc", expires: false, needsAccess: true },
  { platform: "google", platformLabel: t("Google", "Google"), region: "intl", hosts: ["drive.google.com"], path: /^\/drive\/(u\/\d+\/)?folders\//, type: "drive_folder", typeLabel: t("Drive 文件夹", "Drive folder"), kind: "folder", expires: false, needsAccess: true },
  { platform: "google", platformLabel: t("Google", "Google"), region: "intl", hosts: ["drive.google.com"], type: "drive_file", typeLabel: t("Drive 文件", "Drive file"), kind: "file", expires: false, needsAccess: true },
  { platform: "dropbox", platformLabel: t("Dropbox", "Dropbox"), region: "intl", hosts: DROPBOX, path: /^\/(scl\/fo|sh)\//, type: "folder", typeLabel: t("文件夹", "Folder"), kind: "folder", expires: false, needsAccess: true },
  { platform: "dropbox", platformLabel: t("Dropbox", "Dropbox"), region: "intl", hosts: DROPBOX, type: "file", typeLabel: t("文件", "File"), kind: "file", expires: false, needsAccess: true },
  { platform: "discord", platformLabel: t("Discord", "Discord"), region: "intl", hosts: ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"], path: /^\/channels\//, type: "message", typeLabel: t("消息", "Message"), kind: "doc", expires: false, needsAccess: true },
  { platform: "discord", platformLabel: t("Discord", "Discord"), region: "intl", hosts: ["cdn.discordapp.com", "media.discordapp.net"], path: /^\/attachments\//, test: (u) => u.searchParams.has("ex"), type: "attachment", typeLabel: t("附件", "Attachment"), kind: "file", expires: true, needsAccess: false },
  { platform: "discord", platformLabel: t("Discord", "Discord"), region: "intl", hosts: ["cdn.discordapp.com", "media.discordapp.net"], type: "attachment", typeLabel: t("附件", "Attachment"), kind: "file", expires: false, needsAccess: false },
  { platform: "onedrive", platformLabel: t("OneDrive / SharePoint", "OneDrive / SharePoint"), region: "intl", hosts: ONEDRIVE, path: /^\/:x:\//, type: "excel", typeLabel: t("Excel 表格", "Excel"), kind: "sheet", expires: false, needsAccess: true },
  { platform: "onedrive", platformLabel: t("OneDrive / SharePoint", "OneDrive / SharePoint"), region: "intl", hosts: ONEDRIVE, path: /^\/:[wp]:\//, type: "office", typeLabel: t("Office 文档", "Office document"), kind: "doc", expires: false, needsAccess: true },
  { platform: "onedrive", platformLabel: t("OneDrive / SharePoint", "OneDrive / SharePoint"), region: "intl", hosts: ONEDRIVE, path: /^\/:f:\//, type: "folder", typeLabel: t("文件夹", "Folder"), kind: "folder", expires: false, needsAccess: true },
  { platform: "onedrive", platformLabel: t("OneDrive / SharePoint", "OneDrive / SharePoint"), region: "intl", hosts: ONEDRIVE, type: "file", typeLabel: t("文件", "File"), kind: "file", expires: false, needsAccess: true },
  { platform: "box", platformLabel: t("Box", "Box"), region: "intl", hosts: ["box.com", ".box.com"], path: /^\/folder\//, type: "folder", typeLabel: t("文件夹", "Folder"), kind: "folder", expires: false, needsAccess: true },
  { platform: "box", platformLabel: t("Box", "Box"), region: "intl", hosts: ["box.com", ".box.com"], type: "file", typeLabel: t("文件", "File"), kind: "file", expires: false, needsAccess: true },
  { platform: "wetransfer", platformLabel: t("WeTransfer", "WeTransfer"), region: "intl", hosts: ["we.tl", "wetransfer.com", ".wetransfer.com"], type: "transfer", typeLabel: t("传输", "Transfer"), kind: "file", expires: true, needsAccess: false },
  { platform: "notion", platformLabel: t("Notion", "Notion"), region: "intl", hosts: ["notion.so", "www.notion.so", ".notion.site"], type: "page", typeLabel: t("页面", "Page"), kind: "doc", expires: false, needsAccess: true },
  { platform: "figma", platformLabel: t("Figma", "Figma"), region: "intl", hosts: ["figma.com", "www.figma.com"], path: /^\/board\//, type: "figjam", typeLabel: t("FigJam 白板", "FigJam board"), kind: "doc", expires: false, needsAccess: true },
  { platform: "figma", platformLabel: t("Figma", "Figma"), region: "intl", hosts: ["figma.com", "www.figma.com"], path: /^\/proto\//, type: "prototype", typeLabel: t("原型", "Prototype"), kind: "doc", expires: false, needsAccess: true },
  { platform: "figma", platformLabel: t("Figma", "Figma"), region: "intl", hosts: ["figma.com", "www.figma.com"], type: "design", typeLabel: t("设计稿", "Design file"), kind: "doc", expires: false, needsAccess: true },
  { platform: "icloud", platformLabel: t("iCloud 云盘", "iCloud Drive"), region: "intl", hosts: ["icloud.com", "www.icloud.com"], path: /^\/iclouddrive\//, type: "file", typeLabel: t("文件", "File"), kind: "file", expires: false, needsAccess: false },
  { platform: "mega", platformLabel: t("MEGA", "MEGA"), region: "intl", hosts: ["mega.nz", "mega.io"], path: /^\/folder\//, type: "folder", typeLabel: t("文件夹", "Folder"), kind: "folder", expires: false, needsAccess: false },
  { platform: "mega", platformLabel: t("MEGA", "MEGA"), region: "intl", hosts: ["mega.nz", "mega.io"], type: "file", typeLabel: t("文件", "File"), kind: "file", expires: false, needsAccess: false },
  { platform: "youtube", platformLabel: t("YouTube", "YouTube"), region: "intl", hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"], type: "video", typeLabel: t("视频", "Video"), kind: "file", expires: false, needsAccess: false },
  { platform: "vimeo", platformLabel: t("Vimeo", "Vimeo"), region: "intl", hosts: ["vimeo.com", "player.vimeo.com"], type: "video", typeLabel: t("视频", "Video"), kind: "file", expires: false, needsAccess: false },
  { platform: "frameio", platformLabel: t("Frame.io", "Frame.io"), region: "intl", hosts: ["frame.io", ".frame.io", "f.io"], type: "review", typeLabel: t("审片", "Review link"), kind: "file", expires: false, needsAccess: false },
];

export interface LinkInfo {
  url: string;
  host: string;
  /** 平台 key；认不出来 = "other"（显示域名）。 */
  platform: string;
  platformLabel: Text2;
  type: string;
  typeLabel: Text2;
  kind: LinkKind;
  expires: boolean;
  needsAccess: boolean;
}

function hostMatches(host: string, patterns: string[]): boolean {
  return patterns.some((p) => (p.startsWith(".") ? host.endsWith(p) : host === p));
}

/** 对得上的第一条规则的位置（-1 = 认不出来）。 */
export function ruleIndex(u: URL): number {
  const host = u.hostname.toLowerCase();
  const path = u.pathname + u.search;
  return PLATFORM_RULES.findIndex((r) => hostMatches(host, r.hosts) && (!r.path || r.path.test(path)) && (!r.test || r.test(u)));
}

export function ruleFor(u: URL): PlatformRule | undefined {
  const i = ruleIndex(u);
  return i >= 0 ? PLATFORM_RULES[i] : undefined;
}

/** 认平台和类型（url 要先过 normalizeLink）。 */
export function recognizeLink(url: string): LinkInfo {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const r = ruleFor(u);
  if (!r) return { url, host, platform: "other", platformLabel: t(host, host), type: "link", typeLabel: t("网址", "Link"), kind: "file", expires: false, needsAccess: false };
  return { url, host, platform: r.platform, platformLabel: r.platformLabel, type: r.type, typeLabel: r.typeLabel, kind: r.kind, expires: r.expires, needsAccess: r.needsAccess };
}

/** 前后要去掉的：空白、中文标点、引号括号。 */
const EDGE = /^[\s\u3000「」『』“”‘’"'（）()《》〈〉【】\[\]，。；：！？、,.;:!?<>]+|[\s\u3000「」『』“”‘’"'（）()《》〈〉【】\[\]，。；：！？、,;:!?<>]+$/g;
const URL_IN_TEXT = /https?:\/\/[^\s\u3000「」『』“”‘’"'（）《》〈〉【】，。；！？、<>]+/i;

export type NormalizedLink = { ok: true; url: string } | { ok: false; reason: "empty" | "scheme" | "invalid" };

/**
 * 格式检查：去掉前后空白和中文标点；整段话里夹着链接（「链接：https://… 提取码：…」）就取出链接；只收 http / https。
 */
export function normalizeLink(raw: unknown): NormalizedLink {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  let s = raw.replace(EDGE, "");
  if (!s) return { ok: false, reason: "empty" };
  const inText = s.match(URL_IN_TEXT);
  if (inText) s = inText[0].replace(EDGE, "");
  if (!/^https?:\/\//i.test(s)) return { ok: false, reason: /^[a-z][a-z0-9+.-]*:/i.test(s) || /^www\./i.test(s) || /\.[a-z]{2,}(\/|$)/i.test(s) ? "scheme" : "invalid" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (!u.hostname || !u.hostname.includes(".")) return { ok: false, reason: "invalid" };
  return { ok: true, url: u.toString() };
}

export const LINK_REASON: Record<"empty" | "scheme" | "invalid", Text2> = {
  empty: t("链接是空的", "The link is empty"),
  scheme: t("只收 http:// 或 https:// 开头的链接", "Only links starting with http:// or https:// are accepted"),
  invalid: t("这不像一个链接", "This doesn't look like a link"),
};

/** 判断两条是不是同一个链接用的：域名小写、去掉末尾的 /、去掉不影响内容的参数（Dropbox 的 dl / raw、utm_*）。 */
export function linkKey(url: string): string {
  const u = new URL(url);
  const drop = new Set(["dl", "raw", "usp", "sharingaction"]);
  const params = Array.from(u.searchParams.entries())
    .filter(([k]) => !drop.has(k.toLowerCase()) && !k.toLowerCase().startsWith("utm_"))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const q = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
  return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${q}`;
}

/** 挂上时的提示（会过期 · 要权限 · 类型对不上）。 */
export interface LinkHint {
  kind: "expires" | "access" | "kind_mismatch";
  text: Text2;
}

export function linkHints(info: LinkInfo, chosenKind?: LinkKind | null): LinkHint[] {
  const out: LinkHint[] = [];
  if (info.expires) out.push({ kind: "expires", text: t("这个链接会过期，建议换成长期能打开的地方再挂（例如飞书）", "This link expires. Better put the file somewhere permanent and link that instead.") });
  if (info.needsAccess) out.push({ kind: "access", text: t("对方要有权限才打开得了，记得把共享设成能看", "Viewers need access to open this. Make sure sharing is set so they can view it.") });
  if (chosenKind && chosenKind !== info.kind && info.platform !== "other" && !(info.kind === "file" && chosenKind !== "folder")) {
    out.push({ kind: "kind_mismatch", text: t(`这是${info.platformLabel.zh}的${info.typeLabel.zh}，却选了「${LINK_KIND_LABEL[chosenKind].zh}」`, `This is a ${info.platformLabel.en} ${info.typeLabel.en}, but it is marked as "${LINK_KIND_LABEL[chosenKind].en}"`) });
  }
  return out;
}

/** 默认的名字：「飞书 表格」「Google Sheets 表格」「example.com」。 */
export function defaultLinkName(info: LinkInfo, lang: "zh" | "en" = "zh"): string {
  if (info.platform === "other") return info.host;
  return `${info.platformLabel[lang]} ${info.typeLabel[lang]}`;
}
