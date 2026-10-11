import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const config = require('../cypress.config.cjs');

test('Cypress callbacks reset receipts and classify passed, failed and incomplete tests', async (t) => {
  mkdirSync(resolve(root, 'artifacts'), { recursive: true });
  const projectRoot = mkdtempSync(resolve(root, 'artifacts/callback-test-'));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const handlers = {};
  await config.e2e.setupNodeEvents((event, handler) => { handlers[event] = handler; }, { projectRoot });
  const spec = { relative: 'cypress/e2e/filter-items.cy.cjs' };
  const video = resolve(projectRoot, 'artifacts/cypress-videos/filter-items.cy.cjs.mp4');
  const receipt = () => JSON.parse(readFileSync(resolve(projectRoot, 'artifacts/results.json')));
  for (const [result, expected] of [
    [{ stats: { tests: 1, passes: 1, failures: 0 }, video }, 'passed'],
    [{ stats: { tests: 1, passes: 0, failures: 1 }, video }, 'failed'],
    [{ stats: { tests: 1, passes: 0, failures: 0, pending: 1 }, video }, 'failed'],
    [{ stats: { tests: 0, passes: 0, failures: 0 }, video }, 'failed'],
    [{ stats: { tests: 1, passes: 1, failures: 0 }, error: 'Browser error', video }, 'failed'],
    [undefined, 'failed'],
  ]) {
    handlers['before:run']();
    assert.deepEqual(receipt(), []);
    handlers['after:spec'](spec, result);
    assert.equal(receipt()[0].result, expected);
    assert.equal(receipt()[0].video, result?.video ? 'artifacts/cypress-videos/filter-items.cy.cjs.mp4' : null);
  }
  assert.throws(() => handlers['after:spec'](spec, undefined), /repeated/);
  handlers['before:run']();
  assert.throws(() => handlers['after:spec']({ relative: 'other.cy.cjs' }, undefined), /Unknown/);
});
