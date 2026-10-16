import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InvestigationConfigSchema } from '../domain/schemas.js';
import { buildReport, renderMarkdown } from '../reporting/report.js';
import { InvestigationDatabase } from '../persistence/database.js';

const database = new InvestigationDatabase(resolve(process.env.FLAKY_HUNTER_DB ?? 'data/flaky-hunter.db'));
const toolVersion = '0.1.0';
const webRoot = existsSync(resolve('src/web')) ? resolve('src/web') : resolve('dist/src/web');

function json(response: ServerResponse, status: number, value: unknown): void { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
async function body(request: IncomingMessage): Promise<unknown> { let text = ''; for await (const chunk of request) text += String(chunk); return text ? JSON.parse(text) : {}; }
function idFrom(pathname: string): string | undefined { return pathname.match(/^\/api\/investigations\/([^/]+)/)?.[1]; }

async function api(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  if (url.pathname === '/api/health') return json(response, 200, { ok: true, toolVersion });
  if (url.pathname === '/api/investigations' && request.method === 'GET') return json(response, 200, { investigations: database.listInvestigations().map((item) => ({ id: item.id, status: item.status, createdAt: item.createdAt, completedAt: item.completedAt, repositoryPath: item.config.repositoryPath, command: item.config.command, repetitions: item.config.repetitions, counts: item.counts })) });
  if (url.pathname === '/api/investigations' && request.method === 'POST') {
    const config = InvestigationConfigSchema.parse(await body(request));
    const id = randomUUID(); database.insertInvestigation(id, config); return json(response, 201, { id, status: 'created' });
  }
  const id = idFrom(url.pathname);
  if (!id) return json(response, 404, { error: 'Not found' });
  const investigation = database.getInvestigation(id);
  if (!investigation) return json(response, 404, { error: `Investigation not found: ${id}` });
  if (url.pathname === `/api/investigations/${id}` && request.method === 'GET') return json(response, 200, { report: buildReport(database, id), progress: { total: investigation.config.repetitions, completed: database.runs(id).filter((run) => ['passed', 'failed', 'timed_out', 'crashed', 'infra_error', 'cancelled', 'unparsed'].includes(String(run.status))).length, active: database.runCounts(id).running ?? 0, queued: database.runCounts(id).queued ?? 0 }, runs: database.runs(id), events: database.events(id) });
  if (url.pathname === `/api/investigations/${id}/events` && request.method === 'GET') return json(response, 200, { events: database.events(id) });
  if (url.pathname === `/api/investigations/${id}/report` && request.method === 'GET') { const report = buildReport(database, id); if (url.searchParams.get('format') === 'markdown') { response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' }); response.end(renderMarkdown(report)); } else json(response, 200, report); return; }
  return json(response, 404, { error: 'Not found' });
}

export function createDashboardServer(): ReturnType<typeof createServer> {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (url.pathname.startsWith('/api/')) return await api(request, response, url);
      const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (filename.includes('..') || filename.includes('\\')) return json(response, 400, { error: 'Invalid path' });
      const file = join(webRoot, filename);
      const content = await readFile(file);
      const type = filename.endsWith('.css') ? 'text/css' : filename.endsWith('.js') ? 'text/javascript' : 'text/html';
      response.writeHead(200, { 'content-type': `${type}; charset=utf-8` }); response.end(content);
    } catch (error) { json(response, 500, { error: error instanceof Error ? error.message : String(error) }); }
  });
}

if (process.argv[1]?.endsWith('server/index.js')) createDashboardServer().listen(Number(process.env.PORT ?? 4173), process.env.HOST ?? '127.0.0.1', () => console.log(`Dashboard running at http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 4173}`));
