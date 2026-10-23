export interface SizeUnit {
  label: string;
  bytes: number;
  system: 'decimal' | 'binary';
}

export const UNITS: readonly SizeUnit[] = [
  { label: 'B', bytes: 1, system: 'decimal' },
  { label: 'KB', bytes: 1000, system: 'decimal' },
  { label: 'MB', bytes: 1000 ** 2, system: 'decimal' },
  { label: 'GB', bytes: 1000 ** 3, system: 'decimal' },
  { label: 'TB', bytes: 1000 ** 4, system: 'decimal' },
  { label: 'KiB', bytes: 1024, system: 'binary' },
  { label: 'MiB', bytes: 1024 ** 2, system: 'binary' },
  { label: 'GiB', bytes: 1024 ** 3, system: 'binary' },
  { label: 'TiB', bytes: 1024 ** 4, system: 'binary' },
];

/** Converts an amount in the given unit to a whole number of bytes (rounded up). */
export function parseSize(value: number, unitLabel: string): number {
  const unit = UNITS.find((u) => u.label === unitLabel);
  if (!unit) throw new Error(`Unknown unit: ${unitLabel}`);
  if (!Number.isFinite(value) || value < 0) throw new Error('Size must be a non-negative number');
  const bytes = Math.ceil(value * unit.bytes);
  if (!Number.isSafeInteger(bytes)) throw new Error('Size is too large');
  return bytes;
}

function format(bytes: number, base: number, labels: readonly string[]): string {
  let value = bytes;
  let i = 0;
  while (value >= base && i < labels.length - 1) {
    value /= base;
    i++;
  }
  // Whole bytes (a speed can be fractional), otherwise at most two decimals.
  return `${i === 0 ? Math.round(value) : value.toFixed(2)} ${labels[i]}`;
}

/** Human-readable representation in both decimal (SI) and binary (IEC) units. */
export function formatBytes(bytes: number): { decimal: string; binary: string } {
  return {
    decimal: format(bytes, 1000, ['B', 'KB', 'MB', 'GB', 'TB']),
    binary: format(bytes, 1024, ['B', 'KiB', 'MiB', 'GiB', 'TiB']),
  };
}
