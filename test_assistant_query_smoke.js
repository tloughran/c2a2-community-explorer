const assert = require('assert');
const fs = require('fs');
const path = require('path');
const AIQueryCore = require('./ai-query-core.js');

const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'community_data.json'), 'utf8'))
  .map((row) => ({
    ...row,
    aiIndex: AIQueryCore.buildRowAiIndex(row),
  }));

const europeCount = AIQueryCore.answerQueryLocally(rows, 'How many communities are located in Europe?', {
  currentFilters: {
    search: '',
    types: [],
    subtypes: [],
    country: '',
    source: '',
    manualOnly: false,
    geoOnly: false,
  },
  mode: 'database_only',
});

assert.strictEqual(europeCount.status, 'ok');
assert.ok(/Europe/i.test(europeCount.answerMarkdown), 'Expected Europe count answer to mention Europe.');
assert.ok(!/Europe,\s*United States/i.test(europeCount.answerMarkdown), 'Did not expect Europe count answer to include United States.');
assert.ok(europeCount.rankedMatches.length > 0, 'Expected Europe count query to produce ranked matches.');
assert.ok(europeCount.followUpSuggestions.length > 0, 'Expected follow-up suggestions.');
assert.deepStrictEqual(europeCount.meta.intent.geography.regions, ['europe']);
assert.deepStrictEqual(europeCount.meta.intent.geography.countries, []);

const extended = AIQueryCore.answerQueryLocally(rows, 'If nothing local fits, search beyond the dataset for communities focused on open standards.', {
  currentFilters: {
    search: '',
    types: [],
    subtypes: [],
    country: '',
    source: '',
    manualOnly: false,
    geoOnly: false,
  },
  mode: 'database_plus_web',
});

assert.strictEqual(extended.status, 'ok');
assert.strictEqual(extended.searchScope, 'database_plus_web');
assert.ok(Array.isArray(extended.recommendedIds), 'Expected recommendedIds array.');

console.log('Assistant query smoke test passed.');
