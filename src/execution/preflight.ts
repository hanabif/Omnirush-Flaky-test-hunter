import { access, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { InvestigationConfig } from '../domain/schemas.js';
import type { DockerClient } from './docker-client.js';

export interface PreflightCheck { name: string; passed: boolean; severity: 'error' | 'warning'; message: string; }
export interface PreflightReport { passed: boolean; checks: readonly PreflightCheck[]; dockerServerVersion?: string; }

export async function preflight(config: InvestigationConfig, docker: DockerClient): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  const repository = resolve(config.repositoryPath);
  try { const info = await stat(repository); checks.push({ name: 'repository', passed: info.isDirectory(), severity: 'error', message: info.isDirectory() ? 'Repository is a directory' : 'Repository path is not a directory' }); }
  catch { checks.push({ name: 'repository', passed: false, severity: 'error', message: `Repository does not exist: ${repository}` }); }
  try { await access(repository); checks.push({ name: 'repository_access', passed: true, severity: 'error', message: 'Repository is accessible' }); } catch { checks.push({ name: 'repository_access', passed: false, severity: 'error', message: 'Repository is not accessible' }); }
  try { const version = await docker.version(); checks.push({ name: 'docker_daemon', passed: true, severity: 'error', message: 'Docker daemon is available' });
    try { await docker.inspectImage(config.image); checks.push({ name: 'image', passed: true, severity: 'error', message: `Docker image is available: ${config.image}` }); return { passed: checks.every((check) => check.passed), checks, dockerServerVersion: version.serverVersion }; }
    catch (error) { checks.push({ name: 'image', passed: false, severity: 'error', message: error instanceof Error ? error.message : String(error) }); }
  } catch (error) { checks.push({ name: 'docker_daemon', passed: false, severity: 'error', message: error instanceof Error ? error.message : String(error) }); }
  return { passed: checks.every((check) => check.passed), checks };
}
