export const SCENARIOS = Object.freeze({
  'filter-items': { label: 'Filter the item collection', spec: 'cypress/e2e/filter-items.cy.cjs' },
  'toggle-state': { label: 'Enable and disable an item', spec: 'cypress/e2e/toggle-state.cy.cjs' },
  'dismiss-notice': { label: 'Dismiss and restore the notice', spec: 'cypress/e2e/dismiss-notice.cy.cjs' },
});

const featureFiles = { 'ui/filter.js': 'filter-items', 'ui/state.js': 'toggle-state', 'ui/notice.js': 'dismiss-notice' };
const sharedFiles = new Set(['package.json', 'package-lock.json', 'cypress.config.cjs', 'scripts/record.mjs', 'scripts/scenarios.mjs', '.github/workflows/record.yml']);

export function mapChangedFiles(files) {
  if (!Array.isArray(files) || files.length > 1000 || files.some((file) => typeof file !== 'string' || file.length < 1 || file.length > 1024 || file.startsWith('/') || file.split('/').includes('..'))) {
    throw new Error('Changed file list is invalid or too large');
  }
  const selected = new Set();
  const unmapped = [];
  for (const file of new Set(files)) {
    const feature = featureFiles[file] ?? Object.keys(SCENARIOS).find((id) => SCENARIOS[id].spec === file);
    if (feature) selected.add(feature);
    else if (file.startsWith('ui/') || sharedFiles.has(file) || file.startsWith('cypress/')) {
      Object.keys(SCENARIOS).forEach((id) => selected.add(id));
    } else unmapped.push(file);
  }
  return { scenarios: Object.keys(SCENARIOS).filter((id) => selected.has(id)), unmapped };
}
