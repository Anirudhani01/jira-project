import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { IconButton } from './Button';

// ------------------------------------------------------------------------------ dialog
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'title'> & {
  title: string;
  description?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <DialogPrimitive.Content
        {...props}
        {...(description ? {} : { 'aria-describedby': undefined })}
        className={cn(
          'fixed left-1/2 top-[10vh] z-50 max-h-[80vh] w-[min(92vw,34rem)] -translate-x-1/2 overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-lg',
          className,
        )}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close asChild>
            <IconButton label="Close" size="sm">
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// -------------------------------------------------------------------------------- menu
export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

const menuSurface =
  'z-50 min-w-44 overflow-hidden rounded-md border border-line bg-surface p-1 text-sm shadow-md';

export function DropdownMenuContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={4}
        align="end"
        className={cn(menuSurface, className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-hover',
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuLabel = ({ children }: { children: ReactNode }) => (
  <DropdownPrimitive.Label className="px-2 py-1 text-xs font-semibold text-fg-muted">
    {children}
  </DropdownPrimitive.Label>
);
export const DropdownMenuSeparator = () => (
  <DropdownPrimitive.Separator className="my-1 h-px bg-line" />
);

// ----------------------------------------------------------------------------- popover
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={6}
        align="end"
        className={cn(menuSurface, 'p-3', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

// ----------------------------------------------------------------------------- tooltip
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root delayDuration={400}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={4}
          className="z-50 rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-md"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// -------------------------------------------------------------------------------- tabs
export const Tabs = TabsPrimitive.Root;
export function TabsList({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List className={cn('flex gap-1 border-b border-line', className)} {...props} />
  );
}
export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px border-b-2 border-transparent px-3 py-1.5 text-sm font-medium text-fg-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg',
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;
