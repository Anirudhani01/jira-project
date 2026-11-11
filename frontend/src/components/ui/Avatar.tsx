import * as AvatarPrimitive from '@radix-ui/react-avatar';
import type { CSSProperties } from 'react';

import { cn } from '../../lib/cn';

// A stable hue per name. The tile colours themselves come from the theme (see `.avatar` in
// index.css), so the same name looks right in light, dark and paper.
const HUES = [215, 150, 28, 268, 190, 335, 46] as const;

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return value;
}

export function initials(name: string): string {
  // Leading punctuation never counts: "Mobile (Scrum)" is "MS", not "M(".
  const parts = name
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const SIZES = {
  xs: 'size-5 text-[10px]',
  sm: 'size-6 text-xs',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
};

export function Avatar({
  name,
  src,
  size = 'sm',
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const hue = HUES[hash(name) % HUES.length] ?? HUES[0];
  return (
    <AvatarPrimitive.Root
      title={name}
      className={cn(
        'avatar inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-medium',
        SIZES[size],
        className,
      )}
      style={{ '--avatar-hue': hue } as CSSProperties}
    >
      {src ? <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" /> : null}
      <AvatarPrimitive.Fallback aria-hidden="true">{initials(name)}</AvatarPrimitive.Fallback>
      <span className="sr-only">{name}</span>
    </AvatarPrimitive.Root>
  );
}

export function AvatarStack({
  names,
  max = 4,
  size = 'sm',
}: {
  names: string[];
  max?: number;
  size?: keyof typeof SIZES;
}) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className="inline-flex -space-x-1">
      {shown.map((name) => (
        <Avatar key={name} name={name} size={size} className="ring-2 ring-surface" />
      ))}
      {extra > 0 ? (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-surface-2 font-medium text-fg-muted ring-2 ring-surface',
            SIZES[size],
          )}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
