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
import { localDate } from "@/domain/clock";
import { U, useI18n } from "@/i18n/I18n";
import type { FileKind } from "@/domain/queries";
import { FILE_KIND_LABEL, blocksOf, cutsOf, libraryFacets, libraryOf, pagesOf, projectById, projects, stagesOf, memberById } from "@/domain/queries";
import type { Id } from "@/domain/model";
import { useFiles } from "@/lib/files/FilesProvider";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { NotFound } from "./NotFound";

/** #/library：选一个项目。 */
export function LibraryIndexPage() {
  const { world } = useGuild();
  const { L, f } = useI18n();
  const list = projects(world);
  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <span className="label">{L.library.title}</span>
          <h1 className="t-title-32">{L.library.title}</h1>
          <p className="muted">{L.library.indexLead}</p>
        </div>
      </div>
      {list.length === 0 ? (
        <Empty>{L.library.noProjects}</Empty>
      ) : (
        <div className="cards">
          {list.map((p) => {
            const n = libraryOf(world, p.id).length;
            return (
              <Link key={p.id} to={`/library/${p.id}`} className="card project-card" data-testid="library-project">
                <span className="label">{p.code}</span>
                <span className="t-heading-18">
                  <U>{p.name}</U>
                </span>
                <span className="label">{f(L.library.projectStats, { n, pages: pagesOf(world, p.id).length })}</span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

/** 项目资料库。embedded = 放在项目页的「资料库」标签里（不要页头）。 */
export function LibraryPage({ projectId, embedded = false }: { projectId?: string; embedded?: boolean } = {}) {
  const { world, notify } = useGuild();
  const { L, f, r: rich, stageName, cut: cutOf } = useI18n();
  const files = useFiles();
  const route = useRoute();
  const project = projectById(world, projectId ?? route.segments[1]);
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
  if (!project) return <NotFound what="project" />;
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
      const parts = [r.fileIds.length ? f(L.library.added, { n: r.fileIds.length }) : null, r.matched ? f(L.library.matched, { n: r.matched }) : null, r.duplicates ? f(L.library.duplicates, { n: r.duplicates }) : null].filter(Boolean);
      if (r.errors.length) notify(r.errors[0], "Error");
      else notify(parts.join(L.common.clauseSep) || L.library.nothingAdded, parts.length ? "Success" : "Neutral");
    } finally {
      setBusy(false);
    }
  };

  const viewerFiles = list.map((v) => v.file);

  return (
    <>
      {embedded ? (
        <div className="row" data-justify="between">
          <span className="label">{f(L.library.stats, { n: libraryOf(world, project.id).length, pages: pages.length })}</span>
          <Link to={`/library/${project.id}`} className="ui-button" data-style="Secondary" data-size="Small" data-testid="project-library">
            {L.route.openLibrary}
          </Link>
        </div>
      ) : (
      <div className="page-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to="/library">{L.library.title}</Link>
            <span>/</span>
            <span>
              <U>{project.name}</U>
            </span>
          </div>
          <h1 className="t-title-32">{rich(L.library.titleOf, { project: <U>{project.name}</U> })}</h1>
          <span className="label">{f(L.library.stats, { n: libraryOf(world, project.id).length, pages: pages.length })}</span>
        </div>
        <div className="page-head-actions">
          <Button Label={L.library.projectHome} Size="Small" Style="Secondary" onClick={() => navigate(`/project/${project.id}`)} />
        </div>
      </div>
      )}

      <section className="card" aria-label={L.library.addFiles}>
        <DropZone onFiles={(fs) => void intake(fs)} testId="library-drop" hint={busy ? L.library.adding : L.library.dropHint} />
        <div className="form-grid">
          <SelectField label={L.library.toCut} value={toCut} onChange={(e) => setToCut(e.target.value)} data-testid="library-to-cut">
            <option value="">{L.library.noCut}</option>
            {cuts.map((c) => (
              <option key={c.id} value={c.id}>
                {cutOf(c, project.group)}
              </option>
            ))}
          </SelectField>
          <SelectField label={L.library.stage} value={toStage} onChange={(e) => setToStage(e.target.value)}>
            <option value="">{L.library.none}</option>
            {stages.map((s) => (
              <option key={s.id} value={s.templateKey}>
                {stageName(project.group, s)}
              </option>
            ))}
          </SelectField>
          <TextField label={L.library.tags} placeholder={L.library.tagsPlaceholder} value={toTags} onChange={(e) => setToTags(e.target.value)} hint={L.library.tagsHint} />
        </div>
      </section>

      <section className="card" aria-labelledby="files-title">
        <div className="row" data-justify="between">
          <h2 id="files-title" className="t-heading-18">
            {L.library.files} <span className="count">{list.length}</span>
          </h2>
          <TextField label={L.library.search} type="search" value={q} onChange={(e) => setQ(e.target.value)} data-testid="library-search" />
        </div>
        <div className="filters" role="group" aria-label={L.library.filters}>
          <SelectField label={L.library.cut} value={cutId} onChange={(e) => setCutId(e.target.value)} data-testid="library-filter-cut">
            <option value="">{L.library.all}</option>
            {cuts.map((c) => (
              <option key={c.id} value={c.id}>
                {cutOf(c, project.group)}
              </option>
            ))}
          </SelectField>
          <SelectField label={L.library.stageCol} value={stageKey} onChange={(e) => setStageKey(e.target.value)}>
            <option value="">{L.library.all}</option>
            {stages
              .filter((s) => facets.stageKeys.includes(s.templateKey))
              .map((s) => (
                <option key={s.id} value={s.templateKey}>
                  {stageName(project.group, s)}
                </option>
              ))}
          </SelectField>
          <SelectField label={L.library.kind} value={kind} onChange={(e) => setKind(e.target.value as "" | FileKind)} data-testid="library-filter-kind">
            <option value="">{L.library.all}</option>
            {(Object.keys(FILE_KIND_LABEL) as FileKind[]).map((k) => (
              <option key={k} value={k}>
                {L.labels.fileKind[k]}
              </option>
            ))}
          </SelectField>
          <SelectField label={L.library.tags} value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">{L.library.all}</option>
            {facets.tags.map((t) => (
              <option key={t} value={t} data-uc="">
                {t}
              </option>
            ))}
          </SelectField>
          <SelectField label={L.library.uploader} value={by} onChange={(e) => setBy(e.target.value)}>
            <option value="">{L.library.all}</option>
            {facets.uploaders.map((m) => (
              <option key={m.id} value={m.id} data-uc="">
                {m.nickname}
              </option>
            ))}
          </SelectField>
          <SelectField label={L.library.order} value={order} onChange={(e) => setOrder(e.target.value as "new" | "old")}>
            <option value="new">{L.library.newest}</option>
            <option value="old">{L.library.oldest}</option>
          </SelectField>
        </div>
        {list.length === 0 ? (
          <Empty>{q || cutId || stageKey || kind || tag || by ? L.library.noMatch : L.library.empty}</Empty>
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
  const { L, r: rich, err, date } = useI18n();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pages = pagesOf(world, projectId);
  return (
    <section className="card" aria-labelledby="pages-title">
      <h2 id="pages-title" className="t-heading-18">
        {L.library.pages} <span className="count">{pages.length}</span>
      </h2>
      {pages.length ? (
        <ul className="list">
          {pages.map((p) => (
            <li key={p.id}>
              <div className="list-main">
                <Link to={`/page/${p.id}`} className="t-body-14m" data-testid="page-link">
                  <U>{p.title}</U>
                </Link>
                <span className="label">
                  {rich(L.library.pageStats, {
                    n: blocksOf(world, p.id).length,
                    who: memberById(world, p.byMemberId) ? <U>{memberById(world, p.byMemberId)!.nickname}</U> : L.library.someone,
                    date: date(localDate(p.at)),
                  })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{L.library.noPages}</Empty>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const r = dispatch("page.create", { projectId, title }, { quiet: true });
          if (!r.ok) setError(err(r.error));
          else {
            setTitle("");
            setError(null);
            navigate(`/page/${r.created.pageId}`);
          }
        }}
      >
        <TextField label={L.library.newPage} placeholder={L.library.newPagePlaceholder} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="page-new-title" />
        <Button Label={L.library.createPage} Size="Small" Style="Secondary" type="submit" data-testid="page-new" />
      </form>
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
