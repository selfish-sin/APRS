/**
 * 成员和账号（SPEC §2 · §10）。第一版是一台设备跑通：管理员给新成员建资料和账号，
 * 账号只存 salt + 哈希；改口令、重置口令都由页面先算好哈希再交给命令。
 */
import { AVATAR_TONE, ROLE, type AvatarToneName, type Id, type Role } from "../model";
import { guarded, insert, isAdmin, mustAdmin, mustBeOneOf, mustGet, mustMember, mustText, ok, rejectT, update } from "./core";
import { uc } from "../text";
import { loginTaken, mustHash, mustLogin, mustNickname, mustSalt, nicknameTaken } from "./validate";

function toneFor(rm: { where: (t: "members") => { tone: AvatarToneName }[] }): AvatarToneName {
  const used = rm.where("members").length;
  return AVATAR_TONE[used % AVATAR_TONE.length];
}

export interface JoinMemberInput {
  nickname: string;
  role?: Role;
  tone?: AvatarToneName;
}

/** 管理员把一个新成员加进工会。 */
export const joinMember = guarded<JoinMemberInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "加成员");
  const nickname = mustNickname(input.nickname);
  if (nicknameTaken(rm, ctx, nickname)) rejectT("invalid", "nickname_taken", { name: uc(nickname) });
  const role = input.role ? mustBeOneOf(input.role, ROLE, "角色") : "member";
  const tone = input.tone ? mustBeOneOf(input.tone, AVATAR_TONE, "头像色") : toneFor(rm);
  const m = insert(ctx, "members", { nickname, role, joinedAt: ctx.worldNow, tone });
  return ok([m.change], { memberId: m.row.id });
});

export interface SetRoleInput {
  memberId: Id;
  role: Role;
}

export const setRole = guarded<SetRoleInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改角色");
  const target = mustGet(rm, ctx, "members", input.memberId, "成员");
  const role = mustBeOneOf(input.role, ROLE, "角色");
  if (target.role === "admin" && role !== "admin") {
    const admins = rm.where("members", { role: "admin" }).filter((m) => m.worldId === ctx.worldId);
    if (admins.length <= 1) rejectT("state", "last_admin");
  }
  const ch = update("members", target, { role });
  return ok(ch ? [ch] : []);
});

export interface UpdateMemberInput {
  memberId: Id;
  nickname?: string;
  tone?: AvatarToneName;
}

/** 改昵称 / 头像色：自己或管理员。 */
export const updateMember = guarded<UpdateMemberInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const target = mustGet(rm, ctx, "members", input.memberId, "成员");
  if (target.id !== me.id && !isAdmin(me)) rejectT("forbidden", "profile_own_only");
  const patch: { nickname?: string; tone?: AvatarToneName } = {};
  if (input.nickname !== undefined) {
    const nickname = mustNickname(input.nickname);
    if (nicknameTaken(rm, ctx, nickname, target.id)) rejectT("invalid", "nickname_taken", { name: uc(nickname) });
    patch.nickname = nickname;
  }
  if (input.tone !== undefined) patch.tone = mustBeOneOf(input.tone, AVATAR_TONE, "头像色");
  const ch = update("members", target, patch);
  const changes = ch ? [ch] : [];
  if (patch.nickname) {
    for (const a of rm.where("accounts", { memberId: target.id })) {
      const c = update("accounts", a, { displayName: patch.nickname });
      if (c) changes.push(c);
    }
  }
  return ok(changes);
});

export interface CreateAccountInput {
  memberId: Id;
  login: string;
  salt: string;
  hash: string;
  /** 登录页上显示的名字（默认 = 昵称）。 */
  displayName?: string;
}

/** 管理员给成员建账号（同样只存哈希）。 */
export const createAccount = guarded<CreateAccountInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "建账号");
  const member = mustGet(rm, ctx, "members", input.memberId, "成员");
  if (rm.where("accounts", { memberId: member.id }).length) rejectT("state", "account_exists", { name: uc(member.nickname) });
  const login = mustLogin(input.login);
  if (loginTaken(rm, login)) rejectT("invalid", "login_taken", { login });
  const displayName = input.displayName ? mustText(input.displayName, "账号名字", 16) : member.nickname;
  const a = insert(ctx, "accounts", { login, displayName, memberId: member.id, salt: mustSalt(input.salt), hash: mustHash(input.hash) });
  return ok([a.change], { accountId: a.row.id });
});

export interface SetPasscodeInput {
  accountId: Id;
  salt: string;
  hash: string;
}

/** 改自己的口令，或管理员重置别人的口令。 */
export const setPasscode = guarded<SetPasscodeInput>((rm, input, ctx) => {
  const me = mustMember(rm, ctx);
  const account = mustGet(rm, ctx, "accounts", input.accountId, "账号");
  if (account.memberId !== me.id && !isAdmin(me)) rejectT("forbidden", "reset_forbidden");
  const ch = update("accounts", account, { salt: mustSalt(input.salt), hash: mustHash(input.hash) });
  return ok(ch ? [ch] : []);
});

export interface SetLangInput {
  lang: "zh" | "en";
}

/** 记下这个账号用哪种界面语言（SPEC §16）。 */
export const setAccountLang = guarded<SetLangInput>((rm, input, ctx) => {
  mustMember(rm, ctx);
  if (!ctx.accountId) rejectT("forbidden", "login_first");
  const a = mustGet(rm, ctx, "accounts", ctx.accountId, "账号");
  const lang = mustBeOneOf(input.lang, ["zh", "en"] as const, "语言");
  const c = update("accounts", a, { lang });
  return ok(c ? [c] : [], { accountId: a.id });
});
