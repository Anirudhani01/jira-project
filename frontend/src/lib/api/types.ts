/** Request/response types generated from backend/openapi.json (`pnpm gen:api`). */
import type { components } from './schema';

type Schemas = components['schemas'];

export type SignupRequest = Schemas['SignupRequest'];
export type LoginRequest = Schemas['LoginRequest'];
export type ChangePasswordRequest = Schemas['ChangePasswordRequest'];
export type UpdateProfileRequest = Schemas['UpdateProfileRequest'];
export type User = Schemas['UserResponse'];
export type SessionState = Schemas['SessionStateResponse'];
export type SessionList = Schemas['SessionListResponse'];
export type SessionListItem = Schemas['SessionListItem'];
export type VerifyEmailRequest = Schemas['VerifyEmailRequest'];
export type PasswordResetRequest = Schemas['PasswordResetRequest'];
export type PasswordResetConfirmRequest = Schemas['PasswordResetConfirmRequest'];
export type OrgSummary = Schemas['OrgSummary'];
export type Org = Schemas['OrgResponse'];
export type CreateOrgRequest = Schemas['CreateOrgRequest'];
