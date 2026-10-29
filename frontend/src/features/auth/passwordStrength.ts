/** Client-side hint only; the server remains authoritative on password policy. */
export type PasswordStrength = 'empty' | 'weak' | 'fair' | 'strong';

export function passwordStrength(value: string): PasswordStrength {
  if (!value) return 'empty';
  let score = 0;
  if (value.length >= 12) score += 1;
  if (value.length >= 16) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^a-zA-Z0-9]/.test(value)) score += 1;
  if (score <= 2) return 'weak';
  if (score <= 3) return 'fair';
  return 'strong';
}

export const PASSWORD_STRENGTH_LABEL: Record<Exclude<PasswordStrength, 'empty'>, string> = {
  weak: 'Weak — use at least 12 characters with mixed types.',
  fair: 'Fair — add length or symbols for a stronger password.',
  strong: 'Strong password.',
};
