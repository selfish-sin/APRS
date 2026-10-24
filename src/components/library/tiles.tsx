/** 资料库的格子：图片缩略图 · 非图片的文件卡 · 不在这台设备上的占位 · 文件信息和改名 / 标签 / 挪 / 拿掉。 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { MemberLink, SelectField, Tag, TextField } from "@/components/app/bits";
import { isReviewer } from "@/domain/commands/core";
import { U, useI18n } from "@/i18n/I18n";
import type { FileRow, Id } from "@/domain/model";
import { cutsOf, extOf, fileKind, fileView, projectById, sizeLabel } from "@/domain/queries";
import { t2 } from "@/domain/text";
import { saveToDevice } from "@/lib/download";
import { useFiles, useFileUrl } from "@/lib/files/FilesProvider";
import { useGuild } from "@/lib/store";

export const MISSING_TEXT = t2("这个文件不在这台设备上", "This file isn't on this device");

/** 一张图（原图有就用原图，不然用记录里的小缩略图）。 */
export function FileImage({ file, className, alt, full = false }: { file: FileRow; className?: string; alt?: string; full?: boolean }) {
  const url = useFileUrl(file.sha256);
  const src = url ?? (full ? null : file.thumb);
  if (!src) return null;
  return <img className={className} src={src} alt={alt ?? file.name} draggable={false} />;
}

export function MissingPlaceholder({ compact = false }: { compact?: boolean }) {
  const { L } = useI18n();
  return (
    <div className="file-missing" data-testid="file-missing">
      <span className="t-body-14m">{L.library.missing}</span>
      {compact ? null : <span className="label">{L.library.missingHint}</span>}
    </div>
  );
}

/** 格子：图片 = 缩略图；别的 = 文件卡（类型 · 大小）。 */
export function FileTile({ file, onOpen, onMore }: { file: FileRow; onOpen: () => void; onMore?: () => void }) {
  const { world } = useGuild();
  const { present, ready } = useFiles();
  const { L, f, ph } = useI18n();
  const v = fileView(world, file);
  const here = present.has(file.sha256);
  const image = v.kind === "image";
  return (
    <figure className="file-tile" data-kind={v.kind} data-here={here || !ready ? "yes" : "no"} data-testid="file-tile">
      <button type="button" className="file-tile-open" onClick={onOpen} aria-label={f(L.library.openFile, { name: file.name })}>
        {image && (here || file.thumb) ? (
          <FileImage file={file} className="file-tile-img" />
        ) : (
          <span className="file-tile-card">
            <span className="file-ext">{extOf(file.name).toUpperCase() || L.library.fileFallback}</span>
            <span className="label">
              {L.labels.fileKind[v.kind]} · {sizeLabel(file.size)}
            </span>
          </span>
        )}
        {ready && !here ? <span className="file-tile-missing">{L.library.notHere}</span> : null}
        {v.pins.open ? (
          <span className="file-tile-pins" aria-label={f(L.library.openPins, { n: v.pins.open })}>
            {v.pins.open}
          </span>
        ) : null}
      </button>
      <figcaption>
        <span className="file-tile-name break" title={file.name} data-uc="">
          {file.name}
        </span>
        <span className="label break">
          {ph(v.whereP)} · {v.uploader ? <U>{v.uploader.nickname}</U> : L.library.someone}
        </span>
        {onMore ? (
          <button type="button" className="inline-link label" onClick={onMore} data-testid="file-more">
            {L.library.info}
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
  const { L, say } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      Label={busy ? L.library.saving : L.library.saveToDevice}
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
          if (r.ok) notify(say((d) => d.library.savedAs, { name: { uc: file.name } }));
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
  const { L, ph, dateTime } = useI18n();
  const v = fileView(world, file);
  return (
    <dl className="facts">
      <dt>{L.library.factKind}</dt>
      <dd>
        {L.labels.fileKind[fileKind(file)]}
        {extOf(file.name) ? ` · .${extOf(file.name)}` : ""}
      </dd>
      <dt>{L.library.factSize}</dt>
      <dd className="num">{sizeLabel(file.size)}</dd>
      {file.width && file.height ? (
        <>
          <dt>{L.library.factDims}</dt>
          <dd className="num">
            {file.width} × {file.height}
          </dd>
        </>
      ) : null}
      <dt>{L.library.uploader}</dt>
      <dd>
        <MemberLink member={v.uploader} />
      </dd>
      <dt>{L.library.factWhere}</dt>
      <dd className="break">{ph(v.whereP)}</dd>
      <dt>{L.library.factWhen}</dt>
      <dd>{dateTime(file.at)}</dd>
      {file.tags.length ? (
        <>
          <dt>{L.library.tags}</dt>
          <dd className="row">
            {file.tags.map((t) => (
              <Tag key={t}>
                <U>{t}</U>
              </Tag>
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
  const { L, err, say, cut: cutOf } = useI18n();
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
    if (name.trim() !== file.name) steps.push(["rename", () => dispatch("file.rename", { fileId, name }, { quiet: true })]);
    const nextTags = tags.split(/[,，、\s]+/).map((t) => t.trim()).filter(Boolean);
    if (nextTags.join("|") !== file.tags.join("|")) steps.push(["tags", () => dispatch("file.tag", { fileId, tags: nextTags }, { quiet: true })]);
    if (movable && (cutId || "") !== (file.subjectType === "cut" ? file.subjectId : "")) {
      steps.push(["move", () => dispatch("file.move", { fileId, subjectType: cutId ? "cut" : "project", subjectId: cutId || file.projectId }, { quiet: true })]);
    }
    for (const [, run] of steps) {
      const r = run();
      if (!r.ok) {
        setError(err(r.error));
        return;
      }
    }
    if (steps.length) notify(say((d) => d.library.edited));
    onClose();
  };
  return (
    <Drawer
      Type="Dialog"
      Title={<U>{file.name}</U>}
      open
      onClose={onClose}
      actions={
        <>
          <SaveFileButton file={file} />
          <Button Label={L.library.close} Style="Secondary" onClick={onClose} />
          {editable ? <Button Label={L.library.save} Style="Accent" onClick={save} data-testid="file-dialog-save" /> : null}
        </>
      }
    >
      <div className="stack" data-gap="small">
        {!present.has(file.sha256) ? <MissingPlaceholder /> : null}
        <FileFacts file={file} />
        {editable ? (
          <>
            <TextField label={L.library.fileName} value={name} onChange={(e) => setName(e.target.value)} data-testid="file-rename" />
            <TextField label={L.library.tags} value={tags} onChange={(e) => setTags(e.target.value)} hint={L.library.tagsHint8} data-testid="file-tags" />
            {movable ? (
              <SelectField label={L.library.factWhere} value={cutId} onChange={(e) => setCutId(e.target.value)}>
                <option value="">{L.library.noCutWhere}</option>
                {cutsOf(world, file.projectId).map((c) => (
                  <option key={c.id} value={c.id}>
                    {cutOf(c, projectById(world, file.projectId)?.group)}
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
                Label={L.library.archive}
                Size="Small"
                Style="Ghost"
                onClick={() => {
                  const r = dispatch("file.archive", { fileId }, { quiet: true });
                  if (!r.ok) setError(err(r.error));
                  else {
                    notify(say((d) => d.library.archived), "Neutral");
                    onClose();
                  }
                }}
              />
            </div>
          </>
        ) : (
          <p className="label">{L.library.onlyEditors}</p>
        )}
      </div>
    </Drawer>
  );
}
