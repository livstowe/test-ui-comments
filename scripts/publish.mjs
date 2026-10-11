import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { SCENARIOS, mapChangedFiles } from './scenarios.mjs';

export const REPOSITORY = 'livstowe/test-ui-comments';
export const ARTIFACT = 'synthetic-ui-evidence';
export const COMMENT_TAG = '<!-- synthetic-ui-evidence -->';
export const INLINE_TAG = '<!-- synthetic-inline-attachments -->';
const OWNER_LOGIN = 'livstowe';
const OWNER_ID = 27290147;
const MAX_INLINE_BYTES = 10 * 1024 * 1024;
const INLINE_STORAGE_HOSTS = new Set(['private-user-images.githubusercontent.com', 'user-images.githubusercontent.com',
  'github-production-user-asset-6210df.s3.amazonaws.com']);
const WORKFLOW_PATH = '.github/workflows/record.yml';
const WORKFLOW_NAME = 'Synthetic UI recordings';
const MAX_ZIP_BYTES = 40 * 1024 * 1024;
const MAX_CLIP_BYTES = 12 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_FILES = 200;

export class PublicationError extends Error {}
function enforce(value, explanation) {
  if (!value) throw new PublicationError(explanation);
}
function positive(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function sha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}
function fields(value, names) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}
export function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function parseJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new PublicationError('Invalid UTF-8 JSON evidence'); }
}

function ownerHandoff(comment) {
  return comment?.user?.login === OWNER_LOGIN && comment.user.id === OWNER_ID && comment.user.type === 'User'
    && typeof comment.body === 'string' && comment.body.startsWith(`${INLINE_TAG}\n`);
}
function nativeUrl(value) {
  return typeof value === 'string' && /^https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}

export function parseHandoff(comment) {
  enforce(ownerHandoff(comment) && positive(comment.id) && Buffer.byteLength(comment.body, 'utf8') <= 16 * 1024,
    'Attachment handoff identity or size is invalid');
  const lines = comment.body.split('\n');
  const encoded = lines[1]?.match(/^<!-- (\{.*\}) -->$/);
  enforce(encoded, 'Attachment handoff receipt is missing');
  const receipt = parseJson(Buffer.from(encoded[1]));
  enforce(fields(receipt, ['schema_version', 'run_id', 'run_attempt', 'tested_sha', 'scenarios'])
    && receipt.schema_version === 1 && positive(receipt.run_id) && positive(receipt.run_attempt)
    && sha(receipt.tested_sha) && Array.isArray(receipt.scenarios)
    && receipt.scenarios.length > 0 && receipt.scenarios.length <= 3, 'Attachment handoff receipt is malformed');
  for (const scenario of receipt.scenarios) {
    enforce(fields(scenario, ['id', 'sha256', 'size_bytes']) && Object.hasOwn(SCENARIOS, scenario.id)
      && typeof scenario.sha256 === 'string' && /^[a-f0-9]{64}$/.test(scenario.sha256)
      && positive(scenario.size_bytes) && scenario.size_bytes <= MAX_INLINE_BYTES, 'Attachment handoff scenario is malformed');
  }
  const urls = lines.slice(2).filter((line) => line.trim() !== '');
  enforce(urls.length === receipt.scenarios.length && urls.every(nativeUrl)
    && new Set(urls).size === urls.length
    && new Set(receipt.scenarios.map(({ id }) => id)).size === receipt.scenarios.length,
  'Attachment handoff URLs or order are invalid');
  return { commentId: comment.id, receipt, urls };
}

export function contextFromEvent(event, environment) {
  const context = { repository: environment.GITHUB_REPOSITORY, repositoryId: Number(environment.GITHUB_REPOSITORY_ID) };
  if (environment.GITHUB_EVENT_NAME === 'workflow_run') {
    enforce(event.workflow_run, 'Expected workflow_run event');
    return { ...context, runId: event.workflow_run.id, runAttempt: event.workflow_run.run_attempt };
  }
  enforce(environment.GITHUB_EVENT_NAME === 'issue_comment' && event.action === 'created'
    && event.repository?.full_name === REPOSITORY && event.repository.id === context.repositoryId
    && event.issue?.pull_request && positive(event.issue.number), 'Unsupported attachment handoff event');
  const handoff = parseHandoff(event.comment);
  return { ...context, runId: handoff.receipt.run_id, runAttempt: handoff.receipt.run_attempt,
    pullRequestNumber: event.issue.number, handoffCommentId: handoff.commentId };
}

export function openEvidence(archive) {
  enforce(archive instanceof Uint8Array && archive.length > 0 && archive.length <= MAX_ZIP_BYTES, 'ZIP exceeds size limit');
  const entries = new Set();
  const sizes = new Map();
  let total = 0;
  let files;
  try {
    files = unzipSync(archive, { filter: (entry) => {
      enforce(!entries.has(entry.name) && entries.size < 5, 'Duplicate or excessive ZIP entries');
      entries.add(entry.name);
      const clip = Object.keys(SCENARIOS).some((id) => entry.name === `videos/${id}.mp4`);
      enforce(entry.name === 'manifest.json' || entry.name === 'videos/' || clip, 'Unexpected ZIP path');
      enforce(entry.compression === 0 || entry.compression === 8, 'Unsupported ZIP compression');
      const limit = entry.name === 'manifest.json' ? MAX_MANIFEST_BYTES : MAX_CLIP_BYTES;
      enforce(Number.isSafeInteger(entry.originalSize) && entry.originalSize >= 0
        && entry.originalSize <= limit, 'ZIP member exceeds size limit');
      sizes.set(entry.name, entry.originalSize);
      total += entry.originalSize;
      enforce(total <= 3 * MAX_CLIP_BYTES + MAX_MANIFEST_BYTES, 'Expanded ZIP exceeds size limit');
      if (entry.name === 'videos/') {
        enforce(entry.originalSize === 0, 'ZIP directory contains data');
        return false;
      }
      return true;
    } });
  } catch (error) {
    if (error instanceof PublicationError) throw error;
    throw new PublicationError('Malformed ZIP evidence');
  }
  let expanded = 0;
  for (const [name, bytes] of Object.entries(files)) {
    const limit = name === 'manifest.json' ? MAX_MANIFEST_BYTES : MAX_CLIP_BYTES;
    enforce(bytes instanceof Uint8Array && bytes.length === sizes.get(name) && bytes.length <= limit,
      'Expanded ZIP member has invalid size');
    expanded += bytes.length;
  }
  enforce(expanded <= 3 * MAX_CLIP_BYTES + MAX_MANIFEST_BYTES, 'Expanded ZIP exceeds size limit');
  enforce(Object.hasOwn(files, 'manifest.json') && files['manifest.json'].length > 0, 'Manifest is missing');
  return { manifest: parseJson(files['manifest.json']), files };
}

async function readBounded(response, cap) {
  enforce(response.body, 'Response body is missing');
  const parts = [];
  let count = 0;
  for await (const bytes of response.body) {
    count += bytes.length;
    if (count > cap) {
      throw new PublicationError('HTTP response exceeds size limit');
    }
    parts.push(Buffer.from(bytes));
  }
  return Buffer.concat(parts, count);
}

export class GitHubClient {
  constructor(token, fetcher = fetch) {
    this.token = token;
    this.fetcher = fetcher;
  }
  async request(route, { method = 'GET', body, redirect = 'error' } = {}) {
    enforce(route.startsWith(`/repos/${REPOSITORY}/`), 'Unexpected API route');
    const response = await this.fetcher(`https://api.github.com${route}`, {
      method, redirect, signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json',
        'User-Agent': 'synthetic-ui-evidence-publisher',
        'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok && response.status !== 302) {
      let detail = '';
      try {
        const error = parseJson(await readBounded(response, 16 * 1024));
        if (typeof error.message === 'string' && error.message.length <= 200) detail = `: ${error.message}`;
      } catch { /* Status and public API route remain useful without error JSON. */ }
      const required = response.headers.get('x-accepted-github-permissions');
      const permissionHint = required && required.length <= 512 && !/[\r\n]/.test(required) ? ` (accepted permissions: ${required})` : '';
      throw new PublicationError(`${method} ${route.split('?')[0]} returned HTTP ${response.status}${detail}${permissionHint}`);
    }
    return response;
  }
  async json(route, options) {
    return parseJson(await readBounded(await this.request(route, options), 2 * 1024 * 1024));
  }
  async list(route, cap) {
    const all = [];
    for (let page = 1; page <= Math.ceil(cap / 100) + 1; page += 1) {
      const batch = await this.json(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      enforce(Array.isArray(batch), 'Invalid API list');
      all.push(...batch);
      enforce(all.length <= cap, 'API list exceeds size limit');
      if (batch.length < 100) return all;
    }
    throw new PublicationError('API pagination did not finish');
  }
  async download(id) {
    const response = await this.request(`/repos/${REPOSITORY}/actions/artifacts/${id}/zip`, { redirect: 'manual' });
    enforce(response.status === 302, 'Artifact redirect is missing');
    const location = response.headers.get('location');
    enforce(location, 'Artifact location is missing');
    const address = new URL(location);
    enforce(address.protocol === 'https:' && !address.username && !address.password
      && (!address.port || address.port === '443'), 'Unsafe artifact address');
    // The signed storage request receives no GitHub authorization header.
    const blob = await this.fetcher(address, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    enforce(blob.ok, `Artifact storage returned HTTP ${blob.status}`);
    return readBounded(blob, MAX_ZIP_BYTES);
  }
  async downloadAttachment(original) {
    enforce(nativeUrl(original), 'Invalid native attachment URL');
    let address = new URL(original);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const allowed = address.hostname === 'github.com'
        ? nativeUrl(`${address.origin}${address.pathname}`) && !address.search
        : INLINE_STORAGE_HOSTS.has(address.hostname);
      enforce(allowed && address.protocol === 'https:' && !address.username && !address.password
        && !address.hash && (!address.port || address.port === '443'), 'Unsafe native attachment redirect');
      // Public synthetic attachment requests never receive a GitHub token.
      const response = await this.fetcher(address, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        enforce(redirects < 3 && location && location.length <= 4096, 'Native attachment redirect limit or location is invalid');
        if (response.body) await response.body.cancel();
        try { address = new URL(location, address); }
        catch { throw new PublicationError('Invalid native attachment redirect'); }
        continue;
      }
      enforce(response.ok, `Native attachment returned HTTP ${response.status}`);
      return readBounded(response, MAX_INLINE_BYTES);
    }
    throw new PublicationError('Native attachment redirect limit exceeded');
  }
}

function checkRun(run, workflow, context) {
  enforce(run.id === context.runId && run.run_attempt === context.runAttempt, 'Source run or attempt changed');
  enforce(run.status === 'completed' && ['success', 'failure'].includes(run.conclusion)
    && run.event === 'pull_request', 'Source run has unsupported state');
  enforce(run.repository?.full_name === REPOSITORY && run.repository?.id === context.repositoryId,
    'Source repository does not match');
  enforce(workflow.name === WORKFLOW_NAME && workflow.path === WORKFLOW_PATH && positive(workflow.id)
    && run.workflow_id === workflow.id && run.name === WORKFLOW_NAME
    && run.path?.split('@')[0] === WORKFLOW_PATH, 'Producer workflow does not match');
  enforce(sha(run.head_sha) && positive(run.head_repository?.id)
    && typeof run.head_repository?.full_name === 'string' && typeof run.head_branch === 'string'
    && run.head_branch.length > 0, 'Invalid source head metadata');
  enforce(Array.isArray(run.pull_requests) && run.pull_requests.length <= 1, 'Ambiguous source PR metadata');
}

function checkPr(pr, run, receipt) {
  enforce(pr.number === receipt.number && pr.state === 'open'
    && pr.base?.repo?.full_name === REPOSITORY, 'PR is not open in the test repository');
  enforce(sha(pr.head?.sha) && sha(pr.base?.sha) && sha(pr.merge_commit_sha), 'PR SHA metadata is incomplete');
  enforce(pr.head.sha === run.head_sha && pr.head.ref === run.head_branch
    && pr.head.repo?.id === run.head_repository.id && pr.head.repo?.full_name === run.head_repository.full_name,
  'Source run does not match current PR head');
  enforce(receipt.head_sha === pr.head.sha && receipt.base_sha === pr.base.sha
    && receipt.head_repository === pr.head.repo.full_name && receipt.head_repository_id === pr.head.repo.id
    && receipt.head_ref === pr.head.ref, 'Receipt does not match current PR head/base');
  if (run.pull_requests.length) {
    const association = run.pull_requests[0];
    enforce(association.number === pr.number && association.head?.sha === pr.head.sha
      && association.base?.sha === pr.base.sha, 'Source PR association conflicts');
  }
}

export function checkManifest(evidence, run, pr, mapping) {
  const { manifest, files } = evidence;
  enforce(fields(manifest, ['schema_version', 'repository', 'source_event', 'run_id', 'run_attempt',
    'tested_sha', 'scope', 'pull_request', 'scenarios']), 'Unexpected manifest fields');
  enforce(manifest.schema_version === 1 && manifest.repository === REPOSITORY
    && manifest.source_event === 'pull_request' && manifest.run_id === run.id
    && manifest.run_attempt === run.run_attempt, 'Manifest source metadata does not match');
  enforce(manifest.tested_sha === pr.merge_commit_sha, 'Tested merge SHA is stale');
  enforce(Array.isArray(manifest.scenarios) && manifest.scenarios.length <= 3, 'Invalid scenario list');
  const expectedScope = mapping.scenarios.length ? 'recorded' : 'unmapped';
  enforce(manifest.scope === expectedScope, 'Manifest scope conflicts with changed files');
  const ids = manifest.scenarios.map((scenario) => scenario.id);
  enforce(new Set(ids).size === ids.length && ids.length === mapping.scenarios.length
    && mapping.scenarios.every((id) => ids.includes(id)), 'Scenario coverage is incomplete or unexpected');
  const permitted = new Set(['manifest.json']);
  for (const scenario of manifest.scenarios) {
    enforce(fields(scenario, ['id', 'result', 'video']) && Object.hasOwn(SCENARIOS, scenario.id)
      && ['passed', 'failed'].includes(scenario.result), 'Invalid scenario result');
    enforce(fields(scenario.video, ['path', 'sha256', 'size_bytes']), 'Recording metadata is missing');
    const name = `videos/${scenario.id}.mp4`;
    const bytes = files[name];
    enforce(scenario.video.path === name && bytes instanceof Uint8Array && bytes.length > 0
      && bytes.length <= MAX_CLIP_BYTES && scenario.video.size_bytes === bytes.length
      && /^[a-f0-9]{64}$/.test(scenario.video.sha256) && hash(bytes) === scenario.video.sha256,
    'Recording bytes, size or hash do not match');
    const boxSize = bytes.length >= 16 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) : 0;
    enforce(boxSize >= 16 && boxSize <= bytes.length && Buffer.from(bytes.subarray(4, 8)).toString('ascii') === 'ftyp',
      'Recording does not have an MP4 file-type box');
    permitted.add(name);
  }
  enforce(Object.keys(files).every((name) => permitted.has(name)), 'Unclaimed evidence file');
  const failed = manifest.scenarios.some((scenario) => scenario.result === 'failed');
  enforce(run.conclusion === (failed ? 'failure' : 'success'), 'Producer conclusion conflicts with scenario results');
  return manifest;
}

export function chooseComment(comments, body, run) {
  const owned = comments.filter((comment) => comment.user?.login === 'github-actions[bot]'
    && comment.user.type === 'Bot' && comment.body?.startsWith(`${COMMENT_TAG}\n`));
  enforce(owned.length <= 1, 'Multiple managed bot comments exist');
  if (!owned.length) return { action: 'create', body };
  enforce(positive(owned[0].id), 'Managed comment ID is invalid');
  const previous = owned[0].body.split('\n')[1]?.match(/^<!-- run=(\d+) attempt=(\d+) -->$/);
  enforce(previous && positive(Number(previous[1])) && positive(Number(previous[2])), 'Managed comment run metadata is invalid');
  const oldId = Number(previous[1]);
  const oldAttempt = Number(previous[2]);
  enforce(run.id > oldId || (run.id === oldId && run.run_attempt >= oldAttempt), 'Older evidence cannot replace newer evidence');
  return { action: body === owned[0].body ? 'unchanged' : 'update', id: owned[0].id, body };
}

async function inlineAttachments(client, comments, evidence, context) {
  const handoffs = comments.filter(ownerHandoff).map(parseHandoff)
    .filter(({ receipt }) => receipt.run_id === evidence.manifest.run_id);
  enforce(handoffs.length <= 1, 'Duplicate owner attachment handoffs exist for the source run');
  if (!handoffs.length) {
    enforce(!context.handoffCommentId, 'Triggering attachment handoff is missing');
    return [];
  }
  const { receipt, urls, commentId } = handoffs[0];
  const manifest = evidence.manifest;
  enforce((!context.handoffCommentId || context.handoffCommentId === commentId)
    && receipt.run_attempt === manifest.run_attempt && receipt.tested_sha === manifest.tested_sha
    && receipt.scenarios.length === manifest.scenarios.length, 'Attachment handoff source is stale or conflicting');
  for (let index = 0; index < receipt.scenarios.length; index += 1) {
    const scenario = receipt.scenarios[index];
    const recording = manifest.scenarios[index];
    enforce(scenario.id === recording.id && scenario.sha256 === recording.video.sha256
      && scenario.size_bytes === recording.video.size_bytes, 'Attachment handoff does not match recording evidence');
  }
  await Promise.all(urls.map(async (url, index) => {
    const bytes = await client.downloadAttachment(url);
    const expected = evidence.files[manifest.scenarios[index].video.path];
    enforce(bytes instanceof Uint8Array && bytes.length <= MAX_INLINE_BYTES && bytes.length === expected.length
      && hash(bytes) === hash(expected), 'Native attachment bytes, size or hash do not match evidence');
  }));
  return urls;
}

function buildComment(manifest, run, artifact, mapping, nativeUrls) {
  const runLink = `https://github.com/${REPOSITORY}/actions/runs/${run.id}`;
  const bundleLink = `${runLink}/artifacts/${artifact.id}`;
  const rows = manifest.scenarios.map((scenario) => `| ${SCENARIOS[scenario.id].label} | ${scenario.result.toUpperCase()} | [MP4 in bundle](${bundleLink}) |`);
  const escapedPaths = mapping.unmapped.map((name) => `- <code>${name.replace(/[&<>"'`\[\]*_~|():]/g,
    (character) => `&#${character.codePointAt(0)};`)}</code>`);
  const inlineRows = nativeUrls.length ? [
    "Native videos were uploaded through the repository owner's authenticated GitHub CLI. The bot verified their bytes and maintains this comment automatically.", '',
    ...manifest.scenarios.flatMap((scenario, index) => [`**${SCENARIOS[scenario.id].label}: ${scenario.result.toUpperCase()}**`, '', nativeUrls[index], '']),
  ] : ['This comment contains no inline video attachments; no matching owner upload handoff was supplied.', ''];
  const body = [COMMENT_TAG, `<!-- run=${run.id} attempt=${run.run_attempt} -->`, '### Synthetic UI recordings', '',
    `Tested merge: \`${manifest.tested_sha}\``, `PR head: \`${manifest.pull_request.head_sha}\``,
    `PR base: \`${manifest.pull_request.base_sha}\``, `Producer: **${run.conclusion.toUpperCase()}**, attempt ${run.run_attempt}.`, '',
    `[Recording run](${runLink}) · [Download recording bundle](${bundleLink})`, '',
    '| Synthetic scenario | Result | Recording |', '| --- | --- | --- |', ...rows, '', ...inlineRows,
    `Unmapped changed paths: ${mapping.unmapped.length}. No fixture coverage is claimed for those paths.`,
    ...escapedPaths, '',
    'These independent toy scenarios use no external services. Results are producer claims; hashes verify the received recording bytes.',
    'The artifact link downloads a ZIP containing the MP4s. GitHub login is required and artifacts expire.', ''].join('\n');
  enforce(Buffer.byteLength(body, 'utf8') <= 60_000, 'Comment exceeds size limit');
  return body;
}

export async function publishEvidence(client, context, { write = false } = {}) {
  enforce(context.repository === REPOSITORY && positive(context.repositoryId)
    && positive(context.runId) && positive(context.runAttempt), 'Invalid publisher context');
  const prefix = `/repos/${REPOSITORY}`;
  const workflow = await client.json(`${prefix}/actions/workflows/record.yml`);
  const run = await client.json(`${prefix}/actions/runs/${context.runId}`);
  checkRun(run, workflow, context);
  const catalog = await client.json(`${prefix}/actions/runs/${run.id}/artifacts?name=${ARTIFACT}&per_page=100`);
  enforce(Array.isArray(catalog.artifacts) && catalog.total_count === 1 && catalog.artifacts.length === 1,
    'Evidence artifact is missing or ambiguous');
  const artifact = catalog.artifacts[0];
  enforce(positive(artifact.id) && artifact.name === ARTIFACT && artifact.expired === false
    && artifact.workflow_run?.id === run.id && positive(artifact.size_in_bytes)
    && artifact.size_in_bytes <= MAX_ZIP_BYTES, 'Evidence artifact metadata is invalid');
  const archive = await client.download(artifact.id);
  enforce(artifact.digest === `sha256:${hash(archive)}`, 'Artifact digest does not match');
  const evidence = openEvidence(archive);
  const receipt = evidence.manifest?.pull_request;
  enforce(fields(receipt, ['number', 'head_sha', 'base_sha', 'head_repository', 'head_repository_id', 'head_ref'])
    && positive(receipt.number), 'PR receipt is missing or malformed');
  const pr = await client.json(`${prefix}/pulls/${receipt.number}`);
  enforce(!context.pullRequestNumber || context.pullRequestNumber === pr.number, 'Handoff event refers to a different PR');
  checkPr(pr, run, receipt);
  const owner = run.head_repository.full_name.split('/')[0];
  const candidates = await client.list(`${prefix}/pulls?state=open&head=${encodeURIComponent(`${owner}:${run.head_branch}`)}`, 100);
  const matching = candidates.filter((candidate) => candidate.state === 'open'
    && candidate.head?.sha === run.head_sha && candidate.head?.ref === run.head_branch
    && candidate.head?.repo?.id === run.head_repository.id && candidate.base?.repo?.full_name === REPOSITORY);
  enforce(matching.length === 1 && matching[0].number === pr.number, 'Open source PR is missing or ambiguous');
  const changed = await client.list(`${prefix}/pulls/${pr.number}/files`, MAX_FILES);
  enforce(changed.length === pr.changed_files && changed.length <= MAX_FILES, 'Changed-file list is incomplete');
  const paths = changed.flatMap((file) => [file.filename, ...(file.previous_filename ? [file.previous_filename] : [])]);
  enforce(paths.every((name) => typeof name === 'string' && name.length > 0 && name.length <= 300
    && !/[\\\u0000-\u001f]/.test(name) && !name.startsWith('/')
    && !name.split('/').some((part) => !part || part === '.' || part === '..')), 'Unsafe changed-file metadata');
  const mapping = mapChangedFiles(paths);
  const manifest = checkManifest(evidence, run, pr, mapping);
  const freshPr = await client.json(`${prefix}/pulls/${pr.number}`);
  const freshRun = await client.json(`${prefix}/actions/runs/${run.id}`);
  checkRun(freshRun, workflow, context);
  checkPr(freshPr, freshRun, receipt);
  enforce(freshPr.merge_commit_sha === manifest.tested_sha && freshRun.conclusion === run.conclusion,
    'PR merge or producer conclusion changed during validation');
  if (manifest.scope === 'unmapped') {
    return { action: 'skipped', summary: '| Scope | Result |\n| --- | --- |\n| Unmapped changes | No mapped scenario ran; no comment was written. |\n' };
  }
  const comments = await client.list(`${prefix}/issues/${pr.number}/comments`, 500);
  const nativeUrls = await inlineAttachments(client, comments, evidence, context);
  const body = buildComment(manifest, run, artifact, mapping, nativeUrls);
  const plan = chooseComment(comments, body, run);
  if (!write || plan.action === 'unchanged') return plan;
  const lastPr = await client.json(`${prefix}/pulls/${pr.number}`);
  const lastRun = await client.json(`${prefix}/actions/runs/${run.id}`);
  checkRun(lastRun, workflow, context);
  checkPr(lastPr, lastRun, receipt);
  enforce(lastPr.merge_commit_sha === manifest.tested_sha && lastRun.conclusion === run.conclusion, 'Evidence changed before write');
  const route = plan.action === 'create' ? `${prefix}/issues/${pr.number}/comments` : `${prefix}/issues/comments/${plan.id}`;
  const saved = await client.json(route, { method: plan.action === 'create' ? 'POST' : 'PATCH', body: { body } });
  return { ...plan, id: saved.id };
}

async function main() {
  try {
    enforce(process.env.GH_TOKEN, 'Workflow token is missing');
    const eventBytes = await readFile(process.env.GITHUB_EVENT_PATH);
    enforce(eventBytes.length <= 1024 * 1024, 'Workflow event exceeds size limit');
    const event = parseJson(eventBytes);
    const context = contextFromEvent(event, process.env);
    const outcome = await publishEvidence(new GitHubClient(process.env.GH_TOKEN), context, { write: process.argv.includes('--write') });
    console.log(`Publisher: ${outcome.action}${outcome.id ? ` comment ${outcome.id}` : ''}`);
    if (outcome.summary) console.log(outcome.summary);
    if (outcome.summary && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, outcome.summary);
  } catch (error) {
    console.error(`Publisher rejected evidence: ${error instanceof PublicationError ? error.message : 'unexpected validation error'}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
