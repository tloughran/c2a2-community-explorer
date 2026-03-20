const assert = require('assert');
const { buildAgentInput } = require('./server.js');

const input = buildAgentInput({
  prompt: 'Which ones are strongest in Europe?',
  current_filters: {
    search: '',
    types: [],
    subtypes: [],
    country: '',
    source: '',
    manualOnly: false,
    geoOnly: false,
  },
  conversation: [
    { role: 'user', text: 'How many communities are located in Europe?' },
    { role: 'assistant', text: 'I found 371 communities in Europe.' },
  ],
}, false);

assert.strictEqual(input[0].role, 'system');
assert.strictEqual(input[0].content[0].type, 'input_text');
assert.strictEqual(input[1].role, 'user');
assert.strictEqual(input[1].content[0].type, 'input_text');
assert.strictEqual(input[2].role, 'assistant');
assert.strictEqual(input[2].content[0].type, 'output_text');
assert.strictEqual(input[input.length - 1].role, 'user');
assert.strictEqual(input[input.length - 1].content[0].type, 'input_text');

console.log('Server payload smoke test passed.');
