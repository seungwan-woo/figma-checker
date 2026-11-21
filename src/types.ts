export type CheckError = {
  readonly code: string;
  readonly message: string;
  readonly httpStatus?: number;
  readonly retryAfterSeconds?: number;
};

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
