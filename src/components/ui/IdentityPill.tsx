/** 身份胶囊。 */

import { useEffect, useId, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Drawer } from "./Drawer";
import { ChevronIcon } from "./icons";
import type { AvatarTone } from "./avatarTone";

export type IdentityOption = {
  id: string;
  Name: string;
  Role: string;
  Tone: AvatarTone;
};

export type IdentityPillProps = {
  Name: string;
  Role: string;
  Tone?: AvatarTone;
  options?: IdentityOption[];
  onSwitch?: (id: string) => void;
};

export function IdentityPill({ Name, Role, Tone = "Peach", options = [], onSwitch }: IdentityPillProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<IdentityOption | null>(null);
  const [cursor, setCursor] = useState(0);
  const menuId = useId();
  const root = useRef<HTMLSpanElement>(null);

  function choose(option: IdentityOption) {
    if (option.Name === Name && option.Role === Role) {
      setOpen(false);
      return;
    }
    setPending(option);
  }

  useEffect(() => {
    if (!open) return;
    const index = options.findIndex((option) => option.Name === Name && option.Role === Role);
    setCursor(index >= 0 ? index : 0);
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) {
        setPending(null);
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPending(null);
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, options, Name, Role]);

  function onMenuKey(event: React.KeyboardEvent) {
    if (pending) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (options.length === 0) return;
      setCursor((index) => {
        const step = event.key === "ArrowDown" ? 1 : -1;
        return (index + step + options.length) % options.length;
      });
      return;
    }
    if (!open || event.key !== "Enter") return;
    event.preventDefault();
    const option = options[cursor];
    if (option) choose(option);
  }

  return (
    <span className="ui-popover" ref={root} onKeyDown={onMenuKey}>
      <button
        type="button"
        className="ui-identity"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={menuId}
        aria-activedescendant={open && options[cursor] ? `${menuId}-${options[cursor].id}` : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar Initials={Name} Tone={Tone} Size="28" title={`${Name} · ${Role}`} />
        <span className="ui-identity-name">{Name}</span>
        <span className="ui-identity-role">{Role}</span>
        <ChevronIcon size={16} />
      </button>
      {open ? (
        <ul className="ui-menu" id={menuId} role="listbox">
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`${menuId}-${option.id}`}
              role="option"
              aria-selected={option.Name === Name && option.Role === Role}
              data-active={index === cursor}
              onClick={() => choose(option)}
            >
              {option.Name} · {option.Role}
            </li>
          ))}
        </ul>
      ) : null}
      {pending ? (
        <Drawer
          Type="Dialog"
          open
          onClose={() => setPending(null)}
          Title="换成这个身份？"
          Body={`${pending.Name} · ${pending.Role}`}
          actions={
            <>
              <Button Label="取消" Style="Ghost" Size="Small" onClick={() => setPending(null)} />
              <Button
                Label="确认"
                Style="Accent"
                Size="Small"
                onClick={() => {
                  onSwitch?.(pending.id);
                  setPending(null);
                  setOpen(false);
                }}
              />
            </>
          }
        />
      ) : null}
    </span>
  );
}
