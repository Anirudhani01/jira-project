import * as AvatarPrimitive from '@radix-ui/react-avatar';

import { cn } from '../../lib/cn';

// Deterministic, accessible colours (text contrast >= 4.5:1 on each background).
const PALETTE = [
  ['#dbe7ff', '#1d3d8f'],
  ['#e0f5e8', '#14602f'],
  ['#fde7d6', '#8a3a0c'],
  ['#efe5ff', '#53279f'],
  ['#d9f1f7', '#0b5c73'],
  ['#fde3ee', '#8f1d4f'],
  ['#fff1c9', '#7a4d00'],
] as const;

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return value;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

const SIZES = {
  xs: 'size-5 text-[10px]',
  sm: 'size-6 text-[11px]',
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
  const [background, color] = PALETTE[hash(name) % PALETTE.length] as readonly [string, string];
  return (
    <AvatarPrimitive.Root
      title={name}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold',
        SIZES[size],
        className,
      )}
      style={{ background, color }}
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
            'inline-flex items-center justify-center rounded-full bg-surface-2 font-semibold text-fg-muted ring-2 ring-surface',
            SIZES[size],
          )}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  );
}
