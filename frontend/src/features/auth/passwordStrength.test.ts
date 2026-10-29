import { passwordStrength } from './passwordStrength';

describe('passwordStrength', () => {
  it('classifies empty input', () => {
    expect(passwordStrength('')).toBe('empty');
  });

  it('flags short passwords as weak', () => {
    expect(passwordStrength('short')).toBe('weak');
  });

  it('rewards length and mixed character types', () => {
    expect(passwordStrength('Velvet-Harbor-Lantern-93')).toBe('strong');
  });
});
