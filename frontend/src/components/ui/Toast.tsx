import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

type Variant = 'default' | 'success' | 'error';
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: Variant;
}

const ToastContext = createContext<
  ((toast: Omit<ToastItem, 'id' | 'variant'> & { variant?: Variant }) => void) | null
>(null);

/** Radix Toast (no injected <style>, so it works under the production CSP). Errors are
 * announced assertively, everything else politely. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const toast = useCallback<NonNullable<React.ContextType<typeof ToastContext>>>((input) => {
    setItems((current) => [
      ...current,
      { id: Date.now() + Math.random(), variant: 'default', ...input },
    ]);
  }, []);
  const value = useMemo(() => toast, [toast]);
  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider duration={5000} label="Notifications">
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            type={item.variant === 'error' ? 'foreground' : 'background'}
            onOpenChange={(open) => {
              if (!open) setItems((current) => current.filter((entry) => entry.id !== item.id));
            }}
            className={cn(
              'flex items-start gap-3 rounded-lg border bg-surface p-3 shadow-lg',
              item.variant === 'error'
                ? 'border-danger'
                : item.variant === 'success'
                  ? 'border-success'
                  : 'border-line',
            )}
          >
            <div className="flex-1">
              <ToastPrimitive.Title className="text-sm font-semibold">
                {item.title}
              </ToastPrimitive.Title>
              {item.description ? (
                <ToastPrimitive.Description className="text-sm text-fg-muted">
                  {item.description}
                </ToastPrimitive.Description>
              ) : null}
            </div>
            <ToastPrimitive.Close
              aria-label="Dismiss"
              className="rounded p-0.5 text-fg-muted hover:bg-surface-hover"
            >
              <X className="size-4" aria-hidden="true" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast must be used inside ToastProvider');
  return toast;
}
