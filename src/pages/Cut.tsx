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
import { LinkList } from "@/components/app/links";
import { DropZone } from "@/components/library/intake";
import { FileDialog, FileTile } from "@/components/library/tiles";
import { Viewer } from "@/components/library/Viewer";
import { useFiles } from "@/lib/files/FilesProvider";
import { cmp } from "@/domain/agenda";
import type { Id, ThreadKind } from "@/domain/model";
import { cutById, filesOfCut, members, memberById, projectById, stagesOf, timelineOfCut, type TimelineItem } from "@/domain/queries";
import { Joined, U, useI18n } from "@/i18n/I18n";
import { Link, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { NotFound } from "./NotFound";
import { CutAdminCard } from "./ProjectSetup";
import { isAdmin } from "@/domain/commands/core";

type DotKind = "review" | "return" | "submit" | "thread" | "todo" | "pin" | "file" | "other";

function dotKind(item: TimelineItem): DotKind {
  if (item.kind === "review") return item.review?.verdict === "return" ? "return" : "review";
  if (item.kind === "thread") return item.thread?.kind === "todo" ? "todo" : "thread";
  if (item.kind === "pin") return "pin";
  if (item.kind === "file") return "file";
  return item.kind === "submit" ? "submit" : "other";
}

export function CutPage() {
  const { world, me } = useGuild();
  const { L, f, r: rich, ph, dateTime, num, tag, cut: cutOf, stage: stageEl } = useI18n();
  const route = useRoute();
  const cut = cutById(world, route.segments[1]);
  const project = cut ? projectById(world, cut.projectId) : undefined;
  const timeline = useMemo(() => (cut ? timelineOfCut(world, cut.id) : []), [world, cut]);
  const [viewer, setViewer] = useState<{ start: Id; pin: Id | null } | null>(null);
  if (!cut || !project) return <NotFound what="cut" />;
  const cutFiles = filesOfCut(world, cut.id);
  const stages = stagesOf(world, project.id).filter((s) => s.grain !== "project");
  const tasks = Object.values(world.tasks).filter((t) => t.cutId === cut.id && !t.archivedAt && !t.extra);
  const extras = Object.values(world.tasks).filter((t) => !t.archivedAt && t.extra?.cutIds.includes(cut.id));
  const todos = Object.values(world.threads).filter((t) => t.cutId === cut.id && t.kind === "todo" && t.status === "open" && !t.archivedAt);
  const code = cutOf(cut, project.group);
  const notes = (c: { layer?: string | null; sheets?: string | null; tag?: string | null }) => [
    c.layer ? f(L.cut.layerTag, { layer: c.layer }) : null,
    c.sheets ? rich(L.cut.sheetNo, { n: <U>{c.sheets}</U> }) : null,
    c.tag ? tag(c.tag) : null,
  ];

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to="/projects">{L.cut.projects}</Link>
            <span>/</span>
            <Link to={`/project/${project.id}`}>
              <U>{project.name}</U>
            </Link>
            <span>/</span>
            <span>{code}</span>
          </div>
          <h1 className="t-title-32">
            {project.code} · {code}
          </h1>
          <span className="label">
            {cut.episode} · {cut.scene}
            {cut.layers.map((l) => f(L.cut.layerSheets, { layer: l.name, n: l.sheets })).join("")}
            {cut.seconds ? f(L.cut.seconds, { n: num(cut.seconds) }) : ""}
            {cut.keySheets ? f(L.cut.keySheets, { n: cut.keySheets }) : ""}
          </span>
        </div>
      </div>

      {todos.length ? (
        <section className="card" data-tone="muted" aria-label={L.cut.todos}>
          <h2 className="t-heading-18">
            {L.cut.todosTitle} <span className="count">{todos.length}</span>
          </h2>
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
            {L.cut.extrasTitle} <span className="count">{extras.length}</span>
          </h2>
          <ul className="list">
            {extras.map((t) => (
              <li key={t.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div className="row">
                  <Tag tone={t.extra!.kind === "fix" ? "danger" : t.extra!.kind === "setting" ? "lilac" : "sky"}>{L.labels.extraKind[t.extra!.kind]}</Tag>
                  <span className="t-body-14m break">
                    <U>{t.extra!.title}</U>
                  </span>
                  <StatusPill Status={t.status} />
                  {t.extra!.blocking ? <Tag tone="warning">{L.cut.waitsTag}</Tag> : null}
                  {world.stages[t.stageId] ? <span className="label">{stageEl(project.group, world.stages[t.stageId])}</span> : null}
                </div>
                {t.extra!.description ? (
                  <span className="label break">
                    <U>{t.extra!.description}</U>
                  </span>
                ) : null}
                <TaskActions task={t} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid-2">
        <section className="card" aria-labelledby="stages-title">
          <h2 id="stages-title" className="t-heading-18">
            {L.cut.stagesTitle}
          </h2>
          <ul className="list">
            {stages.map((s) => {
              const own = tasks.filter((t) => t.stageId === s.id).sort((a, b) => cmp(a.layer ?? "", b.layer ?? ""));
              if (!own.length) return null;
              return (
                <li key={s.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                  <span className="t-body-14m">{stageEl(project.group, s)}</span>
                  {own.map((t) => {
                    const assignee = memberById(world, t.assigneeId);
                    return (
                      <div key={t.id} className="stack" data-gap="small">
                        <div className="row">
                          {t.layer ? <Tag>{f(L.cut.layerTag, { layer: t.layer })}</Tag> : null}
                          <StatusPill Status={t.status} />
                          {t.versions ? <span className="num label">v{String(t.versions).padStart(2, "0")}</span> : null}
                          {t.outsourced ? (
                            <span className="label">
                              {f(L.cut.outsourced, { name: "" })}
                              <U>{t.outsourceName ?? ""}</U>
                            </span>
                          ) : assignee ? (
                            <span className="row">
                              <MemberAvatar member={assignee} size="20" />
                              <MemberLink member={assignee} />
                            </span>
                          ) : null}
                          {t.dueAt && (t.status === "claimed" || t.status === "returned") ? <span className="label">{f(L.cut.due, { date: dateTime(t.dueAt) })}</span> : null}
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
          {isAdmin(me) ? <CutAdminCard cut={cut} /> : null}
          <section className="card" aria-labelledby="compose-title">
            <h2 id="compose-title" className="t-heading-18">
              {L.cut.composeTitle}
            </h2>
            <CutComposer cutId={cut.id} />
          </section>
          <CutFiles cutId={cut.id} onOpen={(start) => setViewer({ start, pin: null })} />
          <section className="card" aria-labelledby="timeline-title">
            <h2 id="timeline-title" className="t-heading-18">
              {L.cut.timeline} <span className="count">{timeline.length}</span>
            </h2>
            {timeline.length === 0 ? (
              <Empty>{L.cut.timelineEmpty}</Empty>
            ) : (
              <ol className="timeline">
                {timeline.map((item) => (
                  <li key={item.key}>
                    <span className="dot" data-kind={dotKind(item)} aria-hidden="true">
                      {L.cut.dot[dotKind(item)]}
                    </span>
                    <div className="timeline-body">
                      {item.thread ? (
                        <ThreadBody thread={item.thread} />
                      ) : (
                        <>
                          <div className="timeline-head">
                            <span className="break">{ph(item.phrase)}</span>
                            <span className="label">{dateTime(item.at)}</span>
                          </div>
                          {item.submission ? (
                            <>
                              <span className="label break">
                                <U>{item.submission.fileName}</U>
                                {item.submission.note ? (
                                  <>
                                    {" · "}
                                    <U>{item.submission.note}</U>
                                  </>
                                ) : null}
                                {item.submission.onTime ? "" : L.cut.late}
                              </span>
                              <LinkList submission={item.submission} compact />
                            </>
                          ) : null}
                          {item.pin ? (
                            <span className="break">
                              <U>{item.pin.text}</U>
                            </span>
                          ) : null}
                          {item.pin ? (
                            <span className="label break">
                              <Joined parts={[...notes(item.pin), item.pin.status === "resolved" ? L.cut.resolved : null]} />
                              {" · "}
                              <button type="button" className="inline-link" onClick={() => setViewer({ start: item.pin!.fileId, pin: item.pin!.id })} data-testid="timeline-open-pin">
                                {L.cut.seeOnImage}
                              </button>
                            </span>
                          ) : null}
                          {item.file && !item.pin ? (
                            <button type="button" className="inline-link label" onClick={() => setViewer({ start: item.file!.id, pin: null })}>
                              {L.cut.seeImage}
                            </button>
                          ) : null}
                          {item.review && item.review.comments.length ? (
                            <ul className="comments" aria-label={f(L.cut.verdictNotes, { verdict: L.labels.verdict[item.review.verdict] })}>
                              {item.review.comments.map((c, i) => (
                                <li key={i}>
                                  <span className="label">
                                    <Joined parts={notes(c)} fallback={L.cut.comment} />
                                  </span>
                                  <span className="break">
                                    <U>{c.text}</U>
                                  </span>
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
  const { L, f } = useI18n();
  const files = useFiles();
  const [more, setMore] = useState<Id | null>(null);
  const list = filesOfCut(world, cutId);
  return (
    <section className="card" aria-labelledby="cut-files-title" data-testid="cut-files">
      <h2 id="cut-files-title" className="t-heading-18">
        {L.cut.filesTitle} <span className="count">{list.length}</span>
      </h2>
      <DropZone
        testId="cut-drop"
        onFiles={(picked) =>
          void files.addFiles(picked, { subjectType: "cut", subjectId: cutId }).then((r) => {
            if (r.errors.length) notify(r.errors[0], "Error");
            else if (r.fileIds.length) notify(f(L.cut.added, { n: r.fileIds.length }));
          })
        }
      />
      {list.length ? (
        <div className="file-grid">
          {list.map((file) => (
            <FileTile key={file.id} file={file} onOpen={() => onOpen(file.id)} onMore={() => setMore(file.id)} />
          ))}
        </div>
      ) : null}
      {more ? <FileDialog fileId={more} onClose={() => setMore(null)} /> : null}
    </section>
  );
}

function CutComposer({ cutId }: { cutId: Id }) {
  const { world, me, dispatch, notify } = useGuild();
  const { L, f, err, stageName } = useI18n();
  const cut = world.cuts[cutId];
  const group = world.projects[cut.projectId]?.group ?? "animation";
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
      setError(err(r.error));
      return;
    }
    setText("");
    setError(null);
    notify(kind === "ask" ? L.cut.asked : kind === "setting" ? L.cut.settingSent : L.cut.left, "Neutral");
  };
  const kinds: [Exclude<ThreadKind, "todo">, string][] = [
    ["comment", L.cut.kindComment],
    ["ask", L.cut.kindAsk],
    ["setting", L.cut.kindSetting],
  ];
  return (
    <form
      className="stack"
      data-gap="small"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="chips" role="radiogroup" aria-label={L.cut.kind}>
        {kinds.map(([k, label]) => (
          <button key={k} type="button" className="ui-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <SelectField
          label={L.cut.whichStage}
          value={stageKey}
          onChange={(e) => {
            setStageKey(e.target.value);
            const s = stages.find((x) => x.templateKey === e.target.value);
            const up = s ? stages.find((x) => s.upstream.includes(x.templateKey)) : undefined;
            setTarget(up ? `stage:${up.templateKey}` : "");
          }}
        >
          <option value="">{L.cut.wholeCut}</option>
          {stages.map((s) => (
            <option key={s.id} value={s.templateKey}>
              {stageName(group, s)}
            </option>
          ))}
        </SelectField>
        {kind === "ask" ? (
          <SelectField label={L.cut.askWho} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{L.cut.pickOne}</option>
            {(upstream.length ? upstream : stages).map((s) => (
              <option key={s.id} value={`stage:${s.templateKey}`}>
                {upstream.length ? L.cut.upstreamPrefix : ""}
                {stageName(group, s)}
              </option>
            ))}
            {members(world)
              .filter((m) => m.id !== me.id)
              .map((m) => (
                <option key={m.id} value={`member:${m.id}`} data-uc="">
                  {f(L.cut.askMember, { name: m.nickname })}
                </option>
              ))}
          </SelectField>
        ) : null}
      </div>
      <textarea
        className="field-control"
        aria-label={L.cut.content}
        placeholder={kind === "ask" ? L.cut.askPlaceholder : kind === "setting" ? L.cut.settingPlaceholder : L.cut.commentPlaceholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error ? <p className="error-text">{error}</p> : null}
      <div className="form-actions">
        <Button Label={L.cut.leave} Size="Small" Style="Accent" type="submit" />
      </div>
    </form>
  );
}
