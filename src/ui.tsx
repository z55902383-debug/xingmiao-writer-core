import { tr } from "./i18n";
import {
  useEffect,
  useRef,
  useId,
  useState,
  cloneElement,
  type ReactNode,
  type ReactElement,
} from "react";
import { X, CircleNotch, CaretDown } from "@phosphor-icons/react";
export function Button({
  children,
  variant = "",
  className = "",
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${variant} ${className}`}
      aria-busy={busy || undefined}
    >
      {busy && <CircleNotch className="spin" size={16} />}
      {children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      className={`icon-button ${props.className || ""}`}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const dialog = ref.current;
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <IconButton label={tr("关闭弹窗")} onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: ReactNode;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
/**
 * 低频操作收纳菜单。用原生 details 拿到键盘操作与语义，
 * 只额外补「点外部关闭」「Esc 关闭」「点条目后关闭」三件事。
 */
export function Menu({
  label,
  icon,
  trigger,
  align = "end",
  children,
}: {
  label: string;
  icon?: ReactNode;
  trigger?: ReactNode;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute("open");
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ref.current?.open) {
        close();
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <details className="menu" ref={ref}>
      <summary className="button menu-trigger" aria-label={label}>
        {trigger ?? (
          <>
            {icon}
            {label}
            <CaretDown size={14} />
          </>
        )}
      </summary>
      <div
        className={`menu-panel ${align === "start" ? "align-start" : ""}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("button")) close();
        }}
      >
        {children}
      </div>
    </details>
  );
}
/**
 * 可拖动的分隔条：把「这块区域要多大」交给作者自己定。
 * 平时只是一条极细的线（不抢注意力），鼠标移上去或拖动时才亮起并露出抓手，
 * 所以安静时干净、要找的时候又很好点。
 * 双击回到默认值；键盘聚焦后用方向键也能调，Home/End 直达两端。
 */
export function Splitter({
  axis,
  value,
  min,
  max,
  onChange,
  onReset,
  measure,
  label,
  invert = false,
  className = "",
}: {
  /** x = 竖着的条（左右拖）；y = 横着的条（上下拖） */
  axis: "x" | "y";
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  onReset?: () => void;
  label: string;
  /** 反向：往左 / 往上拖反而变大（右侧栏、底部区域用它） */
  invert?: boolean;
  /**
   * 按下时现取一次真实尺寸，作为这次拖动的起点。
   * 区域还是「自动尺寸」时，它的高度会随内容与相邻面板宽度变化，
   * 缓存值会过期 —— 现取就能保证不会一按下去就跳。
   */
  measure?: () => number | undefined;
  className?: string;
}) {
  const drag = useRef<{ at: number; from: number } | null>(null);
  const [active, setActive] = useState(false);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const pos = (e: { clientX: number; clientY: number }) =>
    axis === "x" ? e.clientX : e.clientY;
  const start = () => {
    const live = measure?.();
    return typeof live === "number" && Number.isFinite(live)
      ? clamp(live)
      : value;
  };

  // 拖动期间给 body 挂个全局标记：光标全程保持双向箭头，也不会误选文字。
  useEffect(() => {
    if (!active) return;
    const cls = axis === "x" ? "is-resizing-x" : "is-resizing-y";
    document.body.classList.add(cls);
    return () => document.body.classList.remove(cls);
  }, [active, axis]);

  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { at: pos(e), from: start() };
    setActive(true);
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    onChange(clamp(d.from + (pos(e) - d.at) * (invert ? -1 : 1)));
  }
  function up(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    setActive(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function key(e: React.KeyboardEvent<HTMLDivElement>) {
    const at = start();
    const step = 18 * (invert ? -1 : 1);
    const back = axis === "x" ? "ArrowLeft" : "ArrowUp";
    const fwd = axis === "x" ? "ArrowRight" : "ArrowDown";
    if (e.key === back) onChange(clamp(at - step));
    else if (e.key === fwd) onChange(clamp(at + step));
    else if (e.key === "Home") onChange(clamp(min));
    else if (e.key === "End") onChange(clamp(max));
    else return;
    e.preventDefault();
  }

  return (
    <div
      className={`splitter ${className}`}
      data-axis={axis}
      data-active={active ? "true" : "false"}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={onReset}
      onKeyDown={key}
    />
  );
}
