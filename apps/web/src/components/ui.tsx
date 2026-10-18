// Design system: ≥48 px tap targets, high contrast (SPEC §2), premium festive look.
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { Link, type LinkProps } from 'react-router-dom';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'md' | 'lg' | 'sm';

const base =
  'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 select-none';
const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-br from-gold-light via-gold to-saffron text-night shadow-[var(--shadow-glow)] hover:brightness-105',
  dark: 'bg-plum text-white hover:bg-plum-2 shadow-[var(--shadow-card)]',
  secondary: 'border border-plum/15 bg-white text-plum hover:border-plum/35 hover:bg-sand/50',
  ghost: 'text-plum hover:bg-plum/5',
  danger: 'bg-danger text-white hover:brightness-110',
  success: 'bg-emerald text-white hover:brightness-110',
};
const sizes: Record<Size, string> = {
  sm: 'min-h-10 px-4 text-sm',
  md: 'min-h-12 px-5 text-[15px]',
  lg: 'min-h-14 px-7 text-base',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra?: string) {
  return cx(base, variants[variant], sizes[size], extra);
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...rest} />;
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return <Tag className={cx('card', className)}>{children}</Tag>;
}

type Tone = 'gold' | 'emerald' | 'rose' | 'plum' | 'muted' | 'danger' | 'saffron';
const tones: Record<Tone, string> = {
  gold: 'bg-gold-light/40 text-gold-deep ring-gold/30',
  emerald: 'bg-emerald-soft text-emerald ring-emerald/20',
  rose: 'bg-rose/10 text-rose ring-rose/20',
  plum: 'bg-plum/8 text-plum ring-plum/15',
  muted: 'bg-sand text-muted ring-line',
  danger: 'bg-danger-soft text-danger ring-danger/20',
  saffron: 'bg-saffron/12 text-saffron ring-saffron/25',
};

export function Badge({
  tone = 'plum',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PageTitle({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-xs font-bold tracking-[0.18em] text-gold-deep uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-semibold sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const fieldBase =
  'mt-1.5 block w-full min-h-12 rounded-2xl border border-line bg-white px-4 text-[15px] text-ink placeholder:text-muted/60 transition focus:border-gold focus:outline-none focus:ring-4 focus:ring-gold/20 disabled:bg-sand';

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block text-sm font-semibold text-ink', className)}>
      {label}
      {children}
      {hint && <span className="mt-1 block text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(fieldBase, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(fieldBase, 'py-3', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(fieldBase, 'appearance-auto pr-8', props.className)} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition disabled:opacity-50',
        checked ? 'bg-emerald' : 'bg-line',
      )}
    >
      <span
        className={cx(
          'inline-block h-6 w-6 rounded-full bg-white shadow transition',
          checked ? 'translate-x-7' : 'translate-x-1',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; sub?: ReactNode }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-2 overflow-x-auto pb-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex min-h-12 shrink-0 flex-col items-center justify-center rounded-2xl border px-4 py-2 text-sm font-semibold transition',
              active
                ? 'border-plum bg-plum text-white shadow-[var(--shadow-card)]'
                : 'border-line bg-white text-ink hover:border-plum/40',
            )}
          >
            <span>{o.label}</span>
            {o.sub && (
              <span
                className={cx('text-xs font-medium', active ? 'text-gold-light' : 'text-muted')}
              >
                {o.sub}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-10 text-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      {label}
    </div>
  );
}

export function EmptyState({
  icon = '✦',
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gold-light/40 text-2xl text-gold-deep">
        {icon}
      </div>
      <h2 className="text-xl font-semibold">{title}</h2>
      {body && <p className="mt-2 max-w-md text-muted">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: Tone }) {
  return (
    <div className="card px-5 py-4">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p
        className={cx(
          'mt-1 font-display text-3xl font-semibold',
          tone === 'emerald' && 'text-emerald',
          tone === 'rose' && 'text-rose',
          tone === 'gold' && 'text-gold-deep',
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function Notice({
  tone = 'gold',
  children,
  className,
}: {
  tone?: 'gold' | 'emerald' | 'danger' | 'plum';
  children: ReactNode;
  className?: string;
}) {
  const t = {
    gold: 'border-gold/40 bg-gold-light/25 text-ink',
    emerald: 'border-emerald/25 bg-emerald-soft text-emerald',
    danger: 'border-danger/25 bg-danger-soft text-danger',
    plum: 'border-plum/15 bg-plum/5 text-plum',
  }[tone];
  return <div className={cx('rounded-2xl border px-4 py-3 text-sm', t, className)}>{children}</div>;
}
