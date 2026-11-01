import { Link, useLocation } from 'react-router';

import {
  DataGrid,
  DataGridBody,
  DataGridDividedCell,
  DataGridDividedHeadCell,
  DataGridEqualColumns,
  DataGridHead,
  DataGridRow,
  DataGridTable,
} from '../../components/ui/DataGrid';
import { useOrgFormatters } from '../orgs/useOrgFormatters';
import type { Issue, IssueType, Priority, ProjectMember } from '../../lib/api/types';

import { issueDetailLinkProps } from './issueDetailNavigation';
import { issueListTableColumnCount, type IssueListColumnVisibility } from './issueListColumns';
import { IssueListRowActions } from './IssueListRowActions';
import {
  IssueListAssigneeMenu,
  IssueListPriorityMenu,
  IssueListStatusMenu,
  IssueListTypeMenu,
} from './IssueListRowMenus';
import {
  nextIssueListSort,
  sortIndicator,
  type IssueListSort,
  type IssueListSortField,
} from './issueListSort';

function SortableHead({
  label,
  field,
  sort,
  onSort,
}: {
  label: string;
  field: IssueListSortField;
  sort: IssueListSort;
  onSort: (next: IssueListSort) => void;
}) {
  const indicator = sortIndicator(sort, field);
  const direction = indicator === '↓' ? 'descending' : indicator === '↑' ? 'ascending' : undefined;

  return (
    <button
      type="button"
      className="inline-flex w-full items-center gap-1 text-left hover:text-fg"
      aria-label={direction ? `Sort by ${label}, ${direction}` : `Sort by ${label}`}
      onClick={() => {
        onSort(nextIssueListSort(sort, field));
      }}
    >
      <span aria-hidden="true">{label}</span>
      {indicator ? (
        <span className="font-normal text-accent" aria-hidden="true">
          {indicator}
        </span>
      ) : null}
    </button>
  );
}

export function IssueListTable({
  org,
  items,
  columns,
  types,
  priorities,
  members,
  sort,
  onSort,
  canEdit,
  canAssign,
  canTransition,
}: {
  org: string;
  items: Issue[];
  columns: IssueListColumnVisibility;
  types: IssueType[];
  priorities: Priority[];
  members: ProjectMember[];
  sort: IssueListSort;
  onSort: (next: IssueListSort) => void;
  canEdit: boolean;
  canAssign: boolean;
  canTransition: boolean;
}) {
  const columnCount = issueListTableColumnCount(columns) + 1;

  return (
    <DataGrid>
      <DataGridTable aria-label="Issues">
        <DataGridEqualColumns columnCount={columnCount}>
          <DataGridHead sticky>
            <DataGridDividedHeadCell>
              <SortableHead label="Issue" field="key" sort={sort} onSort={onSort} />
            </DataGridDividedHeadCell>
            <DataGridDividedHeadCell>Type</DataGridDividedHeadCell>
            <DataGridDividedHeadCell>
              <SortableHead label="Priority" field="priority" sort={sort} onSort={onSort} />
            </DataGridDividedHeadCell>
            {columns.status ? (
              <DataGridDividedHeadCell>
                <SortableHead label="Status" field="status" sort={sort} onSort={onSort} />
              </DataGridDividedHeadCell>
            ) : null}
            {columns.assignee ? <DataGridDividedHeadCell>Assignee</DataGridDividedHeadCell> : null}
            {columns.labels ? <DataGridDividedHeadCell>Labels</DataGridDividedHeadCell> : null}
            {columns.updated ? <DataGridDividedHeadCell>Updated</DataGridDividedHeadCell> : null}
            <DataGridDividedHeadCell>
              <span className="sr-only">Actions</span>
            </DataGridDividedHeadCell>
          </DataGridHead>
          <DataGridBody>
            {items.map((issue) => (
              <IssueListTableRow
                key={issue.id}
                org={org}
                issue={issue}
                columns={columns}
                types={types}
                priorities={priorities}
                members={members}
                canEdit={canEdit}
                canAssign={canAssign}
                canTransition={canTransition}
              />
            ))}
          </DataGridBody>
        </DataGridEqualColumns>
      </DataGridTable>
    </DataGrid>
  );
}

function IssueListTableRow({
  org,
  issue,
  columns,
  types,
  priorities,
  members,
  canEdit,
  canAssign,
  canTransition,
}: {
  org: string;
  issue: Issue;
  columns: IssueListColumnVisibility;
  types: IssueType[];
  priorities: Priority[];
  members: ProjectMember[];
  canEdit: boolean;
  canAssign: boolean;
  canTransition: boolean;
}) {
  const orgFormat = useOrgFormatters();
  const location = useLocation();
  const detailLink = issueDetailLinkProps(org, issue.key, location);

  return (
    <DataGridRow issueKey={issue.key}>
      <DataGridDividedCell>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            className="w-[5.5rem] shrink-0 font-mono text-xs font-medium text-accent hover:underline sm:w-24"
            {...detailLink}
          >
            {issue.key}
          </Link>
          <Link
            className="min-w-0 flex-1 truncate font-medium leading-snug text-fg hover:text-accent"
            {...detailLink}
          >
            {issue.summary}
          </Link>
        </div>
      </DataGridDividedCell>
      <DataGridDividedCell>
        <IssueListTypeMenu org={org} issue={issue} types={types} canEdit={canEdit} />
      </DataGridDividedCell>
      <DataGridDividedCell>
        <IssueListPriorityMenu org={org} issue={issue} priorities={priorities} canEdit={canEdit} />
      </DataGridDividedCell>
      {columns.status ? (
        <DataGridDividedCell>
          <IssueListStatusMenu org={org} issue={issue} canTransition={canTransition} />
        </DataGridDividedCell>
      ) : null}
      {columns.assignee ? (
        <DataGridDividedCell>
          <IssueListAssigneeMenu org={org} issue={issue} members={members} canAssign={canAssign} />
        </DataGridDividedCell>
      ) : null}
      {columns.labels ? (
        <DataGridDividedCell>
          <div className="flex max-w-full flex-wrap gap-1">
            {issue.labels.length === 0 ? (
              <span className="text-xs text-fg-muted">—</span>
            ) : (
              issue.labels.map((l) => (
                <span
                  key={l.id}
                  className="max-w-[5rem] truncate rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: `${l.color}33`, borderLeft: `2px solid ${l.color}` }}
                  title={l.name}
                >
                  {l.name}
                </span>
              ))
            )}
          </div>
        </DataGridDividedCell>
      ) : null}
      {columns.updated ? (
        <DataGridDividedCell>
          <time className="text-xs text-fg-muted" dateTime={issue.updated_at}>
            {orgFormat.formatRelativeTime(issue.updated_at)}
          </time>
        </DataGridDividedCell>
      ) : null}
      <DataGridDividedCell>
        <IssueListRowActions org={org} issueKey={issue.key} />
      </DataGridDividedCell>
    </DataGridRow>
  );
}
