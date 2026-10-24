/**
 * 命令清单。页面调 `dispatch(名字, 输入)`；名字会记进日志，所以名字是稳定的接口——
 * 要改名得带迁移。每个命令都有测试（src/domain/__tests__/）。
 */
import type { Command } from "./core";
import { createGuild, setRules } from "./guild";
import { createAccount, joinMember, setPasscode, setRole, updateMember } from "./member";
import { createProject, hubDispatch, setRate, setReviewer, updateProject } from "./project";
import { assignTask, claimTask, enroll, expireTask, reclaimTask, releaseTask, reopenTask, reviewTask, submitTask, unenroll } from "./task";
import { makeRuling, openThread, replyThread, resolveThread } from "./thread";
import { addFile, archiveFile, moveFile, renameFile, tagFile } from "./file";
import { addPin, reopenPin, replyPin, resolvePin } from "./pin";
import { assignRole, publishTask, setStageLock, setStagePeriod, setStageRate, unassignRole } from "./flex";
import { addBlock, archivePage, createPage, moveBlock, removeBlock, renamePage, updateBlock } from "./page";

export const COMMANDS = {
  "guild.create": createGuild,
  "rules.set": setRules,
  "member.join": joinMember,
  "member.set_role": setRole,
  "member.update": updateMember,
  "account.create": createAccount,
  "account.set_passcode": setPasscode,
  "enroll.add": enroll,
  "enroll.remove": unenroll,
  "task.claim": claimTask,
  "task.submit": submitTask,
  "task.release": releaseTask,
  "task.expire": expireTask,
  "task.reclaim": reclaimTask,
  "task.reopen": reopenTask,
  "task.assign": assignTask,
  "task.review": reviewTask,
  "task.publish": publishTask,
  "role.assign": assignRole,
  "role.unassign": unassignRole,
  "stage.set_lock": setStageLock,
  "stage.set_period": setStagePeriod,
  "stage.set_rate": setStageRate,
  "project.create": createProject,
  "project.update": updateProject,
  "stage.set_reviewer": setReviewer,
  "template.set_rate": setRate,
  "hub.dispatch": hubDispatch,
  "thread.open": openThread,
  "thread.reply": replyThread,
  "thread.resolve": resolveThread,
  "ruling.make": makeRuling,
  "file.add": addFile,
  "file.rename": renameFile,
  "file.tag": tagFile,
  "file.move": moveFile,
  "file.archive": archiveFile,
  "pin.add": addPin,
  "pin.reply": replyPin,
  "pin.resolve": resolvePin,
  "pin.reopen": reopenPin,
  "page.create": createPage,
  "page.rename": renamePage,
  "page.archive": archivePage,
  "block.add": addBlock,
  "block.update": updateBlock,
  "block.move": moveBlock,
  "block.remove": removeBlock,
} as const;

export type CommandName = keyof typeof COMMANDS;
export type CommandInput<N extends CommandName> = (typeof COMMANDS)[N] extends Command<infer I> ? I : never;

export type { Command, Ctx, DomainError, Result } from "./core";
export { isAdmin, isReviewer } from "./core";
