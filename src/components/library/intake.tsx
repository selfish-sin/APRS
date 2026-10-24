/**
 * 放文件进来的三种办法（SPEC §11.2）：拖进来 · 点「添加文件」选 · 直接粘贴截图（Ctrl/⌘+V）。多个一次放。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/I18n";

/** 拖进来：返回给容器用的事件和「正在拖」的状态。 */
export function useDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const has = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  return {
    over,
    props: {
      onDragEnter: (e: React.DragEvent) => {
        if (!has(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e: React.DragEvent) => {
        if (!has(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        if (!has(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length) onFiles(files);
      },
    },
  };
}

/**
 * 粘贴截图：页面上任何地方 Ctrl/⌘+V（只粘字的时候不管）。
 * 同时有几处在等粘贴（比如卡详情上开了「交」的对话框）时，只给最后打开的那一处。
 */
const pasteStack: number[] = [];
let pasteSeq = 0;

export function usePaste(onFiles: (files: File[]) => void, enabled = true) {
  const ref = useRef(onFiles);
  ref.current = onFiles;
  useEffect(() => {
    if (!enabled) return;
    const id = ++pasteSeq;
    pasteStack.push(id);
    const onPaste = (e: ClipboardEvent) => {
      if (pasteStack[pasteStack.length - 1] !== id) return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const files = items.filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => !!f);
      if (!files.length) return;
      e.preventDefault();
      ref.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
      const i = pasteStack.indexOf(id);
      if (i >= 0) pasteStack.splice(i, 1);
    };
  }, [enabled]);
}

export function AddFilesButton({ onFiles, label, accept, testId, style = "Secondary" }: { onFiles: (files: File[]) => void; label?: string; accept?: string; testId?: string; style?: "Secondary" | "Accent" | "Ghost" | "Primary" }) {
  const input = useRef<HTMLInputElement>(null);
  const { L } = useI18n();
  return (
    <>
      <Button Label={label ?? L.library.addFile} Size="Small" Style={style} onClick={() => input.current?.click()} data-testid={testId} />
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={accept}
        data-testid={testId ? `${testId}-input` : undefined}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

/** 一块能拖进来的区域，里面放「添加文件」按钮和提示。 */
export function DropZone({ onFiles, hint, children, testId, paste = true }: { onFiles: (files: File[]) => void; hint?: string; children?: ReactNode; testId?: string; paste?: boolean }) {
  const drop = useDrop(onFiles);
  const { L } = useI18n();
  usePaste(onFiles, paste);
  return (
    <div className="dropzone" data-over={drop.over ? "yes" : "no"} data-testid={testId} {...drop.props}>
      <div className="dropzone-text">
        <span className="t-body-14m">{paste ? L.library.dropOrPaste : L.library.dropHere}</span>
        {hint ? <span className="label">{hint}</span> : null}
      </div>
      <div className="row">
        <AddFilesButton onFiles={onFiles} testId={testId ? `${testId}-pick` : undefined} />
        {children}
      </div>
    </div>
  );
}
