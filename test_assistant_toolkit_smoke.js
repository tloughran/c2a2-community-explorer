const assert = require('assert');
const fs = require('fs');
const path = require('path');
const AIQueryCore = require('./ai-query-core.js');
const AssistantToolkit = require('./assistant-toolkit.js');

const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'community_data.json'), 'utf8'))
  .map((row) => ({
    ...row,
    aiIndex: AIQueryCore.buildRowAiIndex(row),
  }));

const search = AssistantToolkit.searchDataset(rows, {}, {
  query: 'open standards',
  limit: 5,
});
assert.ok(search.matches.length > 0, 'Expected search_dataset to return matches.');

const count = AssistantToolkit.countDataset(rows, {}, {
  top_by: 'Country',
  top_n: 5,
});
assert.ok(count.count > 0, 'Expected count_dataset to return a positive count.');
assert.ok(count.topValues.length > 0, 'Expected count_dataset to return top grouped values.');

const geographies = AssistantToolkit.inspectGeographies(rows, {}, {
  limit: 100,
});
const capitalsStartingAF = geographies.representedCountries.filter((entry) => {
  if (!entry.capital) return false;
  const initial = entry.capital.charAt(0).toUpperCase();
  return initial >= 'A' && initial <= 'F';
});
assert.ok(capitalsStartingAF.length > 0, 'Expected represented geographies with capitals beginning A-F.');
assert.ok(capitalsStartingAF.some((entry) => entry.capital === 'Berlin'), 'Expected Berlin to be present for represented countries.');

console.log('Assistant toolkit smoke test passed.');
