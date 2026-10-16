import { mkdir, writeFile } from 'node:fs/promises';
import type { TestAnalysis } from '../domain/schemas.js';
import { classifyInvestigation } from '../domain/classifier.js';
import type { InvestigationDatabase } from '../persistence/database.js';

export interface InvestigationReport { toolVersion: string; investigationId: string; status: string; config: unknown; aggregates: ReturnType<typeof classifyInvestigation>; analyses: TestAnalysis[]; }

export function buildReport(database: InvestigationDatabase, investigationId: string): InvestigationReport {
  const investigation = database.getInvestigation(investigationId);
  if (!investigation) throw new Error(`Investigation not found: ${investigationId}`);
  return {
    toolVersion: investigation.toolVersion,
    investigationId,
    status: investigation.status,
    config: investigation.config,
    aggregates: classifyInvestigation(database.testResults(investigationId), database.investigationRunStatuses(investigationId), investigation.config.repetitions),
    analyses: database.analyses(investigationId),
  };
}

export function renderMarkdown(report: InvestigationReport): string {
  const lines = [`# Flaky Tests Hunter Report`, '', `- Investigation: \`${report.investigationId}\``, `- Status: **${report.status}**`, `- Tool version: \`${report.toolVersion}\``, '', '## Test stability', '', '| Test | Classification | Pass | Fail | Timeout | Crash | Infra | Flake rate | Confidence |', '|---|---|---:|---:|---:|---:|---:|---:|---|'];
  for (const aggregate of report.aggregates) lines.push(`| ${aggregate.testId} | ${aggregate.classification} | ${aggregate.passed} | ${aggregate.failed} | ${aggregate.timedOut} | ${aggregate.crashed} | ${aggregate.infrastructureErrors} | ${aggregate.flakeRate === null ? 'n/a' : `${(aggregate.flakeRate * 100).toFixed(1)}%`} | ${aggregate.confidence} |`);
  lines.push('', '## Analysis');
  if (report.analyses.length === 0) lines.push('', 'No analysis is available.');
  for (const analysis of report.analyses) lines.push('', `### ${analysis.testId}`, '', `- Likely category: **${analysis.likelyCategory}**`, `- Confidence: **${analysis.confidence}**`, `- Hypothesis: ${analysis.hypothesis}`, `- Recommendation: ${analysis.recommendation}`, '', '**Observed facts**', ...analysis.observedFacts.map((fact) => `- ${fact}`), '', '**Limitations**', ...analysis.limitations.map((limitation) => `- ${limitation}`));
  return `${lines.join('\n')}\n`;
}

export async function writeReports(database: InvestigationDatabase, investigationId: string, directory: string): Promise<{ jsonPath: string; markdownPath: string }> {
  const report = buildReport(database, investigationId);
  await mkdir(directory, { recursive: true });
  const jsonPath = `${directory}/report.json`;
  const markdownPath = `${directory}/report.md`;
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderMarkdown(report), 'utf8');
  return { jsonPath, markdownPath };
}
