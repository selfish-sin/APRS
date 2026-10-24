/** 菜单。 */

import { useEffect, useId, useRef, useState } from "react";
import { ChevronIcon } from "./icons";

export type MenuItemData = {
  id: string;
  Label: string;
  Meta?: string;
  "Show meta"?: boolean;
};

export type MenuProps = {
  Label?: string;
  items: MenuItemData[];
  value?: string;
  onValue?: (id: string) => void;
};

export function MenuItem({
  id,
  Label,
  Meta,
  "Show meta": showMeta = false,
  Selected = false,
  Active = false,
  onSelect,
}: {
  id: string;
  Label: string;
  Meta?: string;
  "Show meta"?: boolean;
  Selected?: boolean;
  Active?: boolean;
  onSelect?: () => void;
}) {
  return (
    <li id={id} className="ui-select-item" role="option" aria-selected={Selected} data-active={Active} onClick={onSelect}>
      <span>{Label}</span>
      {showMeta && Meta ? <span className="ui-select-meta">{Meta}</span> : null}
    </li>
  );
}

export function Menu({ Label, items, value, onValue }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const current = items.find((item) => item.id === value) ?? items[0];

  useEffect(() => {
    if (!open) return;
    const index = items.findIndex((item) => item.id === current?.id);
    setCursor(index >= 0 ? index : 0);
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [open, items, current?.id]);

  function choose(index: number) {
    const item = items[index];
    if (!item) return;
    onValue?.(item.id);
    setOpen(false);
  }

  function onKey(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (items.length === 0) return;
      setCursor((index) => {
        const step = event.key === "ArrowDown" ? 1 : -1;
        return (index + step + items.length) % items.length;
      });
      return;
    }
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(cursor);
    }
  }

  const activeId = items[cursor] ? `${listId}-${items[cursor].id}` : undefined;

  return (
    <div className="ui-select" ref={root} onKeyDown={onKey}>
      <button
        type="button"
        className="ui-select-trigger"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-activedescendant={open ? activeId : undefined}
        onClick={() => setOpen((next) => !next)}
      >
        {Label ? <span className="ui-select-label">{Label}</span> : null}
        <span>{current?.Label}</span>
        <ChevronIcon size={16} />
      </button>
      {open ? (
        <ul className="ui-select-panel" id={listId} role="listbox">
          {items.map((item, index) => (
            <MenuItem
              key={item.id}
              id={`${listId}-${item.id}`}
              Label={item.Label}
              Meta={item.Meta}
              {...{ "Show meta": item["Show meta"] }}
              Selected={item.id === current?.id}
              Active={index === cursor}
              onSelect={() => choose(index)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
