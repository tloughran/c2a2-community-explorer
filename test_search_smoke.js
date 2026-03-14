const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildRowSearchIndex, parseSearchQuery, scoreRowAgainstTerms } = require('./search-core.js');

const dataJs = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(dataJs, sandbox, { filename: 'data.js' });

const data = (sandbox.window.COMMUNITY_DATA || []).map((row) => ({
  ...row,
  searchIndex: buildRowSearchIndex(row),
}));

const runQuery = (query) => {
  const terms = parseSearchQuery(query);
  const matches = data.filter((row) => scoreRowAgainstTerms(row.searchIndex, terms) >= 0);
  return matches;
};

const checks = [
  ['ietf', 1],
  ['"open science"', 1],
  ['canada innovation', 1],
  ['student think tank', 1],
  ['humanist network', 1],
];

let failed = false;
for (const [query, minExpected] of checks) {
  const matches = runQuery(query);
  const count = matches.length;
  console.log(`${query}: ${count}`);
  if (count < minExpected) {
    failed = true;
    console.error(`Expected at least ${minExpected} match(es) for query ${query}, got ${count}.`);
  }
}

if (failed) process.exit(1);
console.log('Search smoke test passed.');
