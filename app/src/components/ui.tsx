// Small building blocks used by every screen.
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "../lib/format";
import { platformColor } from "../lib/platforms";

type Variant = "primary" | "default" | "ghost" | "danger";
type Size = "small" | "normal" | "big";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-bg hover:bg-accent-hover",
  default: "bg-raised text-fg border border-line hover:border-line-strong",
  ghost: "text-fg hover:bg-raised",
  danger: "bg-bad/10 text-bad border border-bad/40 hover:bg-bad/20",
};
const SIZES: Record<Size, string> = {
  // 44px is the smallest comfortable size to tap on a phone; desktops can be a little tighter.
  small: "min-h-[44px] px-3.5 text-[13px] md:min-h-[40px]",
  normal: "min-h-[44px] px-5 text-sm",
  big: "min-h-[52px] px-6 text-base",
};

/** Classes for anything that should look like a button (also links). */
export function buttonClass(variant: Variant = "default", size: Size = "normal", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition active:scale-[0.98]",
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

export function Button({
  variant = "default",
  size = "normal",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return (
    <div id={id} className={cx("rounded-xl border border-line bg-surface p-5 shadow-soft", className)}>
      {children}
    </div>
  );
}

export type Tone = "ok" | "warn" | "bad" | "";
const PILL: Record<string, string> = {
  ok: "bg-ok/15 text-ok",
  warn: "bg-warn/15 text-warn",
  bad: "bg-bad/15 text-bad",
  "": "bg-raised text-muted",
};

export function Pill({ tone = "", children, id }: { tone?: Tone; children: ReactNode; id?: string }) {
  return (
    <span id={id} className={cx("pill inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", PILL[tone])}>
      {children}
    </span>
  );
}

export function PlatformDot({ id, className }: { id: string; className?: string }) {
  return <span aria-hidden className={cx("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)} style={{ background: platformColor(id) }} />;
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-transparent align-[-3px]", className)} />;
}

/** A grey block that sweeps while something loads. Give it a size with className. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("skeleton rounded-xl", className)} />;
}

/** What a list shows when there is nothing in it yet: a small still record, one plain sentence, and what to do next. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-line-strong px-5 py-6 sm:flex-row sm:items-center">
      <span aria-hidden className="record h-14 w-14 shrink-0 shadow-none">
        <span className="record-label" />
      </span>
      <div className="space-y-2 text-muted">
        <p>{children}</p>
        {action}
      </div>
    </div>
  );
}

const NOTICE: Record<string, string> = {
  ok: "border-ok/40 bg-ok/10",
  warn: "border-warn/40 bg-warn/10",
  bad: "border-bad/40 bg-bad/10",
  "": "border-line bg-raised",
};

export function Notice({ tone = "", children, role, id, className }: { tone?: Tone; children: ReactNode; role?: string; id?: string; className?: string }) {
  return (
    <div id={id} role={role} className={cx("rounded-xl border px-4 py-3 text-sm", NOTICE[tone], className)}>
      {children}
    </div>
  );
}

export function PageTitle({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-muted">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

/**
 * A native <dialog>: Esc closes it and the browser keeps focus inside while open.
 * `onClose` runs however it was closed (button, Esc, or code).
 */
export function Dialog({
  open,
  onClose,
  title,
  id,
  titleId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  id?: string;
  titleId?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const labelId = titleId ?? (id ? `${id}-title` : undefined);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      id={id}
      aria-labelledby={labelId}
      onClose={onClose}
      className="m-auto max-h-[85vh] w-[min(640px,calc(100vw-24px))] rounded-2xl border border-line bg-surface p-0 text-fg shadow-lift backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h3 id={labelId} className="min-w-0 truncate font-semibold">
          {title}
        </h3>
        <Button size="small" variant="ghost" onClick={() => ref.current?.close()} id={id ? `${id}-close` : undefined}>
          Close
        </Button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}

/** A tappable playlist cover that can be selected (used by Move and Back up). */
export function CoverCard({
  name,
  subtitle,
  imageUrl,
  liked,
  selected,
  onToggle,
  action,
}: {
  name: string;
  subtitle: string;
  imageUrl?: string;
  liked?: boolean;
  selected: boolean;
  onToggle: () => void;
  action?: ReactNode;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={selected}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onToggle();
        }
      }}
      className={cx(
        "cover-card group relative cursor-pointer overflow-hidden rounded-xl border bg-surface transition hover:-translate-y-0.5 hover:shadow-lift active:scale-[0.99]",
        selected ? "selected border-accent ring-1 ring-accent" : "border-line hover:border-line-strong",
      )}
    >
      <div
        className={cx(
          "flex aspect-square items-center justify-center text-3xl font-bold",
          liked ? "bg-gradient-to-br from-accent to-accent-deep text-bg" : "bg-raised text-muted",
        )}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : liked ? (
          "♥"
        ) : (
          (name?.[0] ?? "♪").toUpperCase()
        )}
      </div>
      <span
        aria-hidden
        className={cx(
          "absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold transition",
          selected ? "bg-accent text-bg" : "bg-bg/70 text-transparent",
        )}
      >
        ✓
      </span>
      <div className="p-3">
        <div className="truncate text-sm font-semibold" title={name}>
          {name}
        </div>
        <div className="text-xs text-muted">{subtitle}</div>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
