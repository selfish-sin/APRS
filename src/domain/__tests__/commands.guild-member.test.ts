import { describe, expect, it } from "vitest";
import { dispatch } from "@/domain/dispatch";
import { emptyWorldState } from "@/domain/model";
import { SALT, TestGuild, WORLD } from "./helpers";
import { hashPasscodeSync } from "./hash";

const HASH = hashPasscodeSync(SALT, "another-1");

describe("guild.create", () => {
  it("建一个全空的工会，建的人是管理员，有账号", () => {
    const g = new TestGuild();
    const admin = g.state.members[g.admin];
    expect(admin.role).toBe("admin");
    expect(admin.nickname).toBe("管理");
    expect(g.state.accounts[g.adminAccount].memberId).toBe(g.admin);
    expect(g.state.worlds[WORLD].rules.deadlineFactor).toBe(1.5);
    expect(g.state.journal).toHaveLength(1);
  });

  it("同一个世界不能建两次；名字和登录名要像样", () => {
    const g = new TestGuild();
    expect(g.reject(null, "guild.create", { title: "又一个", nickname: "甲", login: "a1", salt: SALT, hash: HASH })).toBe("这个工会已经建好了");
    const empty = emptyWorldState();
    const bad = dispatch(empty, { worldId: "wld_x", accountId: null, actorMemberId: null }, "guild.create", { title: "", nickname: "甲", login: "a1", salt: SALT, hash: HASH });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message).toBe("工会名字不能为空");
    const badLogin = dispatch(empty, { worldId: "wld_x", accountId: null, actorMemberId: null }, "guild.create", { title: "工会", nickname: "甲", login: "空 格", salt: SALT, hash: HASH });
    expect(!badLogin.ok && badLogin.error.message).toMatch(/登录名/);
    const badHash = dispatch(empty, { worldId: "wld_x", accountId: null, actorMemberId: null }, "guild.create", { title: "工会", nickname: "甲", login: "ab", salt: SALT, hash: "口令原文" });
    expect(!badHash.ok && badHash.error.message).toMatch(/口令/);
  });
});

describe("rules.set", () => {
  it("管理员改时限系数和超时扣分开关", () => {
    const g = new TestGuild();
    g.run(g.admin, "rules.set", { deadlineFactor: 2, expiryPenalty: true });
    expect(g.state.worlds[WORLD].rules).toMatchObject({ deadlineFactor: 2, expiryPenalty: true });
  });

  it("成员不能改；系数要在范围里", () => {
    const g = new TestGuild();
    const m = g.member("小甲");
    expect(g.reject(m, "rules.set", { deadlineFactor: 2 })).toBe("只有管理员可以改规则");
    expect(g.reject(g.admin, "rules.set", { deadlineFactor: 99 })).toMatch(/时限系数/);
    expect(g.reject(null, "rules.set", { deadlineFactor: 2 })).toBe("请先登录");
  });
});

describe("member.join", () => {
  it("管理员加成员，默认角色是成员", () => {
    const g = new TestGuild();
    const id = g.member("小甲");
    expect(g.state.members[id]).toMatchObject({ nickname: "小甲", role: "member" });
    expect(g.state.members[id].joinedAt).toBe(g.now);
  });

  it("昵称不能重复；成员不能加人", () => {
    const g = new TestGuild();
    const m = g.member("小甲");
    expect(g.reject(g.admin, "member.join", { nickname: "小甲" })).toMatch(/已经有人叫/);
    expect(g.reject(m, "member.join", { nickname: "小乙" })).toBe("只有管理员可以加成员");
  });
});

describe("member.set_role", () => {
  it("改角色；至少留一个管理员", () => {
    const g = new TestGuild();
    const m = g.member("小甲");
    g.run(g.admin, "member.set_role", { memberId: m, role: "reviewer" });
    expect(g.state.members[m].role).toBe("reviewer");
    expect(g.reject(g.admin, "member.set_role", { memberId: g.admin, role: "member" })).toBe("工会里至少要留一个管理员");
    expect(g.reject(m, "member.set_role", { memberId: m, role: "admin" })).toBe("只有管理员可以改角色");
  });
});

describe("member.update", () => {
  it("自己改昵称和头像色，账号上的名字跟着改", () => {
    const g = new TestGuild();
    g.run(g.admin, "member.update", { memberId: g.admin, nickname: "老大", tone: "peach" });
    expect(g.state.members[g.admin]).toMatchObject({ nickname: "老大", tone: "peach" });
    expect(g.state.accounts[g.adminAccount].displayName).toBe("老大");
  });

  it("不能改别人的（管理员除外）", () => {
    const g = new TestGuild();
    const a = g.member("小甲");
    const b = g.member("小乙");
    expect(g.reject(a, "member.update", { memberId: b, nickname: "改名" })).toBe("只能改自己的资料");
    g.run(g.admin, "member.update", { memberId: b, nickname: "小丙" });
    expect(g.state.members[b].nickname).toBe("小丙");
  });
});

describe("account.create", () => {
  it("管理员给成员建账号，只存 salt 和哈希", () => {
    const g = new TestGuild();
    const m = g.member("小甲");
    const { accountId } = g.run(g.admin, "account.create", { memberId: m, login: "Member02", salt: SALT, hash: HASH });
    expect(g.state.accounts[accountId]).toMatchObject({ login: "member02", memberId: m, salt: SALT, hash: HASH });
    expect(JSON.stringify(g.state.journal)).not.toContain("another-1");
  });

  it("登录名不能重复；一个成员一个账号", () => {
    const g = new TestGuild();
    const m = g.member("小甲");
    const n = g.member("小乙");
    g.run(g.admin, "account.create", { memberId: m, login: "m1", salt: SALT, hash: HASH });
    expect(g.reject(g.admin, "account.create", { memberId: n, login: "m1", salt: SALT, hash: HASH })).toMatch(/已经有人用了/);
    expect(g.reject(g.admin, "account.create", { memberId: m, login: "m9", salt: SALT, hash: HASH })).toMatch(/已经有账号/);
    expect(g.reject(m, "account.create", { memberId: n, login: "m2", salt: SALT, hash: HASH })).toBe("只有管理员可以建账号");
  });
});

describe("account.set_passcode", () => {
  it("改自己的口令；管理员能重置别人的；成员不能动别人的", () => {
    const g = new TestGuild();
    const m = g.member("小甲");
    const n = g.member("小乙");
    const { accountId } = g.run(g.admin, "account.create", { memberId: m, login: "m1", salt: SALT, hash: HASH });
    const other = g.run(g.admin, "account.create", { memberId: n, login: "m2", salt: SALT, hash: HASH }).accountId;
    const fresh = hashPasscodeSync("ffeeddccbbaa99887766554433221100", "changed-1");
    g.run(m, "account.set_passcode", { accountId, salt: "ffeeddccbbaa99887766554433221100", hash: fresh });
    expect(g.state.accounts[accountId].hash).toBe(fresh);
    expect(g.reject(m, "account.set_passcode", { accountId: other, salt: SALT, hash: fresh })).toBe("只有管理员可以重置别人的口令");
    g.run(g.admin, "account.set_passcode", { accountId: other, salt: SALT, hash: fresh });
    expect(g.state.accounts[other].hash).toBe(fresh);
  });
});
