import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Card, EmptyState, Skeleton } from '../../../components/ui/Card';
import {
  DataGrid,
  DataGridBody,
  DataGridDividedCell,
  DataGridDividedHeadCell,
  DataGridColumns,
  DataGridHead,
  DataGridRow,
  DataGridTable,
} from '../../../components/ui/DataGrid';
import { FormError, SubmitButton } from '../../../components/ui/Form';
import { Input } from '../../../components/ui/Input';
import { ErrorState } from '../../../components/ui/States';
import type { IssueType, Priority } from '../../../lib/api/types';
import { describeError } from '../../../lib/forms';
import { useIssueTypes, usePriorities } from '../../issues/api';
import { useOrg } from '../../orgs/api';
import {
  useCreateIssueType,
  useCreatePriority,
  useReorderIssueTypes,
  useReorderPriorities,
  useUpdateIssueType,
  useUpdatePriority,
} from '../catalogApi';
import { AdminOrgManagePageFrame } from './AdminOrgManagePageFrame';

function formatKind(kind: string): string {
  if (kind === 'subtask') return 'Sub-task';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>;
}

function CatalogSectionSkeleton({ label }: { label: string }) {
  return (
    <Card className="admin-card space-y-4 p-5 sm:p-6">
      <Skeleton className="h-6 w-40" aria-hidden />
      <span className="sr-only">{label}</span>
      <Skeleton className="h-24 w-full" aria-hidden />
    </Card>
  );
}

function moveItem(items: { id: string }[], id: string, direction: -1 | 1): string[] {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return items.map((item) => item.id);
  const target = index + direction;
  if (target < 0 || target >= items.length) return items.map((item) => item.id);
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((item) => item.id);
}

function IssueTypeRow({
  org,
  row,
  items,
  canManage,
}: {
  org: string;
  row: IssueType;
  items: IssueType[];
  canManage: boolean;
}) {
  const update = useUpdateIssueType(org);
  const reorder = useReorderIssueTypes(org);
  const [name, setName] = useState(row.name);
  const [editing, setEditing] = useState(false);
  const index = items.findIndex((item) => item.id === row.id);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === row.name) {
      setName(row.name);
      setEditing(false);
      return;
    }
    await update.mutateAsync({ id: row.id, name: trimmed });
    setEditing(false);
  };

  return (
    <DataGridRow>
      <DataGridDividedCell>
        {canManage && editing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <input
              className="min-w-[8rem] rounded-md border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1 text-sm"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              aria-label={`Rename ${row.name}`}
            />
            <Button type="submit" size="sm" disabled={update.isPending}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setName(row.name);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <span
            className={`font-medium ${row.is_active ? 'text-[var(--admin-text)]' : 'text-[var(--admin-muted)] line-through decoration-[var(--admin-border)]'}`}
          >
            {row.name}
          </span>
        )}
      </DataGridDividedCell>
      <DataGridDividedCell>{formatKind(row.kind)}</DataGridDividedCell>
      <DataGridDividedCell>
        <StatusBadge active={row.is_active} />
      </DataGridDividedCell>
      {canManage ? (
        <DataGridDividedCell>
          <div className="flex flex-nowrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={index <= 0 || reorder.isPending}
              onClick={() => void reorder.mutateAsync(moveItem(items, row.id, -1))}
            >
              Up
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={index >= items.length - 1 || reorder.isPending}
              onClick={() => void reorder.mutateAsync(moveItem(items, row.id, 1))}
            >
              Down
            </Button>
            {!editing ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(true);
                }}
              >
                Rename
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={update.isPending}
              onClick={() => void update.mutateAsync({ id: row.id, is_active: !row.is_active })}
            >
              {row.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        </DataGridDividedCell>
      ) : null}
    </DataGridRow>
  );
}

function AddIssueTypeForm({ org }: { org: string }) {
  const create = useCreateIssueType(org);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('standard');
  const failure = create.error ? describeError(create.error) : null;

  return (
    <form
      className="space-y-2 overflow-x-auto"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        void create.mutateAsync({ name: trimmed, kind }).then(() => {
          setName('');
        });
      }}
    >
      <FormError>{failure}</FormError>
      <div
        className="grid min-w-[47rem] items-center"
        style={{ gridTemplateColumns: catalogTemplate(true) }}
      >
        <div className="px-4 py-2">
          <Input
            aria-label="New issue type"
            placeholder="New issue type"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        <div className="px-4 py-2">
          <select
            aria-label="Kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
            }}
          >
            <option value="epic">Epic</option>
            <option value="standard">Standard</option>
            <option value="subtask">Sub-task</option>
          </select>
        </div>
        <div />
        <div className="flex justify-start px-4 py-2">
          <SubmitButton pending={create.isPending}>Add</SubmitButton>
        </div>
      </div>
    </form>
  );
}

/** Name is a fixed, readable width and the actions follow Status directly (left-aligned under
 * their heading). The add rows below the tables use the same template, so their fields line up
 * with the columns above them. */
function catalogTemplate(canManage: boolean): string {
  return `minmax(12rem, 16rem) 9rem 7rem${canManage ? ' minmax(19rem, 1fr)' : ''}`;
}

function IssueTypesSection({
  query,
  org,
  canManage,
}: {
  query: UseQueryResult<IssueType[]>;
  org: string;
  canManage: boolean;
}) {
  const titleId = 'admin-catalog-issue-types';
  if (query.isPending) {
    return <CatalogSectionSkeleton label="Loading issue types" />;
  }
  if (query.isError) {
    return (
      <section className="admin-card rounded-xl border p-5 sm:p-6" aria-labelledby={titleId}>
        <h2 id={titleId} className="text-lg font-medium text-[var(--admin-text)]">
          Issue types
        </h2>
        <div className="mt-4">
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      </section>
    );
  }

  const items = query.data;
  return (
    <section
      className="admin-card space-y-4 rounded-xl border p-5 sm:p-6"
      aria-labelledby={titleId}
    >
      <div>
        <h2 id={titleId} className="text-lg font-medium text-[var(--admin-text)]">
          Issue types
        </h2>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Categories used when creating and classifying issues. Inactive types stay on existing
          issues but cannot be chosen for new ones.
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyState
          title="No issue types"
          description="This organization has no issue types configured yet."
        />
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <DataGrid>
            <DataGridTable aria-label="Issue types">
              <DataGridColumns template={catalogTemplate(canManage)}>
                <DataGridHead>
                  <DataGridDividedHeadCell>Name</DataGridDividedHeadCell>
                  <DataGridDividedHeadCell>Kind</DataGridDividedHeadCell>
                  <DataGridDividedHeadCell>Status</DataGridDividedHeadCell>
                  {canManage ? <DataGridDividedHeadCell>Actions</DataGridDividedHeadCell> : null}
                </DataGridHead>
                <DataGridBody>
                  {items.map((row) => (
                    <IssueTypeRow
                      key={row.id}
                      org={org}
                      row={row}
                      items={items}
                      canManage={canManage}
                    />
                  ))}
                </DataGridBody>
              </DataGridColumns>
            </DataGridTable>
          </DataGrid>
        </div>
      )}
      {canManage ? <AddIssueTypeForm org={org} /> : null}
    </section>
  );
}

function PriorityRow({
  org,
  row,
  items,
  canManage,
}: {
  org: string;
  row: Priority;
  items: Priority[];
  canManage: boolean;
}) {
  const update = useUpdatePriority(org);
  const reorder = useReorderPriorities(org);
  const [name, setName] = useState(row.name);
  const [editing, setEditing] = useState(false);
  const index = items.findIndex((item) => item.id === row.id);

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === row.name) {
      setName(row.name);
      setEditing(false);
      return;
    }
    await update.mutateAsync({ id: row.id, name: trimmed });
    setEditing(false);
  };

  return (
    <DataGridRow>
      <DataGridDividedCell>
        {canManage && editing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <input
              className="min-w-[8rem] rounded-md border border-[var(--admin-border)] bg-[var(--admin-bg)] px-2 py-1 text-sm"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              aria-label={`Rename ${row.name}`}
            />
            <Button type="submit" size="sm" disabled={update.isPending}>
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setName(row.name);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <span
            className={`font-medium ${row.is_active ? 'text-[var(--admin-text)]' : 'text-[var(--admin-muted)] line-through decoration-[var(--admin-border)]'}`}
          >
            {row.name}
          </span>
        )}
      </DataGridDividedCell>
      <DataGridDividedCell>
        <span className="inline-flex items-center gap-2">
          <span
            className="size-4 shrink-0 rounded-sm border border-[var(--admin-border)]"
            style={{ backgroundColor: row.color }}
            aria-hidden
          />
          <span className="text-sm text-[var(--admin-muted)]">{row.color}</span>
        </span>
      </DataGridDividedCell>
      <DataGridDividedCell>
        <StatusBadge active={row.is_active} />
      </DataGridDividedCell>
      {canManage ? (
        <DataGridDividedCell>
          <div className="flex flex-nowrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={index <= 0 || reorder.isPending}
              onClick={() => void reorder.mutateAsync(moveItem(items, row.id, -1))}
            >
              Up
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={index >= items.length - 1 || reorder.isPending}
              onClick={() => void reorder.mutateAsync(moveItem(items, row.id, 1))}
            >
              Down
            </Button>
            {!editing ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(true);
                }}
              >
                Rename
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={update.isPending}
              onClick={() => void update.mutateAsync({ id: row.id, is_active: !row.is_active })}
            >
              {row.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        </DataGridDividedCell>
      ) : null}
    </DataGridRow>
  );
}

function AddPriorityForm({ org }: { org: string }) {
  const create = useCreatePriority(org);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#64748b');
  const failure = create.error ? describeError(create.error) : null;

  return (
    <form
      className="space-y-2 overflow-x-auto"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        void create.mutateAsync({ name: trimmed, color }).then(() => {
          setName('');
        });
      }}
    >
      <FormError>{failure}</FormError>
      <div
        className="grid min-w-[47rem] items-center"
        style={{ gridTemplateColumns: catalogTemplate(true) }}
      >
        <div className="px-4 py-2">
          <Input
            aria-label="New priority"
            placeholder="New priority"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        <div className="px-4 py-2">
          <Input
            aria-label="Color"
            placeholder="#rrggbb"
            className="font-mono"
            value={color}
            onChange={(e) => {
              setColor(e.target.value);
            }}
          />
        </div>
        <div />
        <div className="flex justify-start px-4 py-2">
          <SubmitButton pending={create.isPending}>Add</SubmitButton>
        </div>
      </div>
    </form>
  );
}

function PrioritiesSection({
  query,
  org,
  canManage,
}: {
  query: UseQueryResult<Priority[]>;
  org: string;
  canManage: boolean;
}) {
  const titleId = 'admin-catalog-priorities';
  if (query.isPending) {
    return <CatalogSectionSkeleton label="Loading priorities" />;
  }
  if (query.isError) {
    return (
      <section className="admin-card rounded-xl border p-5 sm:p-6" aria-labelledby={titleId}>
        <h2 id={titleId} className="text-lg font-medium text-[var(--admin-text)]">
          Priorities
        </h2>
        <div className="mt-4">
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </div>
      </section>
    );
  }

  const items = query.data;
  return (
    <section
      className="admin-card space-y-4 rounded-xl border p-5 sm:p-6"
      aria-labelledby={titleId}
    >
      <div>
        <h2 id={titleId} className="text-lg font-medium text-[var(--admin-text)]">
          Priorities
        </h2>
        <p className="mt-1 text-sm text-[var(--admin-muted)]">
          Relative urgency levels for issues. Inactive priorities remain on existing issues but
          cannot be selected for new ones.
        </p>
      </div>
      {items.length === 0 ? (
        <EmptyState
          title="No priorities"
          description="This organization has no priorities configured yet."
        />
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <DataGrid>
            <DataGridTable aria-label="Priorities">
              <DataGridColumns template={catalogTemplate(canManage)}>
                <DataGridHead>
                  <DataGridDividedHeadCell>Name</DataGridDividedHeadCell>
                  <DataGridDividedHeadCell>Color</DataGridDividedHeadCell>
                  <DataGridDividedHeadCell>Status</DataGridDividedHeadCell>
                  {canManage ? <DataGridDividedHeadCell>Actions</DataGridDividedHeadCell> : null}
                </DataGridHead>
                <DataGridBody>
                  {items.map((row) => (
                    <PriorityRow
                      key={row.id}
                      org={org}
                      row={row}
                      items={items}
                      canManage={canManage}
                    />
                  ))}
                </DataGridBody>
              </DataGridColumns>
            </DataGridTable>
          </DataGrid>
        </div>
      )}
      {canManage ? <AddPriorityForm org={org} /> : null}
    </section>
  );
}

function AdminCatalogsContent() {
  const { org: slug = '' } = useParams();
  const org = useOrg(slug);
  const issueTypes = useIssueTypes(slug);
  const priorities = usePriorities(slug);
  const canManage = org.data?.permissions.includes('org.manage') ?? false;

  return (
    <div className="grid gap-6 lg:grid-cols-1">
      <IssueTypesSection query={issueTypes} org={slug} canManage={canManage} />
      <PrioritiesSection query={priorities} org={slug} canManage={canManage} />
    </div>
  );
}

/** Organization issue types and priorities (Phase A). */
export function AdminCatalogsPage() {
  return (
    <AdminOrgManagePageFrame
      title="Defaults & catalogs"
      titleId="admin-catalogs-title"
      description="Organization-scoped issue types and priorities shared by every project in this organization."
      requireManage={false}
    >
      <AdminCatalogsContent />
    </AdminOrgManagePageFrame>
  );
}
