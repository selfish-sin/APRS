/**
 * 工会本身：建工会（建的人是管理员）· 改规则（时限系数、超时扣不扣分）。
 */
import { AVATAR_TONE, type AvatarToneName } from "../model";
import { DEFAULT_DEADLINE_FACTOR } from "../rules";
import { guarded, insert, mustAdmin, mustBeOneOf, mustGet, mustText, ok, optNumber, rejectT, update } from "./core";
import { mustHash, mustLogin, mustNickname, mustSalt } from "./validate";

export interface CreateGuildInput {
  title: string;
  nickname: string;
  login: string;
  salt: string;
  hash: string;
  tone?: AvatarToneName;
  /** 账号在登录页上显示的名字（默认 = 昵称）。 */
  displayName?: string;
}

/** 建一个全空的工会：工会 + 建的人（管理员）+ 他的账号。只能在还没有工会的世界里跑。 */
export const createGuild = guarded<CreateGuildInput>((rm, input, ctx) => {
  if (rm.get("worlds", ctx.worldId)) rejectT("state", "guild_exists");
  const title = mustText(input.title, "工会名字", 24);
  const nickname = mustNickname(input.nickname);
  const login = mustLogin(input.login);
  const salt = mustSalt(input.salt);
  const hash = mustHash(input.hash);
  const tone = input.tone ? mustBeOneOf(input.tone, AVATAR_TONE, "头像色") : "sage";
  const world = insert(ctx, "worlds", { title, rules: { deadlineFactor: DEFAULT_DEADLINE_FACTOR, expiryPenalty: false } }, ctx.worldId);
  const member = insert(ctx, "members", { nickname, role: "admin", joinedAt: ctx.worldNow, tone });
  const displayName = input.displayName ? mustText(input.displayName, "账号名字", 16) : nickname;
  const account = insert(ctx, "accounts", { login, displayName, memberId: member.row.id, salt, hash });
  return ok([world.change, member.change, account.change], { worldId: ctx.worldId, memberId: member.row.id, accountId: account.row.id });
});

export interface SetRulesInput {
  deadlineFactor?: number;
  expiryPenalty?: boolean;
  title?: string;
}

/** 管理员改规则：时限系数（先设立后修改，只影响以后接的任务）· 超时扣不扣分 · 工会名字。 */
export const setRules = guarded<SetRulesInput>((rm, input, ctx) => {
  mustAdmin(rm, ctx, "改规则");
  const world = mustGet(rm, ctx, "worlds", ctx.worldId, "工会");
  const factor = optNumber(input.deadlineFactor, "时限系数", 0.5, 5);
  const rules = { ...world.rules };
  if (factor !== null) rules.deadlineFactor = factor;
  if (input.expiryPenalty !== undefined) rules.expiryPenalty = !!input.expiryPenalty;
  const title = input.title !== undefined ? mustText(input.title, "工会名字", 24) : undefined;
  const ch = update("worlds", world, { rules, ...(title ? { title } : {}) });
  return ok(ch ? [ch] : []);
});
