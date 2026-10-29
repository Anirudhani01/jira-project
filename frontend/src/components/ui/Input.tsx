import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '../../lib/cn';

const control =
  'w-full rounded-md border border-line-strong bg-surface px-2.5 text-sm text-fg placeholder:text-fg-subtle hover:border-fg-subtle disabled:opacity-60 aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(control, 'h-8', className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-20 py-1.5', className)} {...props} />;
});

/** Label + control + hint/error wired together with ids, for any single control. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[13px] font-medium text-fg">
        {label}
      </label>
      {children({
        id,
        ...(note ? { 'aria-describedby': noteId } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
      {note ? (
        <p id={noteId} className={cn('text-xs', error ? 'text-danger' : 'text-fg-muted')}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
