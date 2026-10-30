import {
  createContext,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  useContext,
} from 'react';

import { cn } from '../../lib/cn';

const DataGridColumnsContext = createContext<string | null>(null);

function useDataGridColumns(): string {
  const template = useContext(DataGridColumnsContext);
  if (template == null) {
    throw new Error('DataGrid columns must be used inside DataGridColumns');
  }
  return template;
}

const HEAD_CELL =
  'flex items-center px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted sm:px-6';
const BODY_CELL = 'flex min-w-0 items-center justify-start px-5 py-4 sm:px-6 sm:py-5';

export function dataGridEqualColumnsTemplate(columnCount: number): string {
  return `repeat(${columnCount}, minmax(0, 1fr))`;
}

/** Vertical dividers between equal-width columns (`last:border-r-0` on the final cell). */
export const dataGridDividedCellClass = 'border-r border-line last:border-r-0';

/** Scrollable bordered shell for a grid-based table. */
export function DataGrid({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'w-full overflow-x-auto rounded-lg border border-line bg-surface shadow-sm',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function DataGridTable({
  className,
  children,
  'aria-label': ariaLabel,
}: {
  'aria-label': string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="table" aria-label={ariaLabel} className={cn('w-full min-w-full text-sm', className)}>
      {children}
    </div>
  );
}

/** Shared `grid-template-columns` for header and body rows. */
export function DataGridColumns({ template, children }: { template: string; children: ReactNode }) {
  return (
    <DataGridColumnsContext.Provider value={template}>{children}</DataGridColumnsContext.Provider>
  );
}

export function DataGridEqualColumns({
  columnCount,
  children,
}: {
  columnCount: number;
  children: ReactNode;
}) {
  return (
    <DataGridColumns template={dataGridEqualColumnsTemplate(columnCount)}>
      {children}
    </DataGridColumns>
  );
}

export function DataGridDividedHeadCell({
  className,
  children,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <DataGridHeadCell className={cn(dataGridDividedCellClass, className)}>
      {children}
    </DataGridHeadCell>
  );
}

export function DataGridDividedCell({
  className,
  children,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <DataGridCell className={cn(dataGridDividedCellClass, className)}>{children}</DataGridCell>
  );
}

export function DataGridHead({ children }: { children: ReactNode }) {
  const columns = useDataGridColumns();
  const style: CSSProperties = { gridTemplateColumns: columns };
  return (
    <div role="rowgroup">
      <div role="row" className="grid border-b border-line bg-surface-2" style={style}>
        {children}
      </div>
    </div>
  );
}

export function DataGridHeadCell({
  className,
  children,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="columnheader" className={cn(HEAD_CELL, className)}>
      {children}
    </div>
  );
}

export function DataGridBody({ children }: { children: ReactNode }) {
  return <div role="rowgroup">{children}</div>;
}

export function DataGridRow({ className, children }: { children: ReactNode; className?: string }) {
  const columns = useDataGridColumns();
  const style: CSSProperties = { gridTemplateColumns: columns };
  return (
    <div
      role="row"
      className={cn(
        'grid border-t border-line transition-colors hover:bg-surface-hover',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

export function DataGridCell({ className, children }: { children: ReactNode; className?: string }) {
  return (
    <div role="cell" className={cn(BODY_CELL, className)}>
      {children}
    </div>
  );
}
