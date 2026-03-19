const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildRowAiIndex, runDatasetQuery } = require('./ai-query-core.js');

const dataJs = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(dataJs, sandbox, { filename: 'data.js' });

const rows = (sandbox.window.COMMUNITY_DATA || []).map((row) => ({
  ...row,
  aiIndex: buildRowAiIndex(row),
}));

const checks = [
  'Find communities focused on youth civic action and technical mentorship.',
  'Show communities whose organizing principle emphasizes open standards.',
  'Which communities address mistrust through deliberation, education, and peer support?',
];

checks.forEach((prompt) => {
  const result = runDatasetQuery(rows, prompt, { limit: 20 });
  console.log(`${prompt}: ${result.matches.length}`);
  assert.strictEqual(result.status, 'ok');
  assert.ok(result.matches.length > 0, `Expected at least one match for prompt: ${prompt}`);
  assert.ok(result.answer.citations.length > 0, `Expected citations for prompt: ${prompt}`);
  assert.ok(result.matches[0].reason, `Expected an explanation for prompt: ${prompt}`);
  assert.ok(result.matches[0].evidence.length > 0, `Expected evidence for prompt: ${prompt}`);
});

const noMatch = runDatasetQuery(rows, 'zzzxqv impossible prompt token', { limit: 20 });
assert.strictEqual(noMatch.status, 'ok');
assert.strictEqual(noMatch.matches.length, 0);
console.log('AI query smoke test passed.');
