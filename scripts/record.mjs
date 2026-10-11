import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, mapChangedFiles } from './scenarios.mjs';

const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readJson(filename, limit) {
  const stats = lstatSync(filename);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > limit) throw new Error('Invalid or oversized JSON input');
  return JSON.parse(readFileSync(filename, 'utf8'));
}

export function eventBinding(env = process.env) {
  const runId = Number(env.GITHUB_RUN_ID);
  const attempt = Number(env.GITHUB_RUN_ATTEMPT);
  if (env.GITHUB_EVENT_NAME !== 'pull_request' || !REPOSITORY.test(env.GITHUB_REPOSITORY ?? '') || !SHA.test(env.GITHUB_SHA ?? '') || !Number.isSafeInteger(runId) || runId < 1 || !Number.isSafeInteger(attempt) || attempt < 1) throw new Error('Missing pull request run binding');
  const event = readJson(env.GITHUB_EVENT_PATH, 256 * 1024);
  const pr = event.pull_request;
  if (!Number.isSafeInteger(pr?.number) || pr.number < 1 || pr.base?.repo?.full_name !== env.GITHUB_REPOSITORY || !SHA.test(pr.head?.sha ?? '') || !SHA.test(pr.base?.sha ?? '') || !REPOSITORY.test(pr.head?.repo?.full_name ?? '') || !Number.isSafeInteger(pr.head.repo.id) || pr.head.repo.id < 1 || typeof pr.head.ref !== 'string' || pr.head.ref.length < 1 || pr.head.ref.length > 255 || /[\r\n]/.test(pr.head.ref)) throw new Error('Invalid pull request metadata');
  return {
    repository: env.GITHUB_REPOSITORY,
    source_event: 'pull_request',
    run_id: runId,
    run_attempt: attempt,
    tested_sha: env.GITHUB_SHA,
    pull_request: { number: pr.number, head_sha: pr.head.sha, base_sha: pr.base.sha, head_repository: pr.head.repo.full_name, head_repository_id: pr.head.repo.id, head_ref: pr.head.ref },
  };
}

export function selectRecordings(directory = root, env = process.env) {
  const binding = eventBinding(env);
  const git = (args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (git(['rev-parse', 'HEAD']).trim() !== binding.tested_sha) throw new Error('Checkout does not match tested commit');
  const files = git(['diff', '--no-renames', '--name-only', '-z', binding.pull_request.base_sha, binding.tested_sha, '--']).split('\0').filter(Boolean);
  const selection = mapChangedFiles(files);
  mkdirSync(resolve(directory, 'artifacts'), { recursive: true });
  writeFileSync(resolve(directory, 'artifacts/selection.json'), `${JSON.stringify(selection)}\n`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `specs=${selection.scenarios.map((id) => SCENARIOS[id].spec).join(',')}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    const safe = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '\\n').replaceAll('\r', '\\r');
    appendFileSync(env.GITHUB_STEP_SUMMARY, `Selected browser scenarios: ${selection.scenarios.join(', ') || 'none'}\n\nUnmapped files have no browser coverage:\n${selection.unmapped.map((file) => `- <code>${safe(file)}</code>`).join('\n') || '- None'}\n`);
  }
  return selection;
}

export function prepareEvidence(directory = root, env = process.env) {
  const binding = eventBinding(env);
  const selection = readJson(resolve(directory, 'artifacts/selection.json'), 2 * 1024 * 1024);
  if (!Array.isArray(selection.scenarios) || selection.scenarios.length > 3 || new Set(selection.scenarios).size !== selection.scenarios.length || selection.scenarios.some((id) => !Object.hasOwn(SCENARIOS, id))) throw new Error('Invalid scenario selection');
  const reports = selection.scenarios.length ? readJson(resolve(directory, 'artifacts/results.json'), 64 * 1024) : [];
  if (!Array.isArray(reports) || reports.length !== selection.scenarios.length) throw new Error('Incomplete browser results');
  const videos = [];
  const scenarios = selection.scenarios.map((id) => {
    const matching = reports.filter((report) => report.id === id);
    if (matching.length !== 1) throw new Error('Missing or repeated scenario result');
    const report = matching[0];
    if (!['passed', 'failed'].includes(report.result) || report.video !== `artifacts/cypress-videos/${id}.cy.cjs.mp4`) throw new Error('Invalid browser receipt');
    const source = resolve(directory, report.video);
    const stats = lstatSync(source);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1 || stats.size > 12 * 1024 * 1024) throw new Error('Missing, empty, or oversized recording');
    const bytes = readFileSync(source);
    if (bytes.length < 16 || bytes.toString('ascii', 4, 8) !== 'ftyp' || bytes.readUInt32BE(0) < 16 || bytes.readUInt32BE(0) > bytes.length) throw new Error('Recording is missing an MP4 file-type header');
    const path = `videos/${id}.mp4`;
    videos.push({ source, path });
    return { id, result: report.result, video: { path, sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: stats.size } };
  });
  if (scenarios.length && env.BROWSER_OUTCOME === 'failure' && !scenarios.some((scenario) => scenario.result === 'failed')) throw new Error('Browser failed outside recorded assertions');
  if (scenarios.length && env.BROWSER_OUTCOME === 'success' && scenarios.some((scenario) => scenario.result === 'failed')) throw new Error('Browser outcome contradicts scenario results');
  const manifest = { schema_version: 1, ...binding, scope: scenarios.length ? 'recorded' : 'unmapped', scenarios };
  const evidence = resolve(directory, 'artifacts/evidence');
  rmSync(evidence, { recursive: true, force: true });
  mkdirSync(evidence, { recursive: true });
  if (videos.length) mkdirSync(resolve(evidence, 'videos'));
  for (const video of videos) copyFileSync(video.source, resolve(evidence, video.path));
  writeFileSync(resolve(evidence, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'select') selectRecordings();
  else if (process.argv[2] === 'prepare') prepareEvidence();
  else throw new Error('Use select or prepare');
}
