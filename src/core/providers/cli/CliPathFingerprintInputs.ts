export type CliPathFingerprintInputs = Readonly<Record<'hostnameCliPath', string>>;

export function createCliPathFingerprintInputs(
  hostnameCliPath: string | undefined,
): CliPathFingerprintInputs {
  return {
    hostnameCliPath: (hostnameCliPath ?? '').trim(),
  };
}

export function hasCliPathFingerprintInputs(inputs: CliPathFingerprintInputs): boolean {
  return Boolean(inputs.hostnameCliPath);
}
