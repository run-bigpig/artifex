import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import "./ThemeSelect.css";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export default function ThemeSelect({
  value,
  onChange,
  options,
  label,
  placeholder = "请选择",
  disabled = false,
  editable = false,
  className = "",
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  editable?: boolean;
  className?: string;
  title?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLInputElement | HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<React.CSSProperties>({
    visibility: "hidden",
  });
  const visible =
    editable && query
      ? options.filter((o) =>
          `${o.label} ${o.value}`.toLowerCase().includes(query.toLowerCase()),
        )
      : options;
  const selected = options.find((o) => o.value === value);
  const enabled = visible
    .map((o, i) => (o.disabled ? -1 : i))
    .filter((i) => i >= 0);
  const show = () => {
    if (disabled) return;
    setQuery("");
    const selectedIndex = options.findIndex(
      (o) => o.value === value && !o.disabled,
    );
    setActive(
      selectedIndex >= 0
        ? selectedIndex
        : options.findIndex((o) => !o.disabled),
    );
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = visible[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!open || !root.current) return;
    const place = (event?: Event) => {
      if (
        event?.target instanceof Node &&
        popup.current?.contains(event.target)
      )
        return;
      const rect = root.current!.getBoundingClientRect();
      let parent = root.current!.parentElement;
      while (parent) {
        if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) {
          const clip = parent.getBoundingClientRect();
          if (rect.bottom <= clip.top || rect.top >= clip.bottom) {
            setOpen(false);
            return;
          }
        }
        parent = parent.parentElement;
      }
      const below = window.innerHeight - rect.bottom - 14;
      const above = rect.top - 14;
      const desired = Math.min(280, Math.max(1, visible.length) * 36 + 10);
      const upwards = below < desired && above > below;
      const height = Math.min(desired, Math.max(40, upwards ? above : below));
      const width = Math.min(rect.width, window.innerWidth - 24);
      setPosition({
        width,
        maxHeight: height,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: upwards ? rect.top - height - 6 : rect.bottom + 6,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, visible.length]);

  useLayoutEffect(() => {
    if (!open || !popup.current || active < 0) return;
    const item = document.getElementById(`${id}-${active}`);
    const panel = popup.current;
    if (item) {
      if (item.offsetTop < panel.scrollTop) panel.scrollTop = item.offsetTop;
      else if (
        item.offsetTop + item.offsetHeight >
        panel.scrollTop + panel.clientHeight
      )
        panel.scrollTop =
          item.offsetTop + item.offsetHeight - panel.clientHeight;
    }
  }, [active, open, id, position.maxHeight]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !popup.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);

  const keyDown = (event: React.KeyboardEvent) => {
    const key = event.key;
    if (key === "Tab") {
      setOpen(false);
      return;
    }
    if (key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      const index = enabled.indexOf(active);
      if (index < 0) {
        setActive(
          key === "ArrowDown" ? (enabled[0] ?? -1) : (enabled.at(-1) ?? -1),
        );
        return;
      }
      setActive(
        enabled[
          (index + (key === "ArrowDown" ? 1 : -1) + enabled.length) %
            enabled.length
        ] ?? -1,
      );
      return;
    }
    if (!editable && (key === "Home" || key === "End")) {
      event.preventDefault();
      if (!open) show();
      setActive(key === "Home" ? (enabled[0] ?? -1) : (enabled.at(-1) ?? -1));
      return;
    }
    if (key === "Enter" || (!editable && key === " ")) {
      event.preventDefault();
      if (open) {
        if (active >= 0) choose(active);
        else setOpen(false);
      } else show();
      return;
    }
    if (
      !editable &&
      key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const now = Date.now();
      search.current.text =
        (now - search.current.at < 700 ? search.current.text : "") +
        key.toLowerCase();
      search.current.at = now;
      if (!open) show();
      const index = visible.findIndex(
        (o) =>
          !o.disabled && o.label.toLowerCase().startsWith(search.current.text),
      );
      if (index >= 0) setActive(index);
    }
  };
  const accessibility = {
    role: "combobox",
    "aria-label": label,
    "aria-expanded": open,
    "aria-controls": open ? id : undefined,
    "aria-haspopup": "listbox" as const,
    "aria-activedescendant":
      open && active >= 0 && visible[active] ? `${id}-${active}` : undefined,
  };
  return (
    <div ref={root} className={`theme-select ${className}`}>
      {editable ? (
        <div className="theme-select__editable">
          <input
            {...accessibility}
            aria-autocomplete="list"
            ref={(node) => {
              trigger.current = node;
            }}
            className="theme-select__trigger theme-select__input"
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            title={title || value}
            onKeyDown={keyDown}
            onClick={() => {
              if (!open) show();
            }}
            onChange={(event) => {
              onChange(event.target.value);
              setQuery(event.target.value);
              setActive(-1);
              setOpen(true);
            }}
          />
          <button
            type="button"
            className="theme-select__expand"
            tabIndex={-1}
            disabled={disabled}
            aria-label={`展开${label}候选`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              trigger.current?.focus({ preventScroll: true });
              if (open) setOpen(false);
              else show();
            }}
          >
            <ChevronDown size={14} className={open ? "is-open" : ""} />
          </button>
        </div>
      ) : (
        <button
          {...accessibility}
          ref={(node) => {
            trigger.current = node;
          }}
          type="button"
          className="theme-select__trigger"
          disabled={disabled}
          title={title || selected?.label || value}
          onKeyDown={keyDown}
          onClick={() => (open ? setOpen(false) : show())}
        >
          <span className="theme-select__value">
            {selected?.label || value || placeholder}
          </span>
          <ChevronDown size={14} className={open ? "is-open" : ""} />
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="listbox"
            aria-label={label}
            className="theme-select__popup"
            style={position}
            onClick={(event) => event.stopPropagation()}
          >
            {visible.length ? (
              visible.map((option, index) => (
                <div
                  key={`${option.value}:${index}`}
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={value === option.value}
                  aria-disabled={option.disabled || undefined}
                  className={`theme-select__option${active === index ? " is-active" : ""}`}
                  title={option.label}
                  onMouseEnter={() => {
                    if (!option.disabled) setActive(index);
                  }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    choose(index);
                  }}
                >
                  <span>{option.label}</span>
                  {value === option.value && <Check size={14} />}
                </div>
              ))
            ) : (
              <div className="theme-select__empty">
                无匹配模型，可直接输入模型 ID
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
