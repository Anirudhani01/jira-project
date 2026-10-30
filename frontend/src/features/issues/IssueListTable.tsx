import { Link } from 'react-router';

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
import type { Issue, IssueType, Priority, ProjectMember } from '../../lib/api/types';

import { issueListTableColumnCount, type IssueListColumnVisibility } from './issueListColumns';
import {
  IssueListAssigneeMenu,
  IssueListPriorityMenu,
  IssueListStatusMenu,
  IssueListTypeMenu,
} from './IssueListRowMenus';

export function IssueListTable({
  org,
  items,
  columns,
  types,
  priorities,
  members,
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
  canEdit: boolean;
  canAssign: boolean;
  canTransition: boolean;
}) {
  const columnCount = issueListTableColumnCount(columns);

  return (
    <DataGrid>
      <DataGridTable aria-label="Issues">
        <DataGridEqualColumns columnCount={columnCount}>
          <DataGridHead>
            <DataGridDividedHeadCell>Issue</DataGridDividedHeadCell>
            <DataGridDividedHeadCell>Type</DataGridDividedHeadCell>
            <DataGridDividedHeadCell>Priority</DataGridDividedHeadCell>
            {columns.status ? <DataGridDividedHeadCell>Status</DataGridDividedHeadCell> : null}
            {columns.assignee ? <DataGridDividedHeadCell>Assignee</DataGridDividedHeadCell> : null}
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
  return (
    <DataGridRow>
      <DataGridDividedCell>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            className="w-[5.5rem] shrink-0 font-mono text-xs font-medium text-accent hover:underline sm:w-24"
            to={`/o/${org}/issues/${issue.key}`}
          >
            {issue.key}
          </Link>
          <span className="min-w-0 flex-1 truncate font-medium leading-snug text-fg">
            {issue.summary}
          </span>
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
    </DataGridRow>
  );
}
