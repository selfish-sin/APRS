/**
 * 资料库（SPEC §11.3）：每个项目一个。缩略图网格（图片为主，非图片是文件卡）；
 * 按 卡 · 环节 · 类型 · 标签 · 谁传的 筛；按时间排；搜文件名。拖 / 选 / 粘贴放文件进来，可以选卡、环节、标签。
 * 下面是这个项目的资料页（设定集 · 文件命名规范 · 后期流程规范……）。
 */
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Empty, SelectField, TextField } from "@/components/app/bits";
import { DropZone } from "@/components/library/intake";
import { FileDialog, FileTile } from "@/components/library/tiles";
import { Viewer } from "@/components/library/Viewer";
import { dateZh, localDate } from "@/domain/clock";
import type { FileKind } from "@/domain/queries";
import { FILE_KIND_LABEL, blocksOf, cutsOf, cutName, libraryFacets, libraryOf, pagesOf, projectById, projects, stagesOf, memberById } from "@/domain/queries";
import type { Id } from "@/domain/model";
import { useFiles } from "@/lib/files/FilesProvider";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { NotFound } from "./NotFound";

/** #/library：选一个项目。 */
export function LibraryIndexPage() {
  const { world } = useGuild();
  const list = projects(world);
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">资料库</span>
          <h1 className="t-title-32">资料库</h1>
          <p className="muted">每个项目一个：设定图、截图、表格、文件，断网也能看；图上能钉意见。</p>
        </div>
      </div>
      {list.length === 0 ? (
        <Empty>还没有项目。</Empty>
      ) : (
        <div className="cards">
          {list.map((p) => {
            const n = libraryOf(world, p.id).length;
            return (
              <Link key={p.id} to={`/library/${p.id}`} className="card project-card" data-testid="library-project">
                <span className="label">{p.code}</span>
                <span className="t-heading-18">{p.name}</span>
                <span className="label">
                  {n} 个文件 · {pagesOf(world, p.id).length} 页资料
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

export function LibraryPage() {
  const { world, notify } = useGuild();
  const files = useFiles();
  const route = useRoute();
  const project = projectById(world, route.segments[1]);
  const [cutId, setCutId] = useState("");
  const [stageKey, setStageKey] = useState("");
  const [kind, setKind] = useState<"" | FileKind>("");
  const [tag, setTag] = useState("");
  const [by, setBy] = useState("");
  const [q, setQ] = useState("");
  const [order, setOrder] = useState<"new" | "old">("new");
  const [toCut, setToCut] = useState("");
  const [toStage, setToStage] = useState("");
  const [toTags, setToTags] = useState("");
  const [open, setOpen] = useState<Id | null>(null);
  const [more, setMore] = useState<Id | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useMemo(
    () => (project ? libraryOf(world, project.id, { cutId: cutId || null, stageKey: stageKey || null, kind: kind || null, tag: tag || null, byMemberId: by || null, q, order }) : []),
    [world, project, cutId, stageKey, kind, tag, by, q, order]
  );
  if (!project) return <NotFound what="这个项目" />;
  const facets = libraryFacets(world, project.id);
  const cuts = cutsOf(world, project.id);
  const stages = stagesOf(world, project.id);
  const pages = pagesOf(world, project.id);

  const intake = async (picked: File[]) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await files.addFiles(picked, {
        subjectType: toCut ? "cut" : "project",
        subjectId: toCut || project.id,
        stageKey: toStage || null,
        tags: toTags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean),
      });
      const parts = [r.fileIds.length ? `放进来 ${r.fileIds.length} 个` : null, r.matched ? `${r.matched} 个对上了原来的记录` : null, r.duplicates ? `${r.duplicates} 个已经在了` : null].filter(Boolean);
      if (r.errors.length) notify(r.errors[0], "Error");
      else notify(parts.join("，") || "没有放进来", parts.length ? "Success" : "Neutral");
    } finally {
      setBusy(false);
    }
  };

  const viewerFiles = list.map((v) => v.file);

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to="/library">资料库</Link>
            <span>/</span>
            <span>{project.name}</span>
          </div>
          <h1 className="t-title-32">{project.name} · 资料库</h1>
          <span className="label">
            {libraryOf(world, project.id).length} 个文件 · {pages.length} 页资料 · 文件存在这台设备的浏览器里，断网也能看
          </span>
        </div>
        <div className="page-head-actions">
          <Button Label="项目总览" Size="Small" Style="Secondary" onClick={() => navigate(`/project/${project.id}`)} />
        </div>
      </div>

      <section className="card" aria-label="放文件进来">
        <DropZone onFiles={(f) => void intake(f)} testId="library-drop" hint={busy ? "正在放…" : "多选、多个文件一次放都行。图片、PDF、.clip、.rar、表格……什么都能放。"} />
        <div className="form-grid">
          <SelectField label="挂到哪一卡" value={toCut} onChange={(e) => setToCut(e.target.value)} data-testid="library-to-cut">
            <option value="">不挂卡（资料库）</option>
            {cuts.map((c) => (
              <option key={c.id} value={c.id}>
                {cutName(world, c)}
              </option>
            ))}
          </SelectField>
          <SelectField label="哪个环节" value={toStage} onChange={(e) => setToStage(e.target.value)}>
            <option value="">不选</option>
            {stages.map((s) => (
              <option key={s.id} value={s.templateKey}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <TextField label="标签" placeholder="设定，参考" value={toTags} onChange={(e) => setToTags(e.target.value)} hint="用逗号隔开" />
        </div>
      </section>

      <section className="card" aria-labelledby="files-title">
        <div className="row" data-justify="between">
          <h2 id="files-title" className="t-heading-18">
            文件 <span className="count">{list.length}</span>
          </h2>
          <TextField label="搜文件名" type="search" value={q} onChange={(e) => setQ(e.target.value)} data-testid="library-search" />
        </div>
        <div className="filters" role="group" aria-label="筛">
          <SelectField label="卡" value={cutId} onChange={(e) => setCutId(e.target.value)} data-testid="library-filter-cut">
            <option value="">全部</option>
            {cuts.map((c) => (
              <option key={c.id} value={c.id}>
                {cutName(world, c)}
              </option>
            ))}
          </SelectField>
          <SelectField label="环节" value={stageKey} onChange={(e) => setStageKey(e.target.value)}>
            <option value="">全部</option>
            {stages
              .filter((s) => facets.stageKeys.includes(s.templateKey))
              .map((s) => (
                <option key={s.id} value={s.templateKey}>
                  {s.name}
                </option>
              ))}
          </SelectField>
          <SelectField label="类型" value={kind} onChange={(e) => setKind(e.target.value as "" | FileKind)} data-testid="library-filter-kind">
            <option value="">全部</option>
            {(Object.keys(FILE_KIND_LABEL) as FileKind[]).map((k) => (
              <option key={k} value={k}>
                {FILE_KIND_LABEL[k]}
              </option>
            ))}
          </SelectField>
          <SelectField label="标签" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">全部</option>
            {facets.tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectField>
          <SelectField label="谁传的" value={by} onChange={(e) => setBy(e.target.value)}>
            <option value="">全部</option>
            {facets.uploaders.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nickname}
              </option>
            ))}
          </SelectField>
          <SelectField label="排" value={order} onChange={(e) => setOrder(e.target.value as "new" | "old")}>
            <option value="new">新的在前</option>
            <option value="old">旧的在前</option>
          </SelectField>
        </div>
        {list.length === 0 ? (
          <Empty>{q || cutId || stageKey || kind || tag || by ? "没有对得上的文件。" : "还没有文件。把设定图、截图拖进来，或者直接粘贴。"}</Empty>
        ) : (
          <div className="file-grid" data-testid="library-grid">
            {list.map((v) => (
              <FileTile key={v.file.id} file={v.file} onOpen={() => setOpen(v.file.id)} onMore={() => setMore(v.file.id)} />
            ))}
          </div>
        )}
      </section>

      <PagesSection projectId={project.id} />

      {open ? <Viewer files={viewerFiles} startId={open} onClose={() => setOpen(null)} /> : null}
      {more ? <FileDialog fileId={more} onClose={() => setMore(null)} /> : null}
    </>
  );
}

function PagesSection({ projectId }: { projectId: Id }) {
  const { world, dispatch } = useGuild();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pages = pagesOf(world, projectId);
  return (
    <section className="card" aria-labelledby="pages-title">
      <h2 id="pages-title" className="t-heading-18">
        资料页 <span className="count">{pages.length}</span>
      </h2>
      {pages.length ? (
        <ul className="list">
          {pages.map((p) => (
            <li key={p.id}>
              <div className="list-main">
                <Link to={`/page/${p.id}`} className="t-body-14m" data-testid="page-link">
                  {p.title}
                </Link>
                <span className="label">
                  {blocksOf(world, p.id).length} 块 · {memberById(world, p.byMemberId)?.nickname ?? "有人"} · {dateZh(localDate(p.at))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>还没有资料页。</Empty>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const r = dispatch("page.create", { projectId, title }, { quiet: true });
          if (!r.ok) setError(r.error.message);
          else {
            setTitle("");
            setError(null);
            navigate(`/page/${r.created.pageId}`);
          }
        }}
      >
        <TextField label="新的一页" placeholder="色指定表" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="page-new-title" />
        <Button Label="建一页" Size="Small" Style="Secondary" type="submit" data-testid="page-new" />
      </form>
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
