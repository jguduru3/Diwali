// Better Analytics design system: action blue, flat 1px-border cards, 8px controls, sentence
// case, ≥44 px tap targets and high contrast (SPEC §2).
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Inbox } from 'lucide-react';
import { Icon } from './Icon';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'md' | 'lg' | 'sm';

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 select-none';
const variants: Record<Variant, string> = {
  primary: 'bg-plum text-white hover:bg-plum-2',
  dark: 'bg-night text-white hover:bg-plum-2',
  secondary: 'border border-line-strong bg-white text-ink hover:bg-ivory',
  ghost: 'text-plum hover:bg-brand-050',
  danger: 'bg-danger text-white hover:brightness-110',
  success: 'bg-emerald text-white hover:brightness-110',
};
const sizes: Record<Size, string> = {
  sm: 'min-h-10 px-3 text-[13px]',
  md: 'min-h-11 px-4 text-[15px]',
  lg: 'min-h-12 px-6 text-base',
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
  onClick,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <Tag className={cx('card', className)} onClick={onClick}>
      {children}
    </Tag>
  );
}

type Tone = 'gold' | 'emerald' | 'rose' | 'plum' | 'muted' | 'danger' | 'saffron';
// Status badges: colour always comes with a word; text sits on the matching -bg token.
const tones: Record<Tone, string> = {
  gold: 'bg-brand-050 text-gold-deep ring-brand-100',
  emerald: 'bg-emerald-soft text-emerald ring-emerald/20',
  rose: 'bg-danger-soft text-rose ring-rose/20',
  plum: 'bg-brand-050 text-plum ring-brand-100',
  muted: 'bg-ivory text-muted ring-line',
  danger: 'bg-danger-soft text-danger ring-danger/20',
  saffron: 'bg-saffron-bg text-saffron ring-saffron/20',
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
        'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
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
        <h1 className="text-[28px] leading-[34px] font-extrabold sm:text-[40px] sm:leading-[44px]">
          {title}
        </h1>
        {subtitle && <p className="mt-2 max-w-2xl text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const fieldBase =
  'mt-1.5 block w-full min-h-11 rounded-xl border border-line-strong bg-white px-3 text-[15px] text-ink placeholder:text-subtle transition focus:border-plum focus:outline-2 focus:outline-offset-2 focus:outline-plum disabled:bg-sand';

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
    <label className={cx('block text-[13px] leading-4 font-semibold text-ink', className)}>
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
  return (
    <select
      {...props}
      className={cx(fieldBase, 'field-select appearance-auto pr-8', props.className)}
    />
  );
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
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50',
        checked ? 'bg-plum' : 'bg-line-strong',
      )}
    >
      <span
        className={cx(
          'inline-block h-5 w-5 rounded-full bg-white shadow transition',
          checked ? 'translate-x-6' : 'translate-x-1',
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
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; sub?: ReactNode }[];
  label: string;
  disabled?: boolean;
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
            disabled={disabled}
            onClick={() => !disabled && onChange(o.value)}
            className={cx(
              'flex min-h-11 shrink-0 flex-col items-center justify-center rounded-xl border px-4 py-2 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
              active
                ? 'border-plum bg-plum text-white'
                : 'border-line-strong bg-white text-ink hover:bg-ivory',
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
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-plum border-t-transparent" />
      {label}
    </div>
  );
}

export function EmptyState({
  icon = <Icon icon={Inbox} className="h-6 w-6" />,
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
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-brand-050 text-xl text-plum">
        {icon}
      </div>
      <h2 className="text-xl font-bold">{title}</h2>
      {body && <p className="mt-2 max-w-md text-muted">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="card p-5 sm:p-6">
      <p className="text-[13px] leading-4 font-semibold text-muted">{label}</p>
      <p
        className={cx(
          'mt-2 font-display text-[32px] leading-9 font-extrabold tracking-tight tabular-nums sm:text-[40px] sm:leading-[44px]',
          tone === 'emerald' && 'text-emerald',
          tone === 'rose' && 'text-rose',
          tone === 'gold' && 'text-gold-deep',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
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
    gold: 'border-brand-100 bg-brand-050 text-ink',
    emerald: 'border-emerald/25 bg-emerald-soft text-emerald',
    danger: 'border-danger/25 bg-danger-soft text-danger',
    plum: 'border-brand-100 bg-brand-050 text-plum',
  }[tone];
  return <div className={cx('rounded-xl border px-4 py-3 text-sm', t, className)}>{children}</div>;
}
