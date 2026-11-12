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

const HEAD_CELL = 'flex items-center px-4 py-2 text-left text-xs font-medium text-fg-muted';
const BODY_CELL = 'flex min-h-12 min-w-0 items-center justify-start px-4 py-2';

export function dataGridEqualColumnsTemplate(columnCount: number): string {
  return `repeat(${columnCount}, minmax(0, 1fr))`;
}

/** Rows are separated by hairlines only; vertical dividers between cells read as a spreadsheet. */
export const dataGridDividedCellClass = '';

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

export function DataGridHead({
  children,
  sticky = false,
}: {
  children: ReactNode;
  sticky?: boolean;
}) {
  const columns = useDataGridColumns();
  const style: CSSProperties = { gridTemplateColumns: columns };
  return (
    <div role="rowgroup" className={sticky ? 'sticky top-0 z-10' : undefined}>
      <div role="row" className="grid border-b border-line bg-surface-2 shadow-sm" style={style}>
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

export function DataGridRow({
  className,
  children,
  issueKey,
}: {
  children: ReactNode;
  className?: string;
  /** Marks the row as an issue row for the J / K / O shortcuts. */
  issueKey?: string;
}) {
  const columns = useDataGridColumns();
  const style: CSSProperties = { gridTemplateColumns: columns };
  return (
    <div
      role="row"
      {...(issueKey ? { 'data-issue-row': true, 'data-issue-key': issueKey } : {})}
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
