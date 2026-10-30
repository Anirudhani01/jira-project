import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';

import { PASSWORD_STRENGTH_LABEL, passwordStrength } from '../../features/auth/passwordStrength';
import { cn } from '../../lib/cn';

import { Button } from './Button';
import { Field, Input } from './Input';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string;
  showStrength?: boolean;
}

/** Labelled input with accessible error and hint wiring. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, id, type, showStrength, ...props },
  ref,
) {
  if (type === 'password') {
    return (
      <PasswordField
        ref={ref}
        label={label}
        error={error}
        {...(hint ? { hint } : {})}
        id={id}
        showStrength={showStrength ?? false}
        {...props}
      />
    );
  }
  return (
    <Field label={label} {...(hint ? { hint } : {})} error={error ?? null}>
      {(field) => (
        <Input
          ref={ref}
          id={field.id}
          type={type}
          aria-invalid={field['aria-invalid']}
          aria-describedby={field['aria-describedby']}
          {...props}
        />
      )}
    </Field>
  );
});

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  error?: string | undefined;
  hint?: string;
  /** Show client-side strength hint (signup / new password). */
  showStrength?: boolean;
}

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField(
    { label, error, hint, id, showStrength = false, value, onChange, className, ...props },
    ref,
  ) {
    const generated = useId();
    const inputId = id ?? generated;
    const [visible, setVisible] = useState(false);
    const [draft, setDraft] = useState('');
    const current = typeof value === 'string' ? value : draft;
    const strength = showStrength ? passwordStrength(current) : 'empty';
    const strengthNote =
      showStrength && strength !== 'empty' ? PASSWORD_STRENGTH_LABEL[strength] : null;
    const combinedHint = [hint, strengthNote].filter(Boolean).join(' ') || undefined;
    const note = error ?? combinedHint;

    return (
      <div className="space-y-1">
        <label htmlFor={inputId} className="block text-[13px] font-medium text-fg">
          {label}
        </label>
        <div className="relative">
          <Input
            ref={ref}
            id={inputId}
            type={visible ? 'text' : 'password'}
            aria-invalid={error ? true : undefined}
            aria-describedby={note ? `${inputId}-note` : undefined}
            value={value}
            onChange={(event) => {
              setDraft(event.target.value);
              onChange?.(event);
            }}
            className={cn('pr-9', className)}
            {...props}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 px-0"
            aria-label={visible ? `Hide password for ${label}` : `Show password for ${label}`}
            aria-pressed={visible}
            onClick={() => {
              setVisible((v) => !v);
            }}
          >
            {visible ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
          </Button>
        </div>
        {showStrength && strength !== 'empty' ? (
          <div className="flex gap-1 pt-0.5" aria-hidden="true" role="presentation">
            {[1, 2, 3].map((segment) => (
              <div
                key={segment}
                className={cn(
                  'h-1 flex-1 rounded-full bg-line',
                  (strength === 'weak' && segment === 1) ||
                    (strength === 'fair' && segment <= 2) ||
                    (strength === 'strong' && segment <= 3)
                    ? strength === 'weak'
                      ? 'bg-warning'
                      : strength === 'fair'
                        ? 'bg-accent'
                        : 'bg-success'
                    : '',
                )}
              />
            ))}
          </div>
        ) : null}
        {note ? (
          <p
            id={`${inputId}-note`}
            className={cn('text-xs', error ? 'text-danger' : 'text-fg-muted')}
          >
            {error ?? combinedHint}
          </p>
        ) : null}
      </div>
    );
  },
);

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
    >
      {children}
    </p>
  );
}

export function SubmitButton({
  pending,
  disabled,
  children,
  className,
}: {
  pending: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Button
      type="submit"
      variant="primary"
      className={className}
      disabled={pending || disabled}
      aria-busy={pending}
    >
      {children}
    </Button>
  );
}
