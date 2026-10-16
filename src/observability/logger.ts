import { createRequire } from 'node:module';
import type { Logger } from 'pino';
import { redactSecrets } from './redaction.js';

const require = createRequire(import.meta.url);
const pino = require('pino') as ((options: Record<string, unknown>) => Logger) & { stdSerializers: { err: unknown } };

export function createLogger(secrets: readonly string[] = []): Logger {
  return pino({
    serializers: { err: pino.stdSerializers.err },
    hooks: { logMethod(inputArgs: unknown[], method: (...args: unknown[]) => void) { method.apply(this, inputArgs.map((arg) => redactSecrets(arg, secrets))); } },
  });
}
