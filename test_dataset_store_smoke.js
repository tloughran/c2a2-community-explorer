const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDatasetStore } = require('./dataset-store.js');

const fixtureRows = JSON.parse(fs.readFileSync(path.join(__dirname, 'community_data.json'), 'utf8')).slice(0, 2);
const fixtureMeta = {
  generated_at: '2026-03-20',
  source_file: 'community_data.json',
  total_records: fixtureRows.length,
  types: Array.from(new Set(fixtureRows.map((row) => row.Type))).sort(),
  subtypes: Array.from(new Set(fixtureRows.map((row) => row.Subtype))).sort(),
  countries: Array.from(new Set(fixtureRows.map((row) => row.Country))).sort(),
  source_directories: Array.from(new Set(fixtureRows.map((row) => row.Source_Directory))).sort(),
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2a2-dataset-store-'));
const jsonPath = path.join(tempDir, 'community_data.json');
const jsPath = path.join(tempDir, 'data.js');

fs.writeFileSync(jsonPath, `${JSON.stringify(fixtureRows, null, 2)}\n`);
fs.writeFileSync(jsPath, `window.COMMUNITY_DATA = ${JSON.stringify(fixtureRows)};\nwindow.COMMUNITY_META = ${JSON.stringify(fixtureMeta)};\n`);

const store = createDatasetStore({ rootDir: tempDir, jsonPath, jsPath });
const { record, meta } = store.addRecord({
  type: 'Ideological',
  subtype: 'Digital commons advocacy network',
  community_name: 'Community Broadband PDX',
  country: 'United States',
  verified_link: 'https://communitybroadbandpdx.org',
  source_link: 'https://communitybroadbandpdx.org/about',
  narrative_description: 'Community Broadband PDX organizes around public-interest broadband stewardship, neighborhood advocacy, and shared digital infrastructure planning across Portland-area communities.',
  problem_statement: 'Households and local groups often face uneven access, weak leverage over telecom policy, and limited shared capacity to advocate for community-serving broadband infrastructure.',
  resource_statement: 'The community provides a public advocacy hub, shared policy language, organizing coordination, and an official web presence that explains its campaigns and participation routes.',
  solution_statement: 'It addresses this by coordinating residents and partners around broadband policy, public education, and durable digital commons advocacy that can influence local infrastructure choices.',
}, {
  today: '2026-03-20',
  actor: 'tester',
});

assert.strictEqual(record.Community_ID, 'C0809');
assert.strictEqual(record.Verified_Link_Host, 'communitybroadbandpdx.org');
assert.strictEqual(record.Entry_Date, '2026-03-20');
assert.strictEqual(record.Entered_By, 'tester');
assert.strictEqual(record.Entry_Method, 'server-llm-write');
assert.ok(record.Narrative_Word_Count > 0);
assert.strictEqual(record.PRS_Triplet_Count, 1);
assert.strictEqual(meta.total_records, fixtureRows.length + 1);

const persistedRows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
assert.strictEqual(persistedRows.length, fixtureRows.length + 1);
assert.strictEqual(persistedRows[persistedRows.length - 1].Community_Name, 'Community Broadband PDX');
assert.strictEqual(persistedRows[persistedRows.length - 1].Entry_Date, '2026-03-20');

const persistedJs = fs.readFileSync(jsPath, 'utf8');
assert.ok(/Community Broadband PDX/.test(persistedJs), 'Expected data.js to contain the newly written record.');
assert.ok(/Entry_Date/.test(persistedJs), 'Expected data.js to contain entry metadata.');

assert.throws(() => {
  store.addRecord({
    type: 'Ideological',
    subtype: 'Digital commons advocacy network',
    community_name: 'Community Broadband PDX',
    country: 'United States',
    verified_link: 'https://communitybroadbandpdx.org',
    source_link: 'https://communitybroadbandpdx.org/about',
    narrative_description: 'Duplicate narrative',
    problem_statement: 'Duplicate problem',
    resource_statement: 'Duplicate resource',
    solution_statement: 'Duplicate solution',
  }, {
    today: '2026-03-20',
    actor: 'tester',
  });
}, /likely duplicate/i);

console.log('Dataset store smoke test passed.');
