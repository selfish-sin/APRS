/** 盘点测试用：示范工会上跑命令 · 把 tests/fixtures/audit 的假文件夹变成「放进来」的条目（只有名字 · 路径 · 大小，和 zip 里的目录）。 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect } from "vitest";
import { buildDemoWorld, DEMO_NOW, DEMO_WORLD_ID } from "@/data/demo";
import type { CommandInput, CommandName } from "@/domain/commands";
import type { AuditItemInput } from "@/domain/commands/audit";
import { dispatch, type DispatchResult } from "@/domain/dispatch";
import { seededIds } from "@/domain/ids";
import { checkIntegrity } from "@/domain/integrity";
import type { Id, WorldState } from "@/domain/model";
import { memoryReadModel } from "@/domain/readmodel";
import { readZipDirectory } from "@/lib/audit/archive";
import { bytesSource } from "@/lib/audit/bytes";
import { readClip } from "@/lib/audit/clip";
import { kindOfName, pasteItems, zipItems } from "@/lib/audit/intake";

export const FIXTURES = join(__dirname, "..", "..", "..", "tests", "fixtures");

export class DemoRunner {
  state: WorldState = buildDemoWorld();
  private ids = seededIds(99);
  private tick = 0;
  admin: Id;
  constructor() {
    this.admin = Object.values(this.state.members).find((m) => m.role === "admin")!.id;
  }
  get rm() {
    return memoryReadModel(this.state);
  }
  member(nickname: string): Id {
    return Object.values(this.state.members).find((m) => m.nickname === nickname)!.id;
  }
  project(code: string): Id {
    return Object.values(this.state.projects).find((p) => p.code === code)!.id;
  }
  try<N extends CommandName>(member: Id | null, name: N, input: CommandInput<N>): DispatchResult {
    this.tick += 1;
    const now = new Date(Date.parse(DEMO_NOW) + this.tick * 1000).toISOString();
    const r = dispatch(this.state, { worldId: DEMO_WORLD_ID, accountId: null, actorMemberId: member }, name, input, { now, newId: (t) => this.ids(t, Date.parse(now)) });
    if (r.ok) {
      this.state = r.state;
      expect(checkIntegrity(this.state), `${name} 之后引用对不上`).toEqual([]);
    }
    return r;
  }
  run<N extends CommandName>(member: Id | null, name: N, input: CommandInput<N>): Record<string, Id> {
    const r = this.try(member, name, input);
    if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
    return r.created;
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** 照「拖一个文件夹」的样子：每个文件一条（路径从 EP01/ 起），zip 的话再加上里面的几条。 */
export async function fixtureItems(): Promise<AuditItemInput[]> {
  const root = join(FIXTURES, "audit");
  const out: AuditItemInput[] = [];
  for (const p of walk(root)) {
    const rel = relative(root, p).replace(/\\/g, "/");
    const name = rel.split("/").pop()!;
    const size = statSync(p).size;
    const kind = kindOfName(name);
    let info: AuditItemInput["info"] = { kind };
    if (kind === "clip") {
      const c = await readClip(bytesSource(new Uint8Array(readFileSync(p))));
      if (c) info = { kind, canvas: c.canvas, fps: c.fps, frames: c.frames, seconds: c.seconds, folders: c.folders };
    }
    out.push({ name, path: rel, size, mtime: "2026-10-20T06:00:00.000Z", origin: "file", fingerprint: `${size}:${rel}`, thumb: null, info });
    if (name.endsWith(".zip")) {
      const entries = await readZipDirectory(bytesSource(new Uint8Array(readFileSync(p))));
      const inside = zipItems({ name, path: rel }, entries ?? []);
      out[out.length - 1].info = { kind, entries: inside.length };
      out.push(...inside);
    }
  }
  return out;
}

export function fixturePaste(): AuditItemInput[] {
  return pasteItems(readFileSync(join(FIXTURES, "audit-paste.txt"), "utf8"));
}
