import React, {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ArrowRight, LoaderCircle, PackageOpen } from 'lucide-react';

const cx = (...tokens: Array<string | false | null | undefined>) =>
  tokens.filter(Boolean).join(' ');

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    startIcon,
    endIcon,
    disabled,
    className,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || props['aria-busy']}
      className={cx('ds-btn', `ds-btn--${variant}`, `ds-btn--${size}`, className)}
    >
      {loading ? <LoaderCircle className="ds-spin" size={17} aria-hidden="true" /> : startIcon && <span className="ds-btn__icon" aria-hidden="true">{startIcon}</span>}
      {size !== 'icon' && children != null && <span className="ds-btn__label">{children}</span>}
      {!loading && size !== 'icon' && endIcon && <span className="ds-btn__icon" aria-hidden="true">{endIcon}</span>}
      {size === 'icon' && children}
    </button>
  );
});

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  fieldLabel?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { fieldLabel, hint, error, id, className, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, ...props },
  ref,
) {
  const generatedId = useId().replace(/:/g, '');
  const inputId = id || `ds-input-${generatedId}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [ariaDescribedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control = (
    <input
      {...props}
      ref={ref}
      id={inputId}
      className={cx('ds-input', className)}
      aria-invalid={error ? true : ariaInvalid}
      aria-describedby={describedBy}
    />
  );
  if (!fieldLabel && !hint && !error) return control;
  return (
    <div className="ds-field">
      {fieldLabel != null && <label className="ds-field__label" htmlFor={inputId}>{fieldLabel}</label>}
      {control}
      {hint != null && <span id={hintId} className="ds-field__hint">{hint}</span>}
      {error != null && <span id={errorId} className="ds-field__error" role="alert">{error}</span>}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  fieldLabel?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { fieldLabel, hint, error, id, className, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, ...props },
  ref,
) {
  const generatedId = useId().replace(/:/g, '');
  const inputId = id || `ds-textarea-${generatedId}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [ariaDescribedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control = (
    <textarea
      {...props}
      ref={ref}
      id={inputId}
      className={cx('ds-input', 'ds-textarea', className)}
      aria-invalid={error ? true : ariaInvalid}
      aria-describedby={describedBy}
    />
  );
  if (!fieldLabel && !hint && !error) return control;
  return (
    <div className="ds-field">
      {fieldLabel != null && <label className="ds-field__label" htmlFor={inputId}>{fieldLabel}</label>}
      {control}
      {hint != null && <span id={hintId} className="ds-field__hint">{hint}</span>}
      {error != null && <span id={errorId} className="ds-field__error" role="alert">{error}</span>}
    </div>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  fieldLabel?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { fieldLabel, hint, error, id, className, 'aria-describedby': ariaDescribedBy, 'aria-invalid': ariaInvalid, children, ...props },
  ref,
) {
  const generatedId = useId().replace(/:/g, '');
  const selectId = id || `ds-select-${generatedId}`;
  const hintId = hint ? `${selectId}-hint` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;
  const describedBy = [ariaDescribedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control = (
    <select
      {...props}
      ref={ref}
      id={selectId}
      className={cx('ds-input', 'ds-select', className)}
      aria-invalid={error ? true : ariaInvalid}
      aria-describedby={describedBy}
    >
      {children}
    </select>
  );
  if (!fieldLabel && !hint && !error) return control;
  return (
    <div className="ds-field">
      {fieldLabel != null && <label className="ds-field__label" htmlFor={selectId}>{fieldLabel}</label>}
      {control}
      {hint != null && <span id={hintId} className="ds-field__hint">{hint}</span>}
      {error != null && <span id={errorId} className="ds-field__error" role="alert">{error}</span>}
    </div>
  );
});

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'standard' | 'raised' | 'flat' | 'interactive';
}
export const Card: React.FC<CardProps> = ({ variant = 'standard', className, ...props }) => (
  <div {...props} className={cx('ds-card', variant === 'standard' ? '' : `ds-card--${variant}`, className)} />
);

export const CardHeader: React.FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div {...props} className={cx('ds-card__header', className)} />
);
export const CardBody: React.FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div {...props} className={cx('ds-card__body', className)} />
);
export const CardFooter: React.FC<HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div {...props} className={cx('ds-card__footer', className)} />
);

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
}
export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', icon, className, children, ...props }) => (
  <span {...props} className={cx('ds-badge', tone !== 'neutral' && `ds-badge--${tone}`, className)}>
    {icon && <span className="ds-btn__icon" aria-hidden="true">{icon}</span>}
    {children}
  </span>
);

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  status?: 'online' | 'offline';
}
export const Avatar: React.FC<AvatarProps> = ({ name, src, size = 'md', status, className, ...props }) => {
  const initials = name.trim().slice(0, 1) || '؟';
  return (
    <span {...props} className={cx('ds-avatar', size !== 'md' && `ds-avatar--${size}`, className)} role="img" aria-label={name || 'کاربر'}>
      {src ? <img className="ds-avatar__image" src={src} alt="" loading="lazy" /> : initials}
      {status && <span className={cx('ds-avatar__status', status === 'online' && 'ds-avatar__status--online')} aria-label={status === 'online' ? 'آنلاین' : 'آفلاین'} />}
    </span>
  );
};

export interface ListItemProps {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}
export const ListItem: React.FC<ListItemProps> = ({
  title, description, leading, trailing, href, onClick, disabled, active = false, className,
}) => {
  const content = (
    <>
      {leading != null && <span className="ds-list-item__leading">{leading}</span>}
      <span className="ds-list-item__content">
        <span className="ds-list-item__title">{title}</span>
        {description != null && <span className="ds-list-item__description">{description}</span>}
      </span>
      {trailing != null && <span className="ds-list-item__trailing">{trailing}</span>}
    </>
  );
  const classes = cx('ds-list-item', (href || onClick) && 'ds-list-item--interactive', active && 'is-active', className);
  if (href) return <a href={href} className={classes} aria-current={active ? 'page' : undefined}>{content}</a>;
  if (onClick) return <button type="button" className={classes} onClick={onClick} disabled={disabled} aria-current={active ? 'page' : undefined}>{content}</button>;
  return <div className={classes}>{content}</div>;
};

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}
export const EmptyState: React.FC<EmptyStateProps> = ({ title, description, icon, action, className }) => (
  <div className={cx('ds-empty-state', className)}>
    <div className="ds-empty-state__icon" aria-hidden="true">{icon ?? <PackageOpen size={25} />}</div>
    <h3 className="ds-empty-state__title">{title}</h3>
    {description != null && <p className="ds-empty-state__description">{description}</p>}
    {action}
  </div>
);

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  shape?: 'text' | 'heading' | 'circle' | 'rect';
  width?: string | number;
  height?: string | number;
}
export const Skeleton: React.FC<SkeletonProps> = ({ shape = 'text', width, height, style, className, ...props }) => (
  <span
    {...props}
    aria-hidden="true"
    className={cx('ds-skeleton', `ds-skeleton--${shape}`, className)}
    style={{ ...(width != null ? { width } : {}), ...(height != null ? { height } : {}), ...style }}
  />
);

export const SkeletonList: React.FC<{ count?: number; className?: string }> = ({ count = 3, className }) => (
  <div className={className} aria-label="در حال بارگذاری" aria-busy="true">
    {Array.from({ length: Math.max(0, Math.min(12, count)) }, (_, index) => (
      <div key={index} className="flex items-center gap-3 py-3">
        <Skeleton shape="circle" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton shape="heading" />
          <Skeleton shape="text" width="78%" />
        </div>
      </div>
    ))}
  </div>
);

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  className?: string;
}
export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, eyebrow, actions, onBack, className }) => (
  <header className={cx('ds-page-header', className)}>
    {onBack && <Button variant="ghost" size="icon" aria-label="بازگشت" onClick={onBack} startIcon={<ArrowRight size={19} />} />}
    <div className="ds-page-header__content">
      {eyebrow != null && <span className="ds-page-header__eyebrow">{eyebrow}</span>}
      <h1 className="ds-page-header__title">{title}</h1>
      {description != null && <p className="ds-page-header__description">{description}</p>}
    </div>
    {actions != null && <div className="ds-page-header__actions">{actions}</div>}
  </header>
);
