/** 资料库的格子：图片缩略图 · 非图片的文件卡 · 不在这台设备上的占位 · 文件信息和改名 / 标签 / 挪 / 拿掉。 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { MemberLink, SelectField, Tag, TextField } from "@/components/app/bits";
import { isReviewer } from "@/domain/commands/core";
import { dateTimeZh } from "@/domain/clock";
import type { FileRow, Id } from "@/domain/model";
import { cutsOf, cutName, extOf, fileKind, fileView, FILE_KIND_LABEL, sizeLabel } from "@/domain/queries";
import { saveToDevice } from "@/lib/download";
import { useFiles, useFileUrl } from "@/lib/files/FilesProvider";
import { useGuild } from "@/lib/store";

export const MISSING_TEXT = "这个文件不在这台设备上";

/** 一张图（原图有就用原图，不然用记录里的小缩略图）。 */
export function FileImage({ file, className, alt, full = false }: { file: FileRow; className?: string; alt?: string; full?: boolean }) {
  const url = useFileUrl(file.sha256);
  const src = url ?? (full ? null : file.thumb);
  if (!src) return null;
  return <img className={className} src={src} alt={alt ?? file.name} draggable={false} />;
}

export function MissingPlaceholder({ compact = false }: { compact?: boolean }) {
  return (
    <div className="file-missing" data-testid="file-missing">
      <span className="t-body-14m">{MISSING_TEXT}</span>
      {compact ? null : <span className="label">把同一个文件拖进资料库就能对上（按内容认）。</span>}
    </div>
  );
}

/** 格子：图片 = 缩略图；别的 = 文件卡（类型 · 大小）。 */
export function FileTile({ file, onOpen, onMore }: { file: FileRow; onOpen: () => void; onMore?: () => void }) {
  const { world } = useGuild();
  const { present, ready } = useFiles();
  const v = fileView(world, file);
  const here = present.has(file.sha256);
  const image = v.kind === "image";
  return (
    <figure className="file-tile" data-kind={v.kind} data-here={here || !ready ? "yes" : "no"} data-testid="file-tile">
      <button type="button" className="file-tile-open" onClick={onOpen} aria-label={`打开 ${file.name}`}>
        {image && (here || file.thumb) ? (
          <FileImage file={file} className="file-tile-img" />
        ) : (
          <span className="file-tile-card">
            <span className="file-ext">{extOf(file.name).toUpperCase() || "文件"}</span>
            <span className="label">
              {v.kindLabel} · {sizeLabel(file.size)}
            </span>
          </span>
        )}
        {ready && !here ? <span className="file-tile-missing">不在这台设备上</span> : null}
        {v.pins.open ? (
          <span className="file-tile-pins" aria-label={`${v.pins.open} 个没解决的钉`}>
            {v.pins.open}
          </span>
        ) : null}
      </button>
      <figcaption>
        <span className="file-tile-name break" title={file.name}>
          {file.name}
        </span>
        <span className="label break">
          {v.where} · {v.uploader?.nickname ?? "有人"}
        </span>
        {onMore ? (
          <button type="button" className="inline-link label" onClick={onMore} data-testid="file-more">
            信息 · 改
          </button>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** 保存到这台设备（只在点按钮时）。 */
export function SaveFileButton({ file, style = "Secondary" }: { file: FileRow; style?: "Secondary" | "Ghost" | "Accent" }) {
  const { getBlob, present } = useFiles();
  const { notify } = useGuild();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      Label={busy ? "正在保存…" : "保存到这台设备"}
      Size="Small"
      Style={style}
      disabled={busy || !present.has(file.sha256)}
      data-testid="file-save"
      onClick={async () => {
        setBusy(true);
        try {
          const blob = await getBlob(file.sha256);
          if (!blob) {
            notify(MISSING_TEXT, "Error");
            return;
          }
          const r = await saveToDevice(file.name, blob);
          if (r.ok) notify(`存好了：${file.name}`);
          else if (r.reason !== "declined") notify(r.message, "Error");
          else notify(r.message, "Neutral");
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

export function FileFacts({ file }: { file: FileRow }) {
  const { world } = useGuild();
  const v = fileView(world, file);
  return (
    <dl className="facts">
      <dt>类型</dt>
      <dd>
        {FILE_KIND_LABEL[fileKind(file)]}
        {extOf(file.name) ? ` · .${extOf(file.name)}` : ""}
      </dd>
      <dt>大小</dt>
      <dd className="num">{sizeLabel(file.size)}</dd>
      {file.width && file.height ? (
        <>
          <dt>尺寸</dt>
          <dd className="num">
            {file.width} × {file.height}
          </dd>
        </>
      ) : null}
      <dt>谁传的</dt>
      <dd>
        <MemberLink member={v.uploader} />
      </dd>
      <dt>挂在哪</dt>
      <dd className="break">{v.where}</dd>
      <dt>什么时候</dt>
      <dd>{dateTimeZh(file.at)}</dd>
      {file.tags.length ? (
        <>
          <dt>标签</dt>
          <dd className="row">
            {file.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

/** 文件信息 + 改名 · 改标签 · 挪到别的卡 · 从资料库里拿掉 · 保存到这台设备。 */
export function FileDialog({ fileId, onClose }: { fileId: Id; onClose: () => void }) {
  const { world, me, dispatch, notify } = useGuild();
  const { present } = useFiles();
  const file = world.files[fileId];
  const [name, setName] = useState(file?.name ?? "");
  const [tags, setTags] = useState(file?.tags.join("，") ?? "");
  const [cutId, setCutId] = useState<string>(file?.subjectType === "cut" ? file.subjectId : "");
  const [error, setError] = useState<string | null>(null);
  if (!file || file.archivedAt) return null;
  const editable = file.byMemberId === me.id || isReviewer(me);
  const movable = file.subjectType === "project" || file.subjectType === "cut";
  const save = () => {
    const steps: [string, () => ReturnType<typeof dispatch>][] = [];
    if (name.trim() !== file.name) steps.push(["改名", () => dispatch("file.rename", { fileId, name }, { quiet: true })]);
    const nextTags = tags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean);
    if (nextTags.join("|") !== file.tags.join("|")) steps.push(["标签", () => dispatch("file.tag", { fileId, tags: nextTags }, { quiet: true })]);
    if (movable && (cutId || "") !== (file.subjectType === "cut" ? file.subjectId : "")) {
      steps.push(["挪", () => dispatch("file.move", { fileId, subjectType: cutId ? "cut" : "project", subjectId: cutId || file.projectId }, { quiet: true })]);
    }
    for (const [, run] of steps) {
      const r = run();
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
    }
    if (steps.length) notify("改好了");
    onClose();
  };
  return (
    <Drawer
      Type="Dialog"
      Title={file.name}
      open
      onClose={onClose}
      actions={
        <>
          <SaveFileButton file={file} />
          <Button Label="关" Style="Secondary" onClick={onClose} />
          {editable ? <Button Label="存" Style="Accent" onClick={save} data-testid="file-dialog-save" /> : null}
        </>
      }
    >
      <div className="stack" data-gap="small">
        {!present.has(file.sha256) ? <MissingPlaceholder /> : null}
        <FileFacts file={file} />
        {editable ? (
          <>
            <TextField label="文件名" value={name} onChange={(e) => setName(e.target.value)} data-testid="file-rename" />
            <TextField label="标签" value={tags} onChange={(e) => setTags(e.target.value)} hint="用逗号隔开，最多 8 个" data-testid="file-tags" />
            {movable ? (
              <SelectField label="挂在哪" value={cutId} onChange={(e) => setCutId(e.target.value)}>
                <option value="">资料库（不挂卡）</option>
                {cutsOf(world, file.projectId).map((c) => (
                  <option key={c.id} value={c.id}>
                    {cutName(world, c)}
                  </option>
                ))}
              </SelectField>
            ) : null}
            {error ? (
              <p className="error-text" role="alert">
                {error}
              </p>
            ) : null}
            <div className="form-actions">
              <Button
                Label="从资料库里拿掉"
                Size="Small"
                Style="Ghost"
                onClick={() => {
                  const r = dispatch("file.archive", { fileId }, { quiet: true });
                  if (!r.ok) setError(r.error.message);
                  else {
                    notify("拿掉了（记录还在日志里）", "Neutral");
                    onClose();
                  }
                }}
              />
            </div>
          </>
        ) : (
          <p className="label">只有传的人、审核员或管理员可以改这个文件。</p>
        )}
      </div>
    </Drawer>
  );
}
