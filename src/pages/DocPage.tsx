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

const BLOCK_LABEL: Record<BlockType, string> = { heading: "标题", text: "段落", image: "图片", gallery: "图片网格", file: "文件", checklist: "清单", divider: "分割线" };

export function DocPage() {
  const { world, dispatch, notify } = useGuild();
  const route = useRoute();
  const page = pageById(world, route.segments[1]);
  const [viewer, setViewer] = useState<{ files: FileRow[]; start: Id } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(page?.title ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!page) return <NotFound what="这一页" />;
  const project = projectById(world, page.projectId);
  const blocks = blocksOf(world, page.id);
  const pageImages = blocks.flatMap((b) => (b.type === "image" || b.type === "gallery" ? b.fileIds : [])).map((id) => world.files[id]).filter((f): f is FileRow => !!f && !f.archivedAt);

  return (
    <>
      <div className="page-head">
        <div className="page-head-text">
          <div className="crumbs">
            <Link to="/library">资料库</Link>
            <span>/</span>
            <Link to={`/library/${page.projectId}`}>{project?.name}</Link>
            <span>/</span>
            <span>资料页</span>
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
              <TextField label="页面标题" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Button Label="存" Size="Small" Style="Accent" type="submit" />
            </form>
          ) : (
            <h1 className="t-title-32 break" data-testid="page-title">
              {page.title}
            </h1>
          )}
          <span className="label">{blocks.length} 块 · 大家一起写，每一步都记在日志里</span>
        </div>
        <div className="page-head-actions">
          <Button Label="改标题" Size="Small" Style="Secondary" onClick={() => { setTitle(page.title); setRenaming(true); }} />
          <Button Label="删这页" Size="Small" Style="Ghost" onClick={() => setConfirmDelete(true)} />
        </div>
      </div>

      <article className="doc" data-testid="doc">
        {blocks.length === 0 ? <Empty>这一页还是空的。在下面加一块。</Empty> : null}
        {blocks.map((b, i) => (
          <BlockView key={b.id} block={b} first={i === 0} last={i === blocks.length - 1} onOpenImage={(start) => setViewer({ files: pageImages, start })} />
        ))}
        <AddBlock pageId={page.id} projectId={page.projectId} />
      </article>

      {viewer ? <Viewer files={viewer.files} startId={viewer.start} onClose={() => setViewer(null)} /> : null}
      {confirmDelete ? (
        <Drawer
          Type="Dialog"
          Title={`删「${page.title}」？`}
          Body="这一页从资料库里拿掉（日志里还留着）。页里的图还在资料库里。"
          open
          onClose={() => setConfirmDelete(false)}
          actions={
            <>
              <Button Label="不删" Style="Secondary" onClick={() => setConfirmDelete(false)} />
              <Button
                Label="删"
                onClick={() => {
                  const r = dispatch("page.archive", { pageId: page.id });
                  setConfirmDelete(false);
                  if (r.ok) {
                    notify("这一页删了", "Neutral");
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
              <button key={f.id} type="button" className="doc-image-btn" onClick={() => onOpenImage(f.id)} aria-label={`看 ${f.name}`} data-testid="doc-image">
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
      <div className="doc-block-tools" role="toolbar" aria-label={`${BLOCK_LABEL[block.type]}块`}>
        <button type="button" className="inline-link label" disabled={first} onClick={() => dispatch("block.move", { blockId: block.id, direction: "up" })} data-testid="block-up">
          ↑ 上移
        </button>
        <button type="button" className="inline-link label" disabled={last} onClick={() => dispatch("block.move", { blockId: block.id, direction: "down" })} data-testid="block-down">
          ↓ 下移
        </button>
        <button type="button" className="inline-link label" onClick={() => setComments((v) => !v)} aria-expanded={comments} data-testid="block-comments">
          评论{threads.length ? ` ${threads.length}` : ""}
        </button>
        <button type="button" className="inline-link label" onClick={() => dispatch("block.remove", { blockId: block.id })} data-testid="block-remove">
          删
        </button>
      </div>
      {comments ? <BlockComments blockId={block.id} /> : null}
    </section>
  );
}

function BlockImage({ file }: { file: FileRow }) {
  const { present, ready } = useFiles();
  if (ready && !present.has(file.sha256) && !file.thumb) return <MissingPlaceholder compact />;
  return (
    <>
      <FileImage file={file} className="doc-img" />
      {ready && !present.has(file.sha256) ? <span className="file-tile-missing">不在这台设备上</span> : null}
    </>
  );
}

function EditableText({ block }: { block: BlockRow }) {
  const { dispatch } = useGuild();
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
        aria-label={block.type === "heading" ? "标题" : "段落"}
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
    <Tag className={block.type === "heading" ? "t-heading-18 doc-heading" : "doc-text break"} onClick={() => setEditing(true)} title="点一下改字" data-testid="block-text">
      {block.text || <span className="label">（空的，点一下写）</span>}
    </Tag>
  );
}

function Checklist({ block }: { block: BlockRow }) {
  const { dispatch } = useGuild();
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
                {it.text || "（空的一条）"}
              </span>
            </label>
            <button type="button" className="inline-link label" aria-label={`删掉「${it.text}」`} onClick={() => set(block.items.filter((_, j) => j !== i))}>
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
        <input className="field-control" aria-label="加一条" placeholder="加一条" value={adding} onChange={(e) => setAdding(e.target.value)} />
        <Button Label="加" Size="Small" Style="Ghost" type="submit" />
      </form>
    </div>
  );
}

function BlockComments({ blockId }: { blockId: Id }) {
  const { world, dispatch } = useGuild();
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
          if (!r.ok) setError(r.error.message);
          else {
            setText("");
            setError(null);
          }
        }}
      >
        <textarea className="field-control" aria-label="对这一块的意见" placeholder="对这一块说的话" value={text} onChange={(e) => setText(e.target.value)} rows={2} data-testid="block-comment-text" />
        {error ? <p className="error-text">{error}</p> : null}
        <div className="form-actions">
          <Button Label="留下" Size="Small" Style="Secondary" type="submit" data-testid="block-comment-send" />
        </div>
      </form>
    </div>
  );
}

/** 加一块：选类型；图片 / 网格 / 文件块从资料库里选，或者直接放新的进来。 */
function AddBlock({ pageId, projectId }: { pageId: Id; projectId: Id }) {
  const { world, dispatch, notify } = useGuild();
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
      setError(r.error.message);
      return;
    }
    setText("");
    setPicked([]);
    setError(null);
  };
  return (
    <section className="doc-add card" data-tone="muted" aria-label="加一块" data-testid="block-add" {...drop.props} data-over={drop.over ? "yes" : "no"}>
      <div className="chips" role="radiogroup" aria-label="块的类型">
        {(Object.keys(BLOCK_LABEL) as BlockType[]).map((k) => (
          <button key={k} type="button" className="ui-chip" aria-pressed={type === k} onClick={() => { setType(k); setPicked([]); setError(null); }} data-testid={`block-type-${k}`}>
            {BLOCK_LABEL[k]}
          </button>
        ))}
      </div>
      {type === "heading" || type === "text" || type === "checklist" ? (
        <textarea
          className="field-control"
          aria-label={type === "checklist" ? "清单（一行一条）" : BLOCK_LABEL[type]}
          placeholder={type === "checklist" ? "一行一条" : type === "heading" ? "标题" : "写一段"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={type === "heading" ? 1 : 3}
          data-testid="block-add-text"
        />
      ) : null}
      {needsFiles ? (
        <div className="stack" data-gap="small">
          <div className="row">
            <AddFilesButton onFiles={(l) => void intake(l)} label="放新的进来" testId="block-add-files" accept={type === "file" ? undefined : "image/*"} />
            <span className="label">{type === "image" ? "选一张" : "可以选几张"}；也能直接拖进来或粘贴。</span>
          </div>
          {choices.length ? (
            <div className="pick-grid" role="group" aria-label="从资料库里选">
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
                  <span className="label break">{v.file.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="label">资料库里还没有{type === "file" ? "文件" : "图"}。</p>
          )}
        </div>
      ) : null}
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button Label={`加一块${BLOCK_LABEL[type]}`} Size="Small" Style="Accent" onClick={add} data-testid="block-add-go" />
      </div>
    </section>
  );
}
