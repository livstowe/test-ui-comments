const fs = require('node:fs');
const path = require('node:path');

module.exports = {
  video: true,
  videoCompression: 24,
  videosFolder: 'artifacts/cypress-videos',
  screenshotsFolder: 'artifacts/screenshots',
  viewportWidth: 1180,
  viewportHeight: 760,
  retries: 0,
  e2e: {
    baseUrl: 'http://127.0.0.1:4080',
    specPattern: 'cypress/e2e/*.cy.cjs',
    supportFile: false,
    async setupNodeEvents(on, config) {
      const { SCENARIOS } = await import('./scripts/scenarios.mjs');
      const reports = [];
      const output = path.join(config.projectRoot, 'artifacts/results.json');
      const save = () => fs.writeFileSync(output, `${JSON.stringify(reports, null, 2)}\n`);
      on('before:run', () => {
        reports.length = 0;
        fs.mkdirSync(path.dirname(output), { recursive: true });
        save();
      });
      on('after:spec', (spec, result) => {
        const id = Object.keys(SCENARIOS).find((candidate) => SCENARIOS[candidate].spec === spec.relative.replaceAll(path.sep, '/'));
        if (!id || reports.some((report) => report.id === id)) throw new Error('Unknown or repeated recording spec');
        const stats = result?.stats;
        const passed = stats?.tests > 0 && stats.passes === stats.tests && stats.failures === 0 && !result.error;
        reports.push({ id, result: passed ? 'passed' : 'failed', video: result?.video ? path.relative(config.projectRoot, result.video).replaceAll(path.sep, '/') : null });
        save();
      });
    },
  },
};
