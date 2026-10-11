import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { eventBinding, prepareEvidence, selectRecordings } from '../scripts/record.mjs';
import { mapChangedFiles } from '../scripts/scenarios.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

function fixture(t, ids = ['filter-items']) {
  mkdirSync(resolve(root, 'artifacts'), { recursive: true });
  const directory = mkdtempSync(resolve(root, 'artifacts/producer-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const eventPath = resolve(directory, 'event.json');
  const event = { pull_request: { number: 7, head: { sha: 'a'.repeat(40), ref: 'sample-change', repo: { full_name: 'sample-owner/sample-repo', id: 3 } }, base: { sha: 'b'.repeat(40), repo: { full_name: 'sample-owner/sample-repo' } } } };
  writeFileSync(eventPath, JSON.stringify(event));
  const env = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'sample-owner/sample-repo', GITHUB_EVENT_PATH: eventPath, GITHUB_SHA: 'c'.repeat(40), GITHUB_RUN_ID: '40', GITHUB_RUN_ATTEMPT: '2', BROWSER_OUTCOME: ids.length ? 'success' : 'skipped' };
  mkdirSync(resolve(directory, 'artifacts/cypress-videos'), { recursive: true });
  writeFileSync(resolve(directory, 'artifacts/selection.json'), JSON.stringify({ scenarios: ids, unmapped: ['README.md'] }));
  const reports = ids.map((id) => {
    const video = `artifacts/cypress-videos/${id}.cy.cjs.mp4`;
    // Synthetic format header only; this fixture is deliberately not playable.
    writeFileSync(resolve(directory, video), Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]));
    return { id, result: 'passed', video };
  });
  writeFileSync(resolve(directory, 'artifacts/results.json'), JSON.stringify(reports));
  return { directory, env, event, reports, saveReports: () => writeFileSync(resolve(directory, 'artifacts/results.json'), JSON.stringify(reports)) };
}

test('maps individual features, shared UI and unmapped files', () => {
  assert.deepEqual(mapChangedFiles(['ui/state.js', 'README.md']), { scenarios: ['toggle-state'], unmapped: ['README.md'] });
  assert.deepEqual(mapChangedFiles(['cypress/e2e/dismiss-notice.cy.cjs']), { scenarios: ['dismiss-notice'], unmapped: [] });
  assert.equal(mapChangedFiles(['ui/style.css']).scenarios.length, 3);
  assert.deepEqual(mapChangedFiles(['notes/example.md']), { scenarios: [], unmapped: ['notes/example.md'] });
  assert.throws(() => mapChangedFiles(['../outside']), /invalid/);
});

test('emits an unmapped manifest without results or clips', (t) => {
  const { directory, env } = fixture(t, []);
  rmSync(resolve(directory, 'artifacts/results.json'));
  const manifest = prepareEvidence(directory, env);
  assert.equal(manifest.scope, 'unmapped');
  assert.deepEqual(manifest.scenarios, []);
  assert.deepEqual(JSON.parse(readFileSync(resolve(directory, 'artifacts/evidence/manifest.json'))), manifest);
});

test('binds complete evidence to repository, PR, merge SHA, run and attempt', (t) => {
  const { directory, env, reports } = fixture(t);
  const manifest = prepareEvidence(directory, env);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.scope, 'recorded');
  assert.equal(manifest.run_id, 40);
  assert.equal(manifest.run_attempt, 2);
  assert.equal(manifest.source_event, 'pull_request');
  assert.equal(manifest.tested_sha, env.GITHUB_SHA);
  assert.equal(manifest.pull_request.head_ref, 'sample-change');
  assert.equal(manifest.pull_request.head_repository_id, 3);
  const bytes = readFileSync(resolve(directory, reports[0].video));
  assert.equal(manifest.scenarios[0].video.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(manifest.scenarios[0].video.size_bytes, bytes.length);
  assert.deepEqual(readFileSync(resolve(directory, 'artifacts/evidence/videos/filter-items.mp4')), bytes);
});

test('keeps failed assertions in recorded evidence', (t) => {
  const item = fixture(t);
  item.reports[0].result = 'failed';
  item.saveReports();
  assert.equal(prepareEvidence(item.directory, { ...item.env, BROWSER_OUTCOME: 'failure' }).scenarios[0].result, 'failed');
  assert.throws(() => prepareEvidence(item.directory, item.env), /contradicts/);
});

test('rejects browser infrastructure failure with all-passed receipts', (t) => {
  const { directory, env } = fixture(t);
  assert.throws(() => prepareEvidence(directory, { ...env, BROWSER_OUTCOME: 'failure' }), /outside recorded assertions/);
});

for (const [name, mutate] of [
  ['missing selected result', (item) => { item.reports.pop(); item.saveReports(); }],
  ['duplicate selected result', (item) => { item.reports[1] = item.reports[0]; item.saveReports(); }],
  ['unsafe video path', (item) => { item.reports[0].video = '../video.mp4'; item.saveReports(); }],
  ['invalid result', (item) => { item.reports[0].result = 'skipped'; item.saveReports(); }],
  ['empty video', (item) => writeFileSync(resolve(item.directory, item.reports[0].video), '')],
  ['invalid MP4 header', (item) => writeFileSync(resolve(item.directory, item.reports[0].video), 'This is not an MP4 file')],
  ['video symlink', (item) => {
    const filename = resolve(item.directory, item.reports[0].video);
    rmSync(filename);
    symlinkSync(resolve(item.directory, item.reports[1].video), filename);
  }],
]) test(`rejects ${name}`, (t) => {
  const item = fixture(t, ['filter-items', 'toggle-state']);
  mutate(item);
  assert.throws(() => prepareEvidence(item.directory, item.env));
});

test('rejects missing run metadata and unrelated event types', (t) => {
  const { env } = fixture(t);
  assert.throws(() => eventBinding({ ...env, GITHUB_RUN_ATTEMPT: '' }), /binding/);
  assert.throws(() => eventBinding({ ...env, GITHUB_EVENT_NAME: 'push' }), /binding/);
  assert.throws(() => eventBinding({ ...env, GITHUB_SHA: 'invalid' }), /binding/);
});

test('selects a deleted feature using actual Git revisions', (t) => {
  const { directory, env, event } = fixture(t);
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: directory, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Synthetic Test');
  git('config', 'user.email', 'synthetic@example.invalid');
  mkdirSync(resolve(directory, 'ui'));
  writeFileSync(resolve(directory, 'ui/state.js'), 'export const sample = true;\n');
  git('add', 'ui/state.js');
  git('commit', '-qm', 'Add sample feature');
  event.pull_request.base.sha = git('rev-parse', 'HEAD');
  rmSync(resolve(directory, 'ui/state.js'));
  git('add', '-u');
  git('commit', '-qm', 'Remove sample feature');
  writeFileSync(env.GITHUB_EVENT_PATH, JSON.stringify(event));
  const updated = { ...env, GITHUB_SHA: git('rev-parse', 'HEAD') };
  assert.deepEqual(selectRecordings(directory, updated), { scenarios: ['toggle-state'], unmapped: [] });
  assert.throws(() => selectRecordings(directory, env), /Checkout/);
});
