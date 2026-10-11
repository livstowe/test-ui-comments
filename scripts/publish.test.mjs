import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { ARTIFACT, COMMENT_TAG, REPOSITORY, GitHubClient, hash, openEvidence, publishEvidence } from './publish.mjs';
import { mapChangedFiles } from './scenarios.mjs';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const merge = 'c'.repeat(40);
// A minimal file-type box tests format checks; it is not a playable video.
const header = Uint8Array.of(0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0);
const copy = (value) => structuredClone(value);
const prefix = `/repos/${REPOSITORY}`;

function fixture({ files = ['ui/filter.js'], results = {}, conclusion = 'success' } = {}) {
  const repository = { full_name: REPOSITORY, id: 101 };
  const state = {
    context: { repository: REPOSITORY, repositoryId: 101, runId: 401, runAttempt: 1 },
    workflow: { id: 301, name: 'Synthetic UI recordings', path: '.github/workflows/record.yml' },
    run: { id: 401, run_attempt: 1, status: 'completed', conclusion, event: 'pull_request', repository,
      workflow_id: 301, name: 'Synthetic UI recordings', path: '.github/workflows/record.yml',
      head_sha: head, head_branch: 'demo-change', head_repository: repository, pull_requests: [] },
    pr: { number: 7, state: 'open', head: { sha: head, ref: 'demo-change', repo: repository },
      base: { sha: base, repo: repository }, merge_commit_sha: merge, changed_files: files.length },
    files: files.map((filename) => ({ filename })), comments: [], writes: [], calls: [], beforeRead: () => {},
  };
  const mapping = mapChangedFiles(files);
  state.manifest = { schema_version: 1, repository: REPOSITORY, source_event: 'pull_request', run_id: 401,
    run_attempt: 1, tested_sha: merge, scope: mapping.scenarios.length ? 'recorded' : 'unmapped',
    pull_request: { number: 7, head_sha: head, base_sha: base, head_repository: REPOSITORY,
      head_repository_id: 101, head_ref: 'demo-change' },
    scenarios: mapping.scenarios.map((id) => ({ id, result: results[id] ?? 'passed',
      video: { path: `videos/${id}.mp4`, sha256: hash(header), size_bytes: header.length } })),
  };
  state.members = Object.fromEntries(state.manifest.scenarios.map(({ video }) => [video.path, header]));
  state.repack = () => {
    state.archive = zipSync({ 'manifest.json': strToU8(JSON.stringify(state.manifest)), ...state.members });
    state.artifact = { id: 501, name: ARTIFACT, expired: false, workflow_run: { id: 401 },
      size_in_bytes: state.archive.length, digest: `sha256:${hash(state.archive)}` };
    state.catalog = { total_count: 1, artifacts: [state.artifact] };
  };
  state.repack();
  state.candidates = [state.pr];
  state.client = {
    async json(route, options = {}) {
      const method = options.method ?? 'GET';
      state.calls.push({ route, method });
      if (method !== 'GET') {
        const id = method === 'POST' ? 601 : Number(route.split('/').at(-1));
        const saved = { id, body: options.body.body, user: { login: 'github-actions[bot]', type: 'Bot' } };
        if (method === 'POST') state.comments.push(saved);
        else state.comments[state.comments.findIndex((comment) => comment.id === id)] = saved;
        state.writes.push({ route, method, id, body: saved.body });
        return copy(saved);
      }
      state.beforeRead(route, state.calls.filter((call) => call.route === route && call.method === 'GET').length);
      if (route === `${prefix}/actions/workflows/record.yml`) return copy(state.workflow);
      if (route === `${prefix}/actions/runs/${state.context.runId}`) return copy(state.run);
      if (route.includes('/artifacts?')) return copy(state.catalog);
      if (route === `${prefix}/pulls/7`) return copy(state.pr);
      throw new Error(`Unhandled fixture route: ${route}`);
    },
    async list(route, cap) {
      state.calls.push({ route, cap });
      if (route.includes('/pulls?')) return copy(state.candidates);
      if (route.endsWith('/files')) return copy(state.files);
      if (route.endsWith('/comments')) return copy(state.comments);
      throw new Error(`Unhandled fixture list: ${route}`);
    },
    async download(id) { assert.equal(id, state.artifact.id); return state.archive; },
  };
  return state;
}

async function rejected(state, pattern) {
  await assert.rejects(publishEvidence(state.client, state.context, { write: true }), pattern);
  assert.equal(state.writes.length, 0, 'Rejected evidence must not write a comment');
}

test('bot lifecycle creates, fully validates a no-op, and updates the same comment ID', async () => {
  const state = fixture();
  state.comments.push({ id: 600, body: `${COMMENT_TAG}\nA human marker is preserved.`, user: { login: 'livstowe', type: 'User' } });
  const first = await publishEvidence(state.client, state.context, { write: true });
  assert.equal(first.action, 'create');
  assert.equal(first.id, 601);
  assert.match(first.body, /PASSED/);
  assert.match(first.body, /no inline video attachments/);
  const noop = await publishEvidence(state.client, state.context, { write: true });
  assert.equal(noop.action, 'unchanged');
  assert.equal(state.writes.length, 1);
  state.run.run_attempt = state.context.runAttempt = state.manifest.run_attempt = 2;
  state.repack();
  const update = await publishEvidence(state.client, state.context, { write: true });
  assert.equal(update.action, 'update');
  assert.equal(update.id, 601);
  assert.equal(state.writes[1].method, 'PATCH');
  assert.match(state.writes[1].route, /issues\/comments\/601$/);
  assert.equal(state.comments.length, 2);
  assert.match(state.comments[0].body, /A human marker is preserved/);
  // Matching body must not bypass fresh evidence validation.
  state.artifact.digest = `sha256:${'0'.repeat(64)}`;
  await assert.rejects(publishEvidence(state.client, state.context, { write: true }), /digest/);
  assert.equal(state.writes.length, 2);
});

test('dry-run validates without writing', async () => {
  const state = fixture();
  assert.equal((await publishEvidence(state.client, state.context)).action, 'create');
  assert.equal(state.writes.length, 0);
});

test('mixed changes name unmapped paths as escaped code', async () => {
  const state = fixture({ files: ['ui/filter.js', 'docs/<demo>&note.md'] });
  const result = await publishEvidence(state.client, state.context);
  assert.match(result.body, /Unmapped changed paths: 1/);
  assert.match(result.body, /<code>docs\/&#60;demo&#62;&#38;note.md<\/code>/);
  assert.equal(result.body.includes('<demo>'), false);
});

test('a failure publishes its failed result and recording link', async () => {
  const state = fixture({ files: ['ui/state.js'], results: { 'toggle-state': 'failed' }, conclusion: 'failure' });
  const plan = await publishEvidence(state.client, state.context, { write: true });
  assert.match(plan.body, /Enable and disable an item \| FAILED \| \[MP4 in bundle\]/);
  assert.match(plan.body, /Producer: \*\*FAILURE\*\*/);
});

test('unmapped manifest is validated and skipped without reading or writing comments', async () => {
  const state = fixture({ files: ['docs/demo.md'] });
  const plan = await publishEvidence(state.client, state.context, { write: true });
  assert.equal(plan.action, 'skipped');
  assert.match(plan.summary, /No mapped scenario ran; no comment was written/);
  assert.equal(state.writes.length, 0);
  assert.equal(state.calls.some(({ route }) => route.includes('/comments')), false);
  state.manifest.tested_sha = 'd'.repeat(40);
  state.repack();
  await rejected(state, /Tested merge SHA is stale/);
});

test('renamed mapped files include both old and new path coverage', async () => {
  const state = fixture({ files: ['ui/notice.js', 'ui/filter.js'] });
  state.files = [{ filename: 'ui/notice.js', previous_filename: 'ui/filter.js' }];
  state.pr.changed_files = 1;
  const result = await publishEvidence(state.client, state.context);
  assert.match(result.body, /Filter the item collection/);
  assert.match(result.body, /Dismiss and restore the notice/);
});

test('current fork identity is bound even when the run PR association is empty', async () => {
  const state = fixture();
  const fork = { id: 202, full_name: 'synthetic-contributor/toy-demo' };
  state.run.head_repository = state.pr.head.repo = fork;
  state.manifest.pull_request.head_repository = fork.full_name;
  state.manifest.pull_request.head_repository_id = fork.id;
  state.repack();
  assert.equal((await publishEvidence(state.client, state.context)).action, 'create');
  state.manifest.pull_request.head_repository_id = 203;
  state.repack();
  await rejected(state, /Receipt does not match/);
});

test('source, PR, file and artifact metadata reject stale or ambiguous state', async (t) => {
  const cases = [
    ['wrong context repository', (s) => { s.context.repository = 'livstowe/other-toy'; }, /context/],
    ['different workflow', (s) => { s.run.workflow_id += 1; }, /workflow/],
    ['non-PR source', (s) => { s.run.event = 'push'; }, /state/],
    ['cancelled source', (s) => { s.run.conclusion = 'cancelled'; }, /state/],
    ['new run attempt', (s) => { s.run.run_attempt = 2; }, /attempt/],
    ['current head changed', (s) => { s.pr.head.sha = 'd'.repeat(40); }, /current PR head/],
    ['current base changed', (s) => { s.pr.base.sha = 'd'.repeat(40); }, /head\/base/],
    ['current merge changed', (s) => { s.pr.merge_commit_sha = 'd'.repeat(40); }, /merge SHA/],
    ['closed PR', (s) => { s.pr.state = 'closed'; }, /not open/],
    ['conflicting source association', (s) => { s.run.pull_requests = [{ number: 8 }]; }, /association/],
    ['multiple source PRs', (s) => { s.candidates.push(copy(s.pr)); }, /ambiguous/],
    ['missing source PR', (s) => { s.candidates = []; }, /missing/],
    ['incomplete file list', (s) => { s.pr.changed_files = 2; }, /incomplete/],
    ['unsafe renamed path', (s) => { s.files[0].previous_filename = '../ui/filter.js'; }, /Unsafe/],
    ['missing artifact', (s) => { s.catalog = { total_count: 0, artifacts: [] }; }, /missing/],
    ['ambiguous artifacts', (s) => { s.catalog.total_count = 2; }, /ambiguous/],
    ['expired artifact', (s) => { s.artifact.expired = true; }, /metadata/],
    ['foreign artifact run', (s) => { s.artifact.workflow_run.id += 1; }, /metadata/],
    ['invalid archive digest', (s) => { s.artifact.digest = `sha256:${'0'.repeat(64)}`; }, /digest/],
  ];
  for (const [name, mutate, pattern] of cases) await t.test(name, async () => {
    const state = fixture(); mutate(state); await rejected(state, pattern);
  });
});

test('fresh state is checked again after evidence and immediately before mutation', async (t) => {
  for (const read of [2, 3]) await t.test(`PR changes on read ${read}`, async () => {
    const state = fixture();
    state.beforeRead = (route, count) => {
      if (route.endsWith('/pulls/7') && count === read) state.pr.merge_commit_sha = 'd'.repeat(40);
    };
    await rejected(state, /changed|before write/);
  });
  await t.test('run attempt changes during validation', async () => {
    const state = fixture();
    state.beforeRead = (route, count) => { if (route.endsWith('/runs/401') && count === 2) state.run.run_attempt += 1; };
    await rejected(state, /attempt/);
  });
});

test('manifest requires exact scope, complete recordings and consistent outcomes', async (t) => {
  const cases = [
    ['unknown fields', (s) => { s.manifest.extra = true; }, /fields/],
    ['wrong repository', (s) => { s.manifest.repository = 'livstowe/other-toy'; }, /metadata/],
    ['stale receipt attempt', (s) => { s.manifest.run_attempt += 1; }, /metadata/],
    ['malformed PR receipt', (s) => { delete s.manifest.pull_request.head_ref; }, /receipt/],
    ['missing scenario', (s) => { s.manifest.scenarios = []; }, /coverage/],
    ['duplicate scenario', (s) => { s.manifest.scenarios.push(copy(s.manifest.scenarios[0])); }, /coverage/],
    ['false unmapped scope', (s) => { s.manifest.scope = 'unmapped'; }, /scope/],
    ['missing clip', (s) => { s.members = {}; }, /Recording/],
    ['incorrect clip size', (s) => { s.manifest.scenarios[0].video.size_bytes += 1; }, /Recording/],
    ['incorrect clip hash', (s) => { s.manifest.scenarios[0].video.sha256 = '0'.repeat(64); }, /Recording/],
    ['non-MP4 bytes', (s) => { const bytes = strToU8('not a video file at all'); s.members['videos/filter-items.mp4'] = bytes; Object.assign(s.manifest.scenarios[0].video, { size_bytes: bytes.length, sha256: hash(bytes) }); }, /MP4/],
    ['unclaimed known clip', (s) => { s.members['videos/toggle-state.mp4'] = header; }, /Unclaimed/],
    ['success with failed result', (s) => { s.manifest.scenarios[0].result = 'failed'; }, /conclusion/],
    ['failure with passed result', (s) => { s.run.conclusion = 'failure'; }, /conclusion/],
  ];
  for (const [name, mutate, pattern] of cases) await t.test(name, async () => {
    const state = fixture(); mutate(state); state.repack(); await rejected(state, pattern);
  });
});

test('duplicate bot markers, bad IDs and older run metadata cannot update comments', async (t) => {
  for (const variant of ['duplicate', 'bad-id', 'newer-run', 'newer-attempt', 'missing-metadata']) await t.test(variant, async () => {
    const state = fixture();
    const body = (await publishEvidence(state.client, state.context)).body;
    const comment = { id: 601, body, user: { login: 'github-actions[bot]', type: 'Bot' } };
    if (variant === 'bad-id') comment.id = '../7';
    if (variant === 'newer-run') comment.body = body.replace('run=401', 'run=402');
    if (variant === 'newer-attempt') comment.body = body.replace('attempt=1', 'attempt=2');
    if (variant === 'missing-metadata') comment.body = `${COMMENT_TAG}\nNo run metadata.`;
    state.comments = variant === 'duplicate' ? [comment, copy(comment)] : [comment];
    await rejected(state, /Multiple|ID|Older|metadata/);
  });
});

test('ZIP parsing rejects unexpected, oversized, malformed and duplicate members', () => {
  assert.throws(() => openEvidence(zipSync({ '../manifest.json': strToU8('{}') })), /Unexpected ZIP path/);
  assert.throws(() => openEvidence(zipSync({ 'manifest.json': strToU8('{') })), /JSON/);
  assert.throws(() => openEvidence(zipSync({ 'manifest.json': Uint8Array.of(255) })), /UTF-8/);
  assert.throws(() => openEvidence(zipSync({ 'manifest.json': new Uint8Array(16 * 1024 + 1) })), /size limit/);
  assert.throws(() => openEvidence(Uint8Array.of(0, 1, 2)), /Malformed ZIP/);
  const duplicate = Buffer.from(zipSync({ 'manifest.json': strToU8('{}'), 'evilment.json': strToU8('{}') }));
  let position = duplicate.indexOf('evilment.json');
  while (position !== -1) {
    duplicate.write('manifest.json', position);
    position = duplicate.indexOf('evilment.json', position + 13);
  }
  assert.throws(() => openEvidence(duplicate), /Duplicate/);
});

test('artifact storage receives no token and unsafe redirects are rejected', async () => {
  const calls = [];
  const client = new GitHubClient('test-token', async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://storage.example.test/clip?signature=toy' } }) : new Response(header);
  });
  assert.deepEqual(await client.download(501), Buffer.from(header));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[1].options.redirect, 'error');
  const unsafe = new GitHubClient('test-token', async () => new Response(null, { status: 302, headers: { location: 'http://storage.example.test/clip' } }));
  await assert.rejects(unsafe.download(501), /Unsafe artifact address/);
  await assert.rejects(client.json('/repos/livstowe/other-toy/issues'), /Unexpected API route/);
});

test('API pagination accepts an exact bound and rejects overflow', async () => {
  let page = 0;
  const client = new GitHubClient('test-token', async () => new Response(JSON.stringify(++page === 1 ? new Array(100).fill({}) : [])));
  assert.equal((await client.list(`${prefix}/pulls`, 100)).length, 100);
  const overflow = new GitHubClient('test-token', async () => new Response(JSON.stringify(new Array(100).fill({}))));
  await assert.rejects(overflow.list(`${prefix}/pulls`, 100), /exceeds size limit/);
});
