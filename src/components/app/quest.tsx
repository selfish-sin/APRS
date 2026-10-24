/**
 * 任务单（黑卡）：项目 / 卡 / 环节 / 工作量 / 时限倒计时 / 奖励 / 收什么 · 交到哪 · 文件名 / 交 · 放弃 · 提问。
 * 一屏最多一两张黑卡，给「现在这件事」。
 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatNumber, formatPoints, PHASE_LABEL, STAGE_KIND_LABEL } from "@/domain/labels";
import type { Id } from "@/domain/model";
import { members as membersOf, type Quest } from "@/domain/queries";
import { Link } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { SelectField, TextArea, TextField, copyText } from "./bits";

export function QuestCard({ quest, eyebrow = "当前任务单", showCutLink = true }: { quest: Quest; eyebrow?: string; showCutLink?: boolean }) {
  const { view, indicator, countdown } = quest;
  const { task, stage, project, cut } = view;
  const { notify } = useGuild();
  const [dialog, setDialog] = useState<"submit" | "ask" | "release" | null>(null);
  const inHand = task.status === "claimed" || task.status === "returned";
  const urgent = !!quest.remainingMs && quest.remainingMs < 6 * 3600_000;
  const unit = view.workloadLabel.split(" ").slice(1).join(" ");
  return (
    <article className="quest" aria-label={`任务单：${view.title}`} data-testid="quest-card">
      <div className="quest-eyebrow">
        <span>
          {eyebrow} · {project.name}
        </span>
        <StatusPill Status={task.status} Label={task.status === "submitted" && view.versionTag ? `待审 ${view.versionTag}` : undefined} />
      </div>
      <div className="stack" data-gap="small">
        <h2 className="quest-title">{view.label}</h2>
        <p className="quest-sub">
          {project.code} · {PHASE_LABEL[stage.phase]} · {STAGE_KIND_LABEL[stage.kind]}
          {stage.hub && stage.kind !== "hub" ? " · 枢纽" : ""}
          {view.versionTag ? ` · 最新 ${view.versionTag}` : ""}
        </p>
      </div>
      <div className="quest-numbers">
        <div className="quest-number">
          <span className="num">{formatNumber(task.workload)}</span>
          <small>工作量（{unit}）</small>
        </div>
        <div className="quest-number" data-urgent={urgent || countdown?.overdue ? "true" : "false"}>
          <span className="num">{countdown ? countdown.big : "—"}</span>
          <small>{countdown ? countdown.text : task.status === "submitted" ? "交了，等审核" : "没有时限"}</small>
        </div>
        <div className="quest-number">
          <span className="num">{formatPoints(quest.reward, true)}</span>
          <small>活力点（按质量 1.0）</small>
        </div>
      </div>

      {quest.lastReturn ? (
        <ul className="quest-notes" aria-label="退回意见">
          {quest.lastReturn.comments.map((c, i) => (
            <li key={i}>
              <span className="label">
                退回 · {[c.layer ? `${c.layer} 层` : null, c.sheets ? `第 ${c.sheets} 张` : null, c.tag].filter(Boolean).join(" · ") || "意见"}
              </span>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {indicator.todos.length ? (
        <ul className="quest-notes" aria-label="要补">
          {indicator.todos.map((t) => (
            <li key={t.id}>
              <span className="label">拍板以后要补</span>
              <span>{t.text.replace(/^要补：/, "")}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="quest-rows">
        <div>
          <dt>收什么</dt>
          <dd>
            <span>{indicator.receive.text}</span>
            {indicator.receive.from.map((src) =>
              src.tasks.slice(0, 4).map((t) => (
                <span key={t.task.id} className="quest-sub">
                  {t.label}
                  {t.latest ? ` · v${String(t.latest.versionNo).padStart(2, "0")}` : ""}
                  {t.latest?.link ? (
                    <>
                      {" · "}
                      <a href={t.latest.link} target="_blank" rel="noreferrer noopener">
                        打开链接
                      </a>
                    </>
                  ) : (
                    ` · 在 ${t.folder}`
                  )}
                </span>
              ))
            )}
          </dd>
        </div>
        <div>
          <dt>交到哪</dt>
          <dd>
            <span className="quest-code">{indicator.deliver.folder}</span>
            {project.feishuRoot ? (
              <a href={project.feishuRoot} target="_blank" rel="noreferrer noopener">
                打开飞书根文件夹
              </a>
            ) : (
              <span className="quest-sub">在项目的飞书文件夹里</span>
            )}
          </dd>
        </div>
        <div>
          <dt>文件名</dt>
          <dd>
            <span className="quest-code">{indicator.deliver.fileName}</span>
            <button
              type="button"
              className="copy-button"
              onClick={async () => notify((await copyText(indicator.deliver.fileName)) ? "文件名复制好了" : "这里不让复制，照着抄一下", "Neutral")}
            >
              复制文件名
            </button>
          </dd>
        </div>
        <div>
          <dt>交什么</dt>
          <dd>
            <span>{indicator.deliver.text}</span>
            <span className="quest-sub">
              交给：{indicator.handTo.text}
              {indicator.reviewer ? ` · 审核：${indicator.reviewer.nickname}` : ""}
            </span>
          </dd>
        </div>
      </dl>

      <div className="quest-actions">
        {inHand ? <Button Label={task.status === "returned" ? "改好了，再交" : "交"} Style="Accent" onClick={() => setDialog("submit")} /> : null}
        <Button Label="提问" Style="Secondary" onClick={() => setDialog("ask")} />
        {inHand ? <Button Label="放弃" Style="Secondary" onClick={() => setDialog("release")} /> : null}
        {showCutLink && cut ? (
          <Link to={`/cut/${cut.id}`} className="ui-button" data-style="Secondary" data-size="Medium">
            看这一卡
          </Link>
        ) : null}
      </div>
      {dialog === "submit" ? <SubmitDialog quest={quest} onClose={() => setDialog(null)} /> : null}
      {dialog === "ask" ? <AskDialog quest={quest} onClose={() => setDialog(null)} /> : null}
      {dialog === "release" ? <ReleaseDialog taskId={task.id} label={view.label} onClose={() => setDialog(null)} /> : null}
    </article>
  );
}

export function SubmitDialog({ quest, onClose }: { quest: Quest; onClose: () => void }) {
  const { dispatch, notify } = useGuild();
  const [link, setLink] = useState(quest.view.latest?.link ?? "");
  const [note, setNote] = useState("");
  const [fileName, setFileName] = useState(quest.indicator.deliver.fileName);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const r = dispatch("task.submit", { taskId: quest.view.task.id, link, note, fileName }, { quiet: true });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    notify(`交了 ${quest.view.label} v${String(quest.indicator.deliver.version).padStart(2, "0")}，等审核`);
    onClose();
  };
  return (
    <Drawer
      Type="Dialog"
      Title={`交 ${quest.view.label}`}
      Body={`这一版是 v${String(quest.indicator.deliver.version).padStart(2, "0")}。大文件放飞书，这里只贴链接。`}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label="取消" Style="Secondary" onClick={onClose} />
          <Button Label="交" Style="Accent" onClick={submit} data-testid="submit-confirm" />
        </>
      }
    >
      <form
        className="stack"
        data-gap="small"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField label="飞书链接" type="url" inputMode="url" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} hint="只收 http:// 或 https:// 开头的链接" />
        <TextArea label="说明" placeholder="改了哪里、还有什么要说的" value={note} onChange={(e) => setNote(e.target.value)} hint="链接和说明至少写一个" />
        <TextField label="文件名" value={fileName} onChange={(e) => setFileName(e.target.value)} hint="按规范自动生成，可以改；扩展名照你的软件" />
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

export function AskDialog({ quest, onClose }: { quest: Quest; onClose: () => void }) {
  const { dispatch, notify, world, me } = useGuild();
  const upstream = quest.indicator.receive.from.map((f) => f.stage);
  const [target, setTarget] = useState<string>(upstream[0] ? `stage:${upstream[0].templateKey}` : "");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const people = membersOf(world).filter((m) => m.id !== me.id);
  const send = () => {
    const askStageKey = target.startsWith("stage:") ? target.slice(6) : null;
    const askMemberId = target.startsWith("member:") ? (target.slice(7) as Id) : null;
    const kind = target === "comment" ? "comment" : target === "setting" ? "setting" : "ask";
    const r = dispatch("thread.open", { subjectType: "task", subjectId: quest.view.task.id, kind, askStageKey, askMemberId, text }, { quiet: true });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    notify(kind === "ask" ? "问出去了，有人回了会在「等我处理」里" : "留好了");
    onClose();
  };
  return (
    <Drawer
      Type="Dialog"
      Title={`提问 · ${quest.view.label}`}
      open
      onClose={onClose}
      actions={
        <>
          <Button Label="取消" Style="Secondary" onClick={onClose} />
          <Button Label="发出去" Style="Accent" onClick={send} />
        </>
      }
    >
      <div className="stack" data-gap="small">
        <SelectField label="问谁" value={target} onChange={(e) => setTarget(e.target.value)}>
          {upstream.map((s) => (
            <option key={s.id} value={`stage:${s.templateKey}`}>
              上游：{s.name}
            </option>
          ))}
          {people.map((m) => (
            <option key={m.id} value={`member:${m.id}`}>
              问 {m.nickname}
            </option>
          ))}
          <option value="setting">设定问题（要管理员拍板）</option>
          <option value="comment">只留个意见</option>
        </SelectField>
        <TextArea label="问题" placeholder="例如：第 4、5 张之间有中割标记，轨目漏了，这里怎么读？" value={text} onChange={(e) => setText(e.target.value)} />
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}

export function ReleaseDialog({ taskId, label, onClose }: { taskId: Id; label: string; onClose: () => void }) {
  const { dispatch, notify } = useGuild();
  return (
    <Drawer
      Type="Dialog"
      Title={`放弃 ${label}？`}
      Body="放弃以后这张回到「可接」，别人可以接，不扣分。交过的版本还留着。"
      open
      onClose={onClose}
      actions={
        <>
          <Button Label="不放弃" Style="Secondary" onClick={onClose} />
          <Button
            Label="放弃"
            onClick={() => {
              const r = dispatch("task.release", { taskId });
              if (r.ok) notify(`${label} 放回去了`, "Neutral");
              onClose();
            }}
          />
        </>
      }
    />
  );
}

/** 白色的小任务单（手上不止一张时）。 */
export function MiniQuest({ quest, selected, onSelect }: { quest: Quest; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className="mini-quest" aria-pressed={selected} onClick={onSelect}>
      <div className="list-main">
        <span className="t-body-14m">{quest.view.label}</span>
        <span className="label">
          {quest.view.project.name} · {quest.countdown ? quest.countdown.text : "等审核"}
        </span>
      </div>
      <StatusPill Status={quest.view.task.status} />
    </button>
  );
}
