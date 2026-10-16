export function redactSecrets(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return secrets.filter(Boolean).reduce((result, secret) => result.split(secret).join('[REDACTED]'), value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecrets(item, secrets)]));
  return value;
}
