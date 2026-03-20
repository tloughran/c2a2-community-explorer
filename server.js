const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const AIQueryCore = require('./ai-query-core.js');
const AssistantToolkit = require('./assistant-toolkit.js');

const ROOT_DIR = __dirname;
const loadDotEnv = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const separator = normalized.indexOf('=');
    if (separator <= 0) return;
    const key = normalized.slice(0, separator).trim();
    if (!key || process.env[key]) return;
    let value = normalized.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
};

loadDotEnv(path.join(ROOT_DIR, '.env'));

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';
const PUBLIC_FILES = new Set([
  '.html', '.css', '.js', '.json', '.md', '.ico', '.txt'
]);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const communityRows = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'community_data.json'), 'utf8'))
  .map((row) => ({
    ...row,
    aiIndex: AIQueryCore.buildRowAiIndex(row),
  }));

const communityById = new Map(communityRows.map((row) => [row.Community_ID, row]));

const llmResponseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answerMarkdown: { type: 'string' },
    recommendedIds: {
      type: 'array',
      items: { type: 'string' }
    },
    followUpSuggestions: {
      type: 'array',
      items: { type: 'string' }
    },
    externalFindings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          note: { type: 'string' }
        },
        required: ['title', 'url', 'note']
      }
    }
  },
  required: ['answerMarkdown', 'recommendedIds', 'followUpSuggestions', 'externalFindings']
};

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload, null, 2));
};

const sendText = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
};

const parseRequestBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1_000_000) {
      reject(new Error('Request body too large.'));
      req.destroy();
    }
  });
  req.on('end', () => {
    try {
      resolve(body ? JSON.parse(body) : {});
    } catch (error) {
      reject(error);
    }
  });
  req.on('error', reject);
});

const normalizeConversation = (conversation) => Array.isArray(conversation)
  ? conversation
    .filter((item) => item && typeof item.role === 'string' && typeof item.text === 'string')
    .slice(-8)
  : [];

const extractResponseText = (payload) => {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (typeof part.text === 'string' && part.text.trim()) return part.text.trim();
    }
  }
  return '';
};

const extractFunctionCalls = (payload) => {
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.filter((item) => item && item.type === 'function_call' && item.call_id && item.name);
};

const parseJsonArguments = (value) => {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (error) {
    return {};
  }
};

const buildEvidenceFromIds = (ids) => ids
  .map((communityId) => communityById.get(communityId))
  .filter(Boolean)
  .slice(0, 5)
  .map((row) => ({
    communityId: row.Community_ID,
    communityName: row.Community_Name,
    sourceUrl: row.Source_Link,
    excerpt: row.Narrative_Description,
    provenance: 'Dataset row',
    evidence: [{
      fieldKey: 'Narrative_Description',
      fieldLabel: 'Organizing principle',
      matchedTerms: [],
      snippet: row.Narrative_Description,
    }],
  }));

const buildFallbackMatch = (communityId, index) => {
  const row = communityById.get(communityId);
  if (!row) return null;
  const geography = AssistantToolkit.COUNTRY_METADATA[row.Country] || null;
  return {
    communityId: row.Community_ID,
    communityName: row.Community_Name,
    score: Math.max(1, 100 - index),
    reason: geography && geography.capital
      ? `${row.Community_Name} is included in the assistant-selected dataset slice for ${row.Country} (${geography.capital}).`
      : `${row.Community_Name} is included in the assistant-selected dataset slice for this turn.`,
    evidence: [{
      fieldKey: 'Narrative_Description',
      fieldLabel: 'Organizing principle',
      matchedTerms: [row.Country].filter(Boolean),
      snippet: row.Narrative_Description || row.Country || 'Dataset row',
    }],
    sourceUrl: row.Source_Link || '',
  };
};

const buildRecommendedMatches = (recommendedIds) => {
  return recommendedIds
    .map((communityId, index) => buildFallbackMatch(communityId, index))
    .filter(Boolean);
};

const requestResponsesApi = async (payload) => {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
  }
  return response.json();
};

const buildAgentInput = (requestPayload, useWebSearch) => {
  const conversation = normalizeConversation(requestPayload.conversation);
  const filtersText = JSON.stringify(requestPayload.current_filters || {}, null, 2);
  const modeInstruction = useWebSearch
    ? 'You may use web search only after using the dataset tools first and only when the user explicitly asks to go beyond the dataset or the dataset tools are insufficient.'
    : 'Web search is not available for this turn, so you must answer from the dataset tools only and say clearly when the local dataset is insufficient.';
  const input = [
    {
      role: 'system',
      content: [{
        type: 'input_text',
        text: [
          'You are the C2A2 Community Explorer assistant.',
          'Be genuinely conversational, analytical, and helpful.',
          'Use the dataset tools first for every turn.',
          'Think of the tools as your way to inspect the dataset directly rather than relying on a canned local answer.',
          'Use `search_dataset` for topical discovery, `count_dataset` for totals and grouped counts, `inspect_geographies` for country/capital/area reasoning, and `get_communities` for richer record detail.',
          modeInstruction,
          'Do not invent communities, IDs, countries, or claims about the dataset.',
          'When you rely on outside-the-dataset information, keep it explicitly separated from dataset-grounded findings.',
          'Always return JSON that matches the provided schema.',
          'recommendedIds should be a dataset-backed slice that supports your answer. Prefer up to 25 IDs. It is acceptable to return an empty array only when no local slice genuinely supports the answer.',
          '',
          `Current explorer filters: ${filtersText}`,
        ].join('\n')
      }]
    }
  ];
  conversation.forEach((message) => {
    input.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'input_text', text: message.text }],
    });
  });
  input.push({
    role: 'user',
    content: [{ type: 'input_text', text: requestPayload.prompt || '' }],
  });
  return input;
};

const callOpenAI = async (requestPayload) => {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured for the server assistant.');
  }

  const useWebSearch = requestPayload.mode === 'database_plus_web';
  const tools = AssistantToolkit.TOOL_SCHEMAS.concat(useWebSearch ? [{ type: 'web_search_preview' }] : []);
  let payload = await requestResponsesApi({
    model: OPENAI_MODEL,
    reasoning: { effort: 'medium' },
    tools,
    input: buildAgentInput(requestPayload, useWebSearch),
    text: {
      format: {
        type: 'json_schema',
        name: 'community_assistant_response',
        strict: true,
        schema: llmResponseSchema,
      }
    }
  });

  for (let step = 0; step < 6; step += 1) {
    const functionCalls = extractFunctionCalls(payload);
    if (!functionCalls.length) break;
    const outputs = functionCalls.map((call) => {
      const args = parseJsonArguments(call.arguments);
      const result = AssistantToolkit.executeToolCall(communityRows, requestPayload.current_filters || {}, call.name, args);
      return {
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      };
    });
    payload = await requestResponsesApi({
      model: OPENAI_MODEL,
      previous_response_id: payload.id,
      tools,
      input: outputs,
      text: {
        format: {
          type: 'json_schema',
          name: 'community_assistant_response',
          strict: true,
          schema: llmResponseSchema,
        }
      }
    });
  }

  const rawText = extractResponseText(payload);
  const parsed = JSON.parse(rawText);
  const recommendedIds = Array.isArray(parsed.recommendedIds)
    ? parsed.recommendedIds.filter((communityId) => communityById.has(communityId))
    : [];
  const rankedMatches = buildRecommendedMatches(recommendedIds);

  return {
    assistantMode: useWebSearch ? 'server-llm-agent-plus-web' : 'server-llm-agent',
    transport: 'openai-responses',
    searchScope: useWebSearch ? 'database_plus_web' : 'database_only',
    answerMarkdown: parsed.answerMarkdown,
    followUpSuggestions: Array.isArray(parsed.followUpSuggestions) ? parsed.followUpSuggestions : [],
    recommendedIds,
    rankedMatches,
    externalFindings: Array.isArray(parsed.externalFindings) ? parsed.externalFindings : [],
    evidence: buildEvidenceFromIds(recommendedIds),
  };
};

const handleApiQuery = async (req, res) => {
  try {
    const requestPayload = await parseRequestBody(req);
    if (!OPENAI_API_KEY) {
      sendJson(res, 503, {
        status: 'error',
        message: 'OPENAI_API_KEY is not configured for the server assistant.',
      });
      return;
    }
    const responsePayload = await callOpenAI(requestPayload);
    sendJson(res, 200, responsePayload);
  } catch (error) {
    sendJson(res, 502, {
      status: 'error',
      message: error.message,
    });
  }
};

const serveFile = (req, res, pathname) => {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(ROOT_DIR, safePath);
  if (!filePath.startsWith(ROOT_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  const extension = path.extname(filePath).toLowerCase();
  if (!PUBLIC_FILES.has(extension)) {
    sendText(res, 404, 'Not found');
    return;
  }
  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      sendText(res, 404, 'Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=300',
    });
    res.end(buffer);
  });
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (req.method === 'POST' && url.pathname === '/api/query') {
    handleApiQuery(req, res);
    return;
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      llmEnabled: Boolean(OPENAI_API_KEY),
      model: OPENAI_MODEL,
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed');
    return;
  }
  serveFile(req, res, decodeURIComponent(url.pathname));
});

server.listen(PORT, HOST, () => {
  console.log(`C2A2 Community Explorer server running at http://${HOST}:${PORT}`);
  console.log(`LLM mode: ${OPENAI_API_KEY ? `enabled via ${OPENAI_MODEL}` : 'disabled (set OPENAI_API_KEY to enable)'}`);
});
