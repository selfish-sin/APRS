import type { Id } from "@/domain/model";

/** 这台设备上，在这个工会里谁登录着（登录 = 选账号 + 输口令）。 */
export interface Session {
  worldId: Id;
  accountId: Id | null;
  memberId: Id | null;
}
