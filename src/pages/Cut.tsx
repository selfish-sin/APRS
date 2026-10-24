/**
 * P6 卡详情：这一卡每个环节的状态条 · 时间线（交了哪一版、谁审的、意见逐条、提问和回复、拍板要补的）·
 * 在任何环节留意见 / 问上游 · 当前任务的动作。
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { Empty, MemberAvatar, MemberLink, SelectField, Tag } from "@/components/app/bits";
import { TaskActions } from "@/components/app/task";
import { ThreadBody } from "@/components/app/thread";
import { DropZone } from "@/components/library/intake";
import { FileDialog, FileTile } from "@/components/library/tiles";
import { Viewer } from "@/components/library/Viewer";
import { useFiles } from "@/lib/files/FilesProvider";
import { cmp } from "@/domain/agenda";
import { EXTRA_KIND_LABEL } from "@/domain/naming";
import { dateTimeZh } from "@/domain/clock";
import { formatNumber, VERDICT_LABEL } from "@/domain/labels";
import type { Id, ThreadKind } from "@/domain/model";
import { cutById, cutName, filesOfCut, members, memberById, projectById, stagesOf, timelineOfCut, type TimelineItem } from "@/domain/queries";
import { Link, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { NotFound } from "./NotFound";

function dotKind(item: TimelineItem): string {
  if (item.kind === "review") return item.review?.verdict === "return" ? "return" : "review";
  if (item.kind === "thread") return item.thread?.kind === "todo" ? "todo" : "thread";
  if (item.kind === "pin") return "pin";
  if (item.kind === "file") return "file";
  return item.kind === "submit" ? "submit" : "other";
}

const DOT_TEXT: Record<string, string> = { review: "过", return: "退", submit: "交", thread: "问", todo: "补", pin: "钉", file: "图", other: "·" };

export function CutPage() {
  const { world } = useGuild();
  const route = useRoute();
  const cut = cutById(world, route.segments[1]);
  const project = cut ? projectById(world, cut.projectId) : undefined;
  const timeline = useMemo(() => (cut ? timelineOfCut(world, cut.id) : []), [world, cut]);
  const [viewer, setViewer] = useState<{ start: Id; pin: Id | null } | null>(null);
  if (!cut || !project) return <NotFound what="这一卡" />;
  const cutFiles = filesOfCut(world, cut.id);
  const stages = stagesOf(world, project.id).filter((s) => s.grain !== "project");
  const tasks = Object.values(world.tasks).filter((t) => t.cutId === cut.id && !t.archivedAt && !t.extra);
  const extras = Object.values(world.tasks).filter((t) => !t.archivedAt && t.extra?.cutIds.includes(cut.id));
  const todos = Object.values(world.threads).filter((t) => t.cutId === cut.id && t.kind === "todo" && t.status === "open" && !t.archivedAt);
  const code = cutName(world, cut);

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to="/projects">项目</Link>
            <span>/</span>
            <Link to={`/project/${project.id}`}>{project.name}</Link>
            <span>/</span>
            <span>{code}</span>
          </div>
          <h1 className="t-title-32">
            {project.code} · {code}
          </h1>
          <span className="label">
            {cut.episode} · {cut.scene}
            {cut.layers.map((l) => ` · ${l.name} 层 ${l.sheets} 张`).join("")}
            {cut.seconds ? ` · ${formatNumber(cut.seconds)} 秒` : ""}
            {cut.keySheets ? ` · 原画 ${cut.keySheets} 张` : ""}
          </span>
        </div>
      </div>

      {todos.length ? (
        <section className="card" data-tone="muted" aria-label="要补">
          <h2 className="t-heading-18">拍板以后这一卡要补 <span className="count">{todos.length}</span></h2>
          <ul className="list">
            {todos.map((t) => (
              <li key={t.id}>
                <div className="list-main">
                  <ThreadBody thread={t} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {extras.length ? (
        <section className="card" aria-labelledby="extras-title" data-testid="cut-extras">
          <h2 id="extras-title" className="t-heading-18">
            额外 · 修正 · 补设定 <span className="count">{extras.length}</span>
          </h2>
          <ul className="list">
            {extras.map((t) => (
              <li key={t.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div className="row">
                  <Tag tone={t.extra!.kind === "fix" ? "danger" : t.extra!.kind === "setting" ? "lilac" : "sky"}>{EXTRA_KIND_LABEL[t.extra!.kind]}</Tag>
                  <span className="t-body-14m break">{t.extra!.title}</span>
                  <StatusPill Status={t.status} />
                  {t.extra!.blocking ? <Tag tone="warning">这一卡要等它</Tag> : null}
                  <span className="label">{world.stages[t.stageId]?.name}</span>
                </div>
                {t.extra!.description ? <span className="label break">{t.extra!.description}</span> : null}
                <TaskActions task={t} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid-2">
        <section className="card" aria-labelledby="stages-title">
          <h2 id="stages-title" className="t-heading-18">
            每个环节
          </h2>
          <ul className="list">
            {stages.map((s) => {
              const own = tasks.filter((t) => t.stageId === s.id).sort((a, b) => cmp(a.layer ?? "", b.layer ?? ""));
              if (!own.length) return null;
              return (
                <li key={s.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <span className="t-body-14m">{s.name}</span>
                  {own.map((t) => {
                    const assignee = memberById(world, t.assigneeId);
                    return (
                      <div key={t.id} className="stack" data-gap="small">
                        <div className="row">
                          {t.layer ? <Tag>{t.layer} 层</Tag> : null}
                          <StatusPill Status={t.status} />
                          {t.versions ? <span className="num label">v{String(t.versions).padStart(2, "0")}</span> : null}
                          {t.outsourced ? <span className="label">外包：{t.outsourceName}</span> : assignee ? (
                            <span className="row">
                              <MemberAvatar member={assignee} size="20" />
                              <MemberLink member={assignee} />
                            </span>
                          ) : null}
                          {t.dueAt && (t.status === "claimed" || t.status === "returned") ? <span className="label">时限 {dateTimeZh(t.dueAt)}</span> : null}
                        </div>
                        <TaskActions task={t} />
                      </div>
                    );
                  })}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="stack">
          <section className="card" aria-labelledby="compose-title">
            <h2 id="compose-title" className="t-heading-18">
              留意见 · 问上游
            </h2>
            <CutComposer cutId={cut.id} />
          </section>
          <CutFiles cutId={cut.id} onOpen={(start) => setViewer({ start, pin: null })} />
          <section className="card" aria-labelledby="timeline-title">
            <h2 id="timeline-title" className="t-heading-18">
              时间线 <span className="count">{timeline.length}</span>
            </h2>
            {timeline.length === 0 ? (
              <Empty>这一卡还没有动静。</Empty>
            ) : (
              <ol className="timeline">
                {timeline.map((item) => (
                  <li key={item.key}>
                    <span className="dot" data-kind={dotKind(item)} aria-hidden="true">
                      {DOT_TEXT[dotKind(item)]}
                    </span>
                    <div className="timeline-body">
                      {item.thread ? (
                        <ThreadBody thread={item.thread} />
                      ) : (
                        <>
                          <div className="timeline-head">
                            <span className="break">{item.text}</span>
                            <span className="label">{dateTimeZh(item.at)}</span>
                          </div>
                          {item.submission ? (
                            <span className="label break">
                              {item.submission.fileName}
                              {item.submission.link ? (
                                <>
                                  {" · "}
                                  <a href={item.submission.link} target="_blank" rel="noreferrer noopener">
                                    打开链接
                                  </a>
                                </>
                              ) : null}
                              {item.submission.note ? ` · ${item.submission.note}` : ""}
                              {item.submission.onTime ? "" : " · 超时交的"}
                            </span>
                          ) : null}
                          {item.pin ? <span className="break">{item.pin.text}</span> : null}
                          {item.pin ? (
                            <span className="label break">
                              {[item.pin.layer ? `${item.pin.layer} 层` : null, item.pin.sheets ? `第 ${item.pin.sheets} 张` : null, item.pin.tag, item.pin.status === "resolved" ? "已解决" : null].filter(Boolean).join(" · ")}
                              {" · "}
                              <button type="button" className="inline-link" onClick={() => setViewer({ start: item.pin!.fileId, pin: item.pin!.id })} data-testid="timeline-open-pin">
                                在图上看
                              </button>
                            </span>
                          ) : null}
                          {item.file && !item.pin ? (
                            <button type="button" className="inline-link label" onClick={() => setViewer({ start: item.file!.id, pin: null })}>
                              看图
                            </button>
                          ) : null}
                          {item.review && item.review.comments.length ? (
                            <ul className="comments" aria-label={`${VERDICT_LABEL[item.review.verdict]}的意见`}>
                              {item.review.comments.map((c, i) => (
                                <li key={i}>
                                  <span className="label">{[c.layer ? `${c.layer} 层` : null, c.sheets ? `第 ${c.sheets} 张` : null, c.tag].filter(Boolean).join(" · ") || "意见"}</span>
                                  <span className="break">{c.text}</span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
      {viewer ? <Viewer files={cutFiles} startId={viewer.start} focusPinId={viewer.pin} onClose={() => setViewer(null)} /> : null}
    </>
  );
}

/** 这一卡的图和文件（挂在卡、任务、版本上的都算）：能拖 / 选 / 粘贴放进来。 */
function CutFiles({ cutId, onOpen }: { cutId: Id; onOpen: (fileId: Id) => void }) {
  const { world, notify } = useGuild();
  const files = useFiles();
  const [more, setMore] = useState<Id | null>(null);
  const list = filesOfCut(world, cutId);
  return (
    <section className="card" aria-labelledby="cut-files-title" data-testid="cut-files">
      <h2 id="cut-files-title" className="t-heading-18">
        图和文件 <span className="count">{list.length}</span>
      </h2>
      <DropZone
        testId="cut-drop"
        onFiles={(picked) =>
          void files.addFiles(picked, { subjectType: "cut", subjectId: cutId }).then((r) => {
            if (r.errors.length) notify(r.errors[0], "Error");
            else if (r.fileIds.length) notify(`放进来 ${r.fileIds.length} 个`);
          })
        }
      />
      {list.length ? (
        <div className="file-grid">
          {list.map((f) => (
            <FileTile key={f.id} file={f} onOpen={() => onOpen(f.id)} onMore={() => setMore(f.id)} />
          ))}
        </div>
      ) : null}
      {more ? <FileDialog fileId={more} onClose={() => setMore(null)} /> : null}
    </section>
  );
}

function CutComposer({ cutId }: { cutId: Id }) {
  const { world, me, dispatch, notify } = useGuild();
  const cut = world.cuts[cutId];
  const stages = stagesOf(world, cut.projectId);
  const [kind, setKind] = useState<Exclude<ThreadKind, "todo">>("comment");
  const [stageKey, setStageKey] = useState<string>("");
  const [target, setTarget] = useState<string>("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const chosen = stages.find((s) => s.templateKey === stageKey);
  const upstream = chosen ? stages.filter((s) => chosen.upstream.includes(s.templateKey)) : [];
  const submit = () => {
    const askStageKey = kind === "ask" && target.startsWith("stage:") ? target.slice(6) : null;
    const askMemberId = kind === "ask" && target.startsWith("member:") ? target.slice(7) : null;
    const r = dispatch("thread.open", { subjectType: "cut", subjectId: cutId, kind, stageKey: stageKey || null, askStageKey, askMemberId, text }, { quiet: true });
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setText("");
    setError(null);
    notify(kind === "ask" ? "问出去了" : kind === "setting" ? "设定问题提上去了，等管理员拍板" : "留好了", "Neutral");
  };
  return (
    <form
      className="stack"
      data-gap="small"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="chips" role="radiogroup" aria-label="类型">
        {(
          [
            ["comment", "意见"],
            ["ask", "问上游"],
            ["setting", "设定问题"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" className="ui-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <SelectField
          label="说的是哪个环节"
          value={stageKey}
          onChange={(e) => {
            setStageKey(e.target.value);
            const s = stages.find((x) => x.templateKey === e.target.value);
            const up = s ? stages.find((x) => s.upstream.includes(x.templateKey)) : undefined;
            setTarget(up ? `stage:${up.templateKey}` : "");
          }}
        >
          <option value="">整卡</option>
          {stages.map((s) => (
            <option key={s.id} value={s.templateKey}>
              {s.name}
            </option>
          ))}
        </SelectField>
        {kind === "ask" ? (
          <SelectField label="问谁" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">选一个</option>
            {(upstream.length ? upstream : stages).map((s) => (
              <option key={s.id} value={`stage:${s.templateKey}`}>
                {upstream.length ? "上游：" : ""}
                {s.name}
              </option>
            ))}
            {members(world)
              .filter((m) => m.id !== me.id)
              .map((m) => (
                <option key={m.id} value={`member:${m.id}`}>
                  问 {m.nickname}
                </option>
              ))}
          </SelectField>
        ) : null}
      </div>
      <textarea
        className="field-control"
        aria-label="内容"
        placeholder={kind === "ask" ? "要问上游的事：哪一层、第几张、哪里看不懂" : kind === "setting" ? "要管理员拍板的设定：用哪个版本、要不要加、要补哪些卡" : "对这一卡说的话：哪一层、第几张、什么问题"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error ? <p className="error-text">{error}</p> : null}
      <div className="form-actions">
        <Button Label="留下" Size="Small" Style="Accent" type="submit" />
      </div>
    </form>
  );
}
