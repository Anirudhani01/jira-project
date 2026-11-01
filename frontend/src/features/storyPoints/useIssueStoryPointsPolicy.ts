import type { OrgSettings } from '../../lib/api/types';
import { useOrgSettings } from '../orgs/api';
import { useProjectSettings } from '../projects/api';
import type { IssueStoryPointsPolicyReady } from './storyPointsIssueUx';
import { isProjectSettingsConflict } from './storyPointsSettingsUx';

export type IssueStoryPointsPolicyState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; refetch: () => void }
  | { status: 'conflict'; orgSettings: OrgSettings }
  | ({ status: 'ready' } & IssueStoryPointsPolicyReady);

export function useIssueStoryPointsPolicy(
  org: string,
  projectKey: string,
  options?: { enabled?: boolean },
): IssueStoryPointsPolicyState {
  const enabled = (options?.enabled ?? true) && org.length > 0 && projectKey.length > 0;
  const projectSettings = useProjectSettings(org, projectKey, { enabled });
  const orgSettings = useOrgSettings(org);

  if (!enabled) {
    return { status: 'loading' };
  }

  if (projectSettings.isPending || orgSettings.isPending) {
    return { status: 'loading' };
  }

  if (projectSettings.isError && isProjectSettingsConflict(projectSettings.error)) {
    if (orgSettings.isError) {
      return {
        status: 'error',
        error: orgSettings.error,
        refetch: () => {
          void orgSettings.refetch();
          void projectSettings.refetch();
        },
      };
    }
    return { status: 'conflict', orgSettings: orgSettings.data };
  }

  if (projectSettings.isError) {
    return {
      status: 'error',
      error: projectSettings.error,
      refetch: () => void projectSettings.refetch(),
    };
  }

  if (orgSettings.isError) {
    return {
      status: 'error',
      error: orgSettings.error,
      refetch: () => void orgSettings.refetch(),
    };
  }

  const effective = projectSettings.data.effective;
  return {
    status: 'ready',
    effectiveEnabled: effective.story_points_enabled,
    effectiveMax: effective.story_points_max,
  } satisfies { status: 'ready' } & IssueStoryPointsPolicyReady;
}

export function isPolicyReady(
  policy: IssueStoryPointsPolicyState,
): policy is Extract<IssueStoryPointsPolicyState, { status: 'ready' }> {
  return policy.status === 'ready';
}
