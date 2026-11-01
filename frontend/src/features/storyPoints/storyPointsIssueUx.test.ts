import { ApiError } from '../../lib/api/errors';

import {
  canSubmitStoryPointsChange,
  clientStoryPointsInputError,
  parseStoryPointsInput,
  storyPointsMutationFieldMessage,
} from './storyPointsIssueUx';

const ready = { effectiveEnabled: true, effectiveMax: 8 };

describe('parseStoryPointsInput', () => {
  it('accepts empty and 0-100', () => {
    expect(parseStoryPointsInput('').kind).toBe('empty');
    expect(parseStoryPointsInput('8').kind).toBe('value');
    expect(parseStoryPointsInput('101').kind).toBe('invalid');
  });
});

describe('clientStoryPointsInputError', () => {
  it('uses effective max', () => {
    expect(clientStoryPointsInputError('9', 8)).toMatch(/0 to 8/);
    expect(clientStoryPointsInputError('', 8)).toBeNull();
  });
});

describe('canSubmitStoryPointsChange', () => {
  it('allows clear when disabled', () => {
    const parsed = parseStoryPointsInput('');
    expect(
      canSubmitStoryPointsChange({
        current: 5,
        parsed,
        policy: { effectiveEnabled: false, effectiveMax: 100 },
      }).allowed,
    ).toBe(true);
  });

  it('blocks new points when disabled', () => {
    expect(
      canSubmitStoryPointsChange({
        current: 5,
        parsed: parseStoryPointsInput('3'),
        policy: { effectiveEnabled: false, effectiveMax: 100 },
      }).allowed,
    ).toBe(false);
  });

  it('allows no-op unchanged', () => {
    const result = canSubmitStoryPointsChange({
      current: 50,
      parsed: parseStoryPointsInput('50'),
      policy: ready,
    });
    expect(result).toEqual({ allowed: true, next: 50 });
  });

  it('blocks non-null changes under settings conflict', () => {
    expect(
      canSubmitStoryPointsChange({
        current: 5,
        parsed: parseStoryPointsInput('8'),
        policy: null,
        settingsConflict: true,
      }).allowed,
    ).toBe(false);
  });
});

describe('storyPointsMutationFieldMessage', () => {
  it('maps policy codes', () => {
    const disabled = new ApiError({
      status: 422,
      code: 'story_points_disabled',
      title: 'Validation',
      fieldErrors: [{ field: 'body.story_points', message: 'Not enabled.' }],
    });
    expect(storyPointsMutationFieldMessage(disabled)).toBe('Not enabled.');
  });
});
