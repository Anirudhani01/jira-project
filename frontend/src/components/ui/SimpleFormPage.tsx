import type { ReactNode } from 'react';

import { Card } from './Card';

/** Centered form card for signed-in create/settings flows. */
export function SimpleFormPage({
  title,
  titleId,
  children,
  width = 'sm',
}: {
  title: string;
  titleId: string;
  children: ReactNode;
  width?: 'sm' | 'md';
}) {
  return (
    <section
      aria-labelledby={titleId}
      className={width === 'md' ? 'mx-auto max-w-lg' : 'mx-auto max-w-md'}
    >
      <Card className="space-y-6 p-6">
        <h1 id={titleId} className="text-xl font-semibold text-fg">
          {title}
        </h1>
        {children}
      </Card>
    </section>
  );
}
