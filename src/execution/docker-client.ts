import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { CommandSpec, DockerExecutionResult, DockerRunSpec } from '../domain/schemas.js';

export interface DockerClient {
  version(): Promise<{ serverVersion: string }>;
  inspectImage(image: string): Promise<void>;
  run(spec: DockerRunSpec): Promise<DockerExecutionResult>;
}

export interface ProcessResult { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; }

export function runProcess(executable: string, args: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, [...args], { windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    const abort = () => { if (!timedOut) child.kill('SIGTERM'); };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ exitCode: null, stdout: Buffer.concat(stdout).toString(), stderr: error.message, timedOut });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), timedOut });
    });
  });
}

function truncate(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value);
  return bytes.byteLength <= maxBytes ? value : `${bytes.subarray(0, maxBytes).toString()}\n[output truncated]`;
}

export class CliDockerClient implements DockerClient {
  async version(): Promise<{ serverVersion: string }> {
    const result = await runProcess('docker', ['version', '--format', '{{.Server.Version}}'], 10_000);
    if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error(result.stderr || 'Docker daemon is unavailable');
    return { serverVersion: result.stdout.trim() };
  }

  async inspectImage(image: string): Promise<void> {
    const result = await runProcess('docker', ['image', 'inspect', image], 10_000);
    if (result.exitCode !== 0) throw new Error(result.stderr || `Docker image is unavailable: ${image}`);
  }

  async run(spec: DockerRunSpec): Promise<DockerExecutionResult> {
    await mkdir(spec.artifactDirectory, { recursive: true });
    const name = `flaky-hunter-${randomUUID()}`;
    const args = [
      'run', '--rm', '--pull=never', '--name', name,
      '--network', spec.network === 'enabled' ? 'bridge' : 'none',
      '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--pids-limit', String(spec.pidsLimit ?? 256), '--cpus', String(spec.cpus ?? 1),
      '--memory', String(spec.memoryBytes ?? 512 * 1024 * 1024), '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m',
      '--mount', `type=bind,src=${spec.repositoryPath},dst=/workspace,readonly`,
      '--mount', `type=bind,src=${spec.artifactDirectory},dst=/artifacts`,
      '--workdir', spec.command.cwd,
    ];
    for (const [key, value] of Object.entries(spec.command.env)) args.push('--env', `${key}=${value}`);
    args.push(spec.image, spec.command.executable, ...spec.command.args);
    const startedAt = Date.now();
    const result = await runProcess('docker', args, spec.timeoutMs, spec.signal);
    return {
      started: result.exitCode !== null || result.timedOut,
      containerId: name,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      cancelled: Boolean(spec.signal?.aborted) && !result.timedOut,
      ...(result.timedOut ? { failureKind: 'executor_timeout' as const } : result.exitCode === null ? { failureKind: 'container_start_failed' as const } : {}),
      ...(result.exitCode === null ? { failureMessage: result.stderr } : {}),
      stdout: truncate(result.stdout, spec.maxOutputBytes),
      stderr: truncate(result.stderr, spec.maxOutputBytes),
      durationMs: Date.now() - startedAt,
    };
  }
}
