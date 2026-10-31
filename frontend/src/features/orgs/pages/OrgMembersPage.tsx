import { useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { useParams } from 'react-router';

import { FormError, SubmitButton, TextField } from '../../../components/ui/Form';
import { ErrorState, LoadingState } from '../../../components/ui/States';
import { NotFoundPage } from '../../../app/pages/NotFoundPage';
import { ApiError } from '../../../lib/api/errors';
import { describeError } from '../../../lib/forms';
import {
  useFocusOnSubmitAttempt,
  type FocusableFieldRef,
} from '../../../lib/ux/focusFirstInvalidControl';
import {
  useInvitations,
  useInvite,
  useMembers,
  useOrg,
  useRemoveMember,
  useRevokeInvitation,
  useUpdateMember,
} from '../api';

const ROLES = ['member', 'admin', 'owner'] as const;

/** Members and invitations. The server enforces every rule (owners-only owner changes,
 * last-owner protection); this page only reflects the caller's permissions. */
export function OrgMembersPage() {
  const { org: slug = '' } = useParams();
  const org = useOrg(slug);
  const canManage = org.data?.permissions.includes('org.members.manage') ?? false;
  const members = useMembers(slug);
  const invitations = useInvitations(slug, canManage);
  const update = useUpdateMember(slug);
  const remove = useRemoveMember(slug);
  const invite = useInvite(slug);
  const revoke = useRevokeInvitation(slug);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [inviteEmailError, setInviteEmailError] = useState<string | undefined>();
  const [focusGeneration, setFocusGeneration] = useState(0);
  const emailRef = useRef<HTMLInputElement>(null);

  const inviteFocusFields = useMemo((): FocusableFieldRef[] => {
    return [
      {
        hasError: Boolean(inviteEmailError),
        focus: () => {
          emailRef.current?.focus();
        },
      },
    ];
  }, [inviteEmailError]);

  useFocusOnSubmitAttempt(focusGeneration, inviteFocusFields);

  if (org.isPending || members.isPending) return <LoadingState label="Loading members" />;
  if (org.error instanceof ApiError && org.error.status === 404) return <NotFoundPage />;
  if (org.isError) return <ErrorState error={org.error} />;
  if (members.isError) return <ErrorState error={members.error} />;

  const isOwner = org.data.role === 'owner';
  const failure =
    [update, remove, revoke].find((m) => m.error)?.error ??
    (invite.error &&
    !(
      invite.error instanceof ApiError &&
      invite.error.status === 422 &&
      invite.error.fieldErrors.length
    )
      ? invite.error
      : null);

  const inviteFormFailure =
    invite.error &&
    !(
      invite.error instanceof ApiError &&
      invite.error.status === 422 &&
      invite.error.fieldErrors.length
    )
      ? describeError(invite.error)
      : null;

  const onInvite = (event: SyntheticEvent) => {
    event.preventDefault();
    setInviteEmailError(undefined);
    invite.reset();
    invite.mutate(
      { email, role },
      {
        onSuccess: () => {
          setEmail('');
          setInviteEmailError(undefined);
        },
        onError: (error) => {
          if (error instanceof ApiError) {
            const fieldError = error.fieldErrors.find((e) => e.field === 'body.email');
            if (fieldError) setInviteEmailError(fieldError.message);
          }
          setFocusGeneration((g) => g + 1);
        },
      },
    );
  };

  return (
    <section aria-labelledby="members-title" className="space-y-8">
      <h1 id="members-title" className="text-2xl font-semibold">
        Members of {org.data.name}
      </h1>
      <FormError>{failure ? describeError(failure) : null}</FormError>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            {canManage ? <th scope="col">Can create projects</th> : null}
            {canManage ? <th scope="col">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {members.data.map((m) => {
            const editable = canManage && (isOwner || m.role !== 'owner');
            return (
              <tr key={m.user_id}>
                <td>{m.display_name}</td>
                <td>{m.email}</td>
                <td>
                  {editable ? (
                    <select
                      aria-label={`Role of ${m.display_name}`}
                      value={m.role}
                      onChange={(e) => {
                        update.mutate({ userId: m.user_id, role: e.target.value });
                      }}
                    >
                      {ROLES.filter((r) => isOwner || r !== 'owner').map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    m.role
                  )}
                </td>
                {canManage ? (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${m.display_name} can create projects`}
                      checked={m.can_create_projects}
                      disabled={!editable}
                      onChange={(e) => {
                        update.mutate({ userId: m.user_id, can_create_projects: e.target.checked });
                      }}
                    />
                  </td>
                ) : null}
                {canManage ? (
                  <td>
                    {editable ? (
                      <button
                        type="button"
                        className="text-red-700 underline"
                        onClick={() => {
                          remove.mutate(m.user_id);
                        }}
                      >
                        Remove {m.display_name}
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      {canManage ? (
        <section aria-labelledby="invite-title" className="space-y-4">
          <h2 id="invite-title" className="text-lg font-semibold">
            Invite someone
          </h2>
          <FormError>{inviteFormFailure}</FormError>
          <form onSubmit={onInvite} noValidate className="flex max-w-xl items-end gap-3">
            <TextField
              ref={emailRef}
              label="Email to invite"
              type="email"
              value={email}
              error={inviteEmailError}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
            <label className="text-sm">
              Role
              <select
                className="ml-2"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                }}
              >
                {ROLES.filter((r) => isOwner || r !== 'owner').map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton pending={invite.isPending}>Send invitation</SubmitButton>
          </form>
          {invite.isSuccess ? <p role="status">Invitation sent.</p> : null}
          <ul className="space-y-1 text-sm">
            {(invitations.data ?? []).map((i) => (
              <li key={i.id}>
                {i.email} ({i.role}){i.expired ? ' — expired' : ''}{' '}
                <button
                  type="button"
                  className="text-red-700 underline"
                  onClick={() => {
                    revoke.mutate(i.id);
                  }}
                >
                  Revoke invitation for {i.email}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
