import { Settings2 } from 'lucide-react';

import { Button } from '../../components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/Overlay';

import {
  ISSUE_LIST_COLUMNS,
  type IssueListColumnId,
  type IssueListColumnVisibility,
} from './issueListColumns';

export function IssueListColumnPicker({
  visible,
  onSetColumn,
  onReset,
}: {
  visible: IssueListColumnVisibility;
  onSetColumn: (id: IssueListColumnId, on: boolean) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" size="sm" aria-label="Choose visible columns">
          <Settings2 className="size-4" aria-hidden="true" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        <DropdownMenuLabel>Table columns</DropdownMenuLabel>
        <DropdownMenuItem disabled className="text-fg-muted">
          Issue (always shown)
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="text-fg-muted">
          Type (always shown)
        </DropdownMenuItem>
        <DropdownMenuItem disabled className="text-fg-muted">
          Priority (always shown)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {ISSUE_LIST_COLUMNS.map((col) => (
          <DropdownMenuCheckboxItem
            key={col.id}
            checked={visible[col.id]}
            onSelect={(event) => {
              event.preventDefault();
              onSetColumn(col.id, !visible[col.id]);
            }}
          >
            {col.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            onReset();
          }}
        >
          Show all columns
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
