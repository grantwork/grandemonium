import {
  createCliPathFingerprintInputs,
  hasCliPathFingerprintInputs,
} from '@/core/providers/cli/CliPathFingerprintInputs';

describe('CLI path fingerprint inputs', () => {
  it('normalizes the current device CLI path', () => {
    const inputs = createCliPathFingerprintInputs(' /configured/hostname-cli ');

    expect(inputs).toEqual({ hostnameCliPath: '/configured/hostname-cli' });
    expect(hasCliPathFingerprintInputs(inputs)).toBe(true);
  });

  it('represents a missing path explicitly without treating it as configured', () => {
    const inputs = createCliPathFingerprintInputs('  ');

    expect(inputs).toEqual({ hostnameCliPath: '' });
    expect(hasCliPathFingerprintInputs(inputs)).toBe(false);
  });
});
