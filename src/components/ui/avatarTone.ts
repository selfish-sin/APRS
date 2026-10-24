/** 没有世界状态时的兜底：同一个 id 永远落在同一头像色上。
 *  人用 avatarToneOf。不是人的用 Neutral，不走这张表。
 */
export const AVATAR_TONES = ["Peach", "Lilac", "Sand", "Sage", "Slate"] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number] | "Neutral";

export function avatarTone(id: string): (typeof AVATAR_TONES)[number] {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}
