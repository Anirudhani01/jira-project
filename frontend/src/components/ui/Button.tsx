import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '../../lib/cn';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
        secondary: 'border border-line-strong bg-surface text-fg hover:bg-surface-hover',
        subtle: 'bg-surface-2 text-fg hover:bg-line',
        ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        danger: 'bg-danger text-accent-fg hover:opacity-90',
        link: 'text-accent underline-offset-2 hover:underline',
      },
      size: { sm: 'h-7 px-2.5 text-[13px]', md: 'h-8 px-3 text-sm', lg: 'h-10 px-4 text-sm' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a router `Link`) with button styling. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type = 'button', ...props },
  ref,
) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      ref={ref}
      {...(asChild ? {} : { type })}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});

/** Square icon-only button; `label` is the accessible name (and tooltip source). */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'children'> & { label: string; children: React.ReactNode }
>(function IconButton({ label, className, size = 'md', children, ...props }, ref) {
  return (
    <Button
      ref={ref}
      aria-label={label}
      variant="ghost"
      size={size}
      className={cn(size === 'sm' ? 'w-7 px-0' : 'w-8 px-0', className)}
      {...props}
    >
      {children}
    </Button>
  );
});
