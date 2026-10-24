/**
 * 资料页（SPEC §11.5）：像 Notion，但以图为主。块：标题 · 段落 · 图片（单张 / 多张网格）· 文件 · 清单 · 分割线。
 * 能加块、删块、上下移动、改字；图片块点开就是看图器（能钉）；每个块也能留评论。
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Empty, TextField } from "@/components/app/bits";
import { ThreadBody } from "@/components/app/thread";
import { AddFilesButton, useDrop, usePaste } from "@/components/library/intake";
import { FileImage, FileTile, MissingPlaceholder } from "@/components/library/tiles";
import { Viewer } from "@/components/library/Viewer";
import type { BlockRow, BlockType, ChecklistItem, FileRow, Id } from "@/domain/model";
import { blocksOf, fileKind, libraryOf, pageById, projectById } from "@/domain/queries";
import { useFiles } from "@/lib/files/FilesProvider";
import { Link, navigate, useRoute } from "@/lib/router";
import { useGuild } from "@/lib/store";
import { NotFound } from "./NotFound";
import { U, useI18n } from "@/i18n/I18n";

const BLOCK_TYPES: BlockType[] = ["heading", "text", "image", "gallery", "file", "checklist", "divider"];

export function DocPage() {
  const { world, dispatch, notify } = useGuild();
  const { L, f, r: rich, say } = useI18n();
  const route = useRoute();
  const page = pageById(world, route.segments[1]);
  const [viewer, setViewer] = useState<{ files: FileRow[]; start: Id } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(page?.title ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!page) return <NotFound what="doc" />;
  const project = projectById(world, page.projectId);
  const blocks = blocksOf(world, page.id);
  const pageImages = blocks.flatMap((b) => (b.type === "image" || b.type === "gallery" ? b.fileIds : [])).map((id) => world.files[id]).filter((f): f is FileRow => !!f && !f.archivedAt);

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to="/library">{L.library.title}</Link>
            <span>/</span>
            <Link to={`/library/${page.projectId}`}>
              <U>{project?.name}</U>
            </Link>
            <span>/</span>
            <span>{L.doc.page}</span>
          </div>
          {renaming ? (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                const r = dispatch("page.rename", { pageId: page.id, title });
                if (r.ok) setRenaming(false);
              }}
            >
              <TextField label={L.doc.pageTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
              <Button Label={L.doc.save} Size="Small" Style="Accent" type="submit" />
            </form>
          ) : (
            <h1 className="t-title-32 break" data-testid="page-title" data-uc="">
              {page.title}
            </h1>
          )}
          <span className="label">{f(L.doc.stats, { n: blocks.length })}</span>
        </div>
        <div className="page-head-actions">
          <Button Label={L.doc.rename} Size="Small" Style="Secondary" onClick={() => { setTitle(page.title); setRenaming(true); }} />
          <Button Label={L.doc.delete} Size="Small" Style="Ghost" onClick={() => setConfirmDelete(true)} />
        </div>
      </div>

      <article className="doc" data-testid="doc">
        {blocks.length === 0 ? <Empty>{L.doc.empty}</Empty> : null}
        {blocks.map((b, i) => (
          <BlockView key={b.id} block={b} first={i === 0} last={i === blocks.length - 1} onOpenImage={(start) => setViewer({ files: pageImages, start })} />
        ))}
        <AddBlock pageId={page.id} projectId={page.projectId} />
      </article>

      {viewer ? <Viewer files={viewer.files} startId={viewer.start} onClose={() => setViewer(null)} /> : null}
      {confirmDelete ? (
        <Drawer
          Type="Dialog"
          Title={rich(L.doc.deleteTitle, { title: <U>{page.title}</U> })}
          Body={L.doc.deleteBody}
          open
          onClose={() => setConfirmDelete(false)}
          actions={
            <>
              <Button Label={L.doc.keep} Style="Secondary" onClick={() => setConfirmDelete(false)} />
              <Button
                Label={L.doc.confirmDelete}
                onClick={() => {
                  const r = dispatch("page.archive", { pageId: page.id });
                  setConfirmDelete(false);
                  if (r.ok) {
                    notify(say((d) => d.doc.deleted), "Neutral");
                    navigate(`/library/${page.projectId}`);
                  }
                }}
              />
            </>
          }
        />
      ) : null}
    </>
  );
}

function BlockView({ block, first, last, onOpenImage }: { block: BlockRow; first: boolean; last: boolean; onOpenImage: (fileId: Id) => void }) {
  const { world, dispatch } = useGuild();
  const { L, f: tf } = useI18n();
  const [comments, setComments] = useState(false);
  const threads = Object.values(world.threads).filter((t) => t.subjectType === "block" && t.subjectId === block.id && !t.archivedAt);
  const files = block.fileIds.map((id) => world.files[id]).filter((f): f is FileRow => !!f);
  return (
    <section className="doc-block" data-type={block.type} data-testid="doc-block">
      <div className="doc-block-body">
        {block.type === "heading" || block.type === "text" ? <EditableText block={block} /> : null}
        {block.type === "divider" ? <hr className="doc-divider" /> : null}
        {block.type === "image" || block.type === "gallery" ? (
          <div className={block.type === "gallery" ? "doc-gallery" : "doc-image"}>
            {files.map((f) => (
              <button key={f.id} type="button" className="doc-image-btn" onClick={() => onOpenImage(f.id)} aria-label={tf(L.doc.viewImage, { name: f.name })} data-testid="doc-image">
                <BlockImage file={f} />
              </button>
            ))}
          </div>
        ) : null}
        {block.type === "file" ? (
          <div className="file-grid">
            {files.map((f) => (
              <FileTile key={f.id} file={f} onOpen={() => onOpenImage(f.id)} />
            ))}
          </div>
        ) : null}
        {block.type === "checklist" ? <Checklist block={block} /> : null}
      </div>
      <div className="doc-block-tools" role="toolbar" aria-label={tf(L.doc.blockTools, { type: L.doc.block[block.type] })}>
        <button type="button" className="inline-link label" disabled={first} onClick={() => dispatch("block.move", { blockId: block.id, direction: "up" })} data-testid="block-up">
          {L.doc.up}
        </button>
        <button type="button" className="inline-link label" disabled={last} onClick={() => dispatch("block.move", { blockId: block.id, direction: "down" })} data-testid="block-down">
          {L.doc.down}
        </button>
        <button type="button" className="inline-link label" onClick={() => setComments((v) => !v)} aria-expanded={comments} data-testid="block-comments">
          {L.doc.comments}
          {threads.length ? ` ${threads.length}` : ""}
        </button>
        <button type="button" className="inline-link label" onClick={() => dispatch("block.remove", { blockId: block.id })} data-testid="block-remove">
          {L.doc.remove}
        </button>
      </div>
      {comments ? <BlockComments blockId={block.id} /> : null}
    </section>
  );
}

function BlockImage({ file }: { file: FileRow }) {
  const { present, ready } = useFiles();
  const { L } = useI18n();
  if (ready && !present.has(file.sha256) && !file.thumb) return <MissingPlaceholder compact />;
  return (
    <>
      <FileImage file={file} className="doc-img" />
      {ready && !present.has(file.sha256) ? <span className="file-tile-missing">{L.library.notHere}</span> : null}
    </>
  );
}

function EditableText({ block }: { block: BlockRow }) {
  const { dispatch } = useGuild();
  const { L } = useI18n();
  const [text, setText] = useState(block.text ?? "");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(block.text ?? "");
  }, [block.text, editing]);
  const save = () => {
    setEditing(false);
    if (text !== (block.text ?? "")) dispatch("block.update", { blockId: block.id, text });
  };
  if (editing) {
    return (
      <textarea
        className="field-control doc-edit"
        data-heading={block.type === "heading" ? "yes" : "no"}
        aria-label={L.doc.block[block.type]}
        value={text}
        autoFocus
        rows={block.type === "heading" ? 1 : Math.min(12, Math.max(3, text.split("\n").length + 1))}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setText(block.text ?? "");
            setEditing(false);
          }
          if (e.key === "Enter" && (block.type === "heading" || e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
        data-testid="block-edit"
      />
    );
  }
  const Tag = block.type === "heading" ? "h2" : "p";
  return (
    <Tag className={block.type === "heading" ? "t-heading-18 doc-heading" : "doc-text break"} onClick={() => setEditing(true)} title={L.doc.clickToEdit} data-testid="block-text">
      {block.text ? <U>{block.text}</U> : <span className="label">{L.doc.emptyText}</span>}
    </Tag>
  );
}

function Checklist({ block }: { block: BlockRow }) {
  const { dispatch } = useGuild();
  const { L, f } = useI18n();
  const [adding, setAdding] = useState("");
  const set = (items: ChecklistItem[]) => dispatch("block.update", { blockId: block.id, items });
  return (
    <div className="stack" data-gap="small">
      <ul className="doc-checklist">
        {block.items.map((it, i) => (
          <li key={i}>
            <label className="check-row">
              <input type="checkbox" checked={it.done} onChange={() => set(block.items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
              <span className="break" data-done={it.done ? "yes" : "no"}>
                {it.text ? <U>{it.text}</U> : L.doc.emptyItem}
              </span>
            </label>
            <button type="button" className="inline-link label" aria-label={f(L.doc.removeItem, { text: it.text })} onClick={() => set(block.items.filter((_, j) => j !== i))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!adding.trim()) return;
          set([...block.items.filter((x) => x.text), { text: adding, done: false }]);
          setAdding("");
        }}
      >
        <input className="field-control" aria-label={L.doc.addItem} placeholder={L.doc.addItem} value={adding} onChange={(e) => setAdding(e.target.value)} />
        <Button Label={L.doc.add} Size="Small" Style="Ghost" type="submit" />
      </form>
    </div>
  );
}

function BlockComments({ blockId }: { blockId: Id }) {
  const { world, dispatch } = useGuild();
  const { L, err } = useI18n();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const threads = Object.values(world.threads).filter((t) => t.subjectType === "block" && t.subjectId === blockId && !t.archivedAt);
  return (
    <div className="doc-comments stack" data-gap="small">
      {threads.map((t) => (
        <ThreadBody key={t.id} thread={t} />
      ))}
      <form
        className="stack"
        data-gap="small"
        onSubmit={(e) => {
          e.preventDefault();
          const r = dispatch("thread.open", { subjectType: "block", subjectId: blockId, kind: "comment", text }, { quiet: true });
          if (!r.ok) setError(err(r.error));
          else {
            setText("");
            setError(null);
          }
        }}
      >
        <textarea className="field-control" aria-label={L.doc.commentLabel} placeholder={L.doc.commentPlaceholder} value={text} onChange={(e) => setText(e.target.value)} rows={2} data-testid="block-comment-text" />
        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <Button Label={L.doc.leave} Size="Small" Style="Secondary" type="submit" data-testid="block-comment-send" />
        </div>
      </form>
    </div>
  );
}

/** 加一块：选类型；图片 / 网格 / 文件块从资料库里选，或者直接放新的进来。 */
function AddBlock({ pageId, projectId }: { pageId: Id; projectId: Id }) {
  const { world, dispatch, notify } = useGuild();
  const { L, f, err } = useI18n();
  const files = useFiles();
  const [type, setType] = useState<BlockType>("text");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Id[]>([]);
  const [error, setError] = useState<string | null>(null);
  const needsFiles = type === "image" || type === "gallery" || type === "file";
  const choices = useMemo(() => libraryOf(world, projectId).filter((v) => (type === "file" ? true : v.kind === "image")), [world, projectId, type]);
  const intake = async (list: File[]) => {
    const r = await files.addFiles(list, { subjectType: "page", subjectId: pageId });
    if (r.errors.length) notify(r.errors[0], "Error");
    // 新放进来的 + 本来就在的同一个文件，都选上。
    const ids = [...r.fileIds, ...r.existing];
    if (ids.length) setPicked((xs) => (type === "image" ? ids.slice(0, 1) : Array.from(new Set([...xs, ...ids]))));
  };
  const drop = useDrop((l) => void intake(l));
  usePaste((l) => void intake(l), needsFiles);
  const add = () => {
    const input =
      type === "heading" || type === "text"
        ? { pageId, type, text }
        : type === "checklist"
          ? { pageId, type, items: text.split("\n").map((t) => ({ text: t.trim(), done: false })).filter((x) => x.text) }
          : type === "divider"
            ? { pageId, type }
            : { pageId, type, fileIds: picked };
    const r = dispatch("block.add", input, { quiet: true });
    if (!r.ok) {
      setError(err(r.error));
      return;
    }
    setText("");
    setPicked([]);
    setError(null);
  };
  return (
    <section className="doc-add card" data-tone="muted" aria-label={L.doc.addBlock} data-testid="block-add" {...drop.props} data-over={drop.over ? "yes" : "no"}>
      <div className="chips" role="radiogroup" aria-label={L.doc.blockType}>
        {BLOCK_TYPES.map((k) => (
          <button key={k} type="button" className="ui-chip" aria-pressed={type === k} onClick={() => { setType(k); setPicked([]); setError(null); }} data-testid={`block-type-${k}`}>
            {L.doc.block[k]}
          </button>
        ))}
      </div>
      {type === "heading" || type === "text" || type === "checklist" ? (
        <textarea
          className="field-control"
          aria-label={type === "checklist" ? L.doc.checklistLabel : L.doc.block[type]}
          placeholder={type === "checklist" ? L.doc.onePerLine : type === "heading" ? L.doc.block.heading : L.doc.writePara}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={type === "heading" ? 1 : 3}
          data-testid="block-add-text"
        />
      ) : null}
      {needsFiles ? (
        <div className="stack" data-gap="small">
          <div className="row">
            <AddFilesButton onFiles={(l) => void intake(l)} label={L.doc.addNew} testId="block-add-files" accept={type === "file" ? undefined : "image/*"} />
            <span className="label">{type === "image" ? L.doc.pickOne : L.doc.pickSome}</span>
          </div>
          {choices.length ? (
            <div className="pick-grid" role="group" aria-label={L.doc.pickFromLibrary}>
              {choices.map((v) => (
                <button
                  key={v.file.id}
                  type="button"
                  className="pick-tile"
                  aria-pressed={picked.includes(v.file.id)}
                  onClick={() => setPicked((xs) => (type === "image" ? [v.file.id] : xs.includes(v.file.id) ? xs.filter((x) => x !== v.file.id) : [...xs, v.file.id]))}
                  data-testid="block-pick"
                >
                  {fileKind(v.file) === "image" ? <FileImage file={v.file} className="pick-img" /> : <span className="file-ext">{v.file.name.split(".").pop()?.toUpperCase()}</span>}
                  <span className="label break" data-uc="">
                    {v.file.name}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="label">{type === "file" ? L.doc.noFiles : L.doc.noImages}</p>
          )}
        </div>
      ) : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label={f(L.doc.addBlockOf, { type: L.doc.block[type] })} Size="Small" Style="Accent" onClick={add} data-testid="block-add-go" />
      </div>
    </section>
  );
}
