const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const AIQueryCore = require('./ai-query-core.js');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';
const ROOT_DIR = __dirname;
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

const buildLocalContext = (localResponse) => {
  const topMatches = localResponse.rankedMatches
    .slice(0, 12)
    .map((match) => {
      const row = communityById.get(match.communityId);
      if (!row) return null;
      return {
        communityId: match.communityId,
        communityName: match.communityName,
        score: match.score,
        type: row.Type,
        subtype: row.Subtype,
        country: row.Country,
        sourceUrl: row.Source_Link,
        reason: match.reason,
        evidence: match.evidence,
        narrative: row.Narrative_Description,
        problem: row.Problem_Statement,
        resource: row.Resource_Statement,
        solution: row.Solution_Statement,
      };
    })
    .filter(Boolean);

  return {
    assistantMode: localResponse.assistantMode,
    answerMarkdown: localResponse.answerMarkdown,
    suggestedFilters: localResponse.suggestedFilters,
    recommendedIds: localResponse.recommendedIds,
    followUpSuggestions: localResponse.followUpSuggestions,
    shouldSearchWeb: localResponse.shouldSearchWeb,
    meta: localResponse.meta,
    topMatches,
  };
};

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

const callOpenAI = async (requestPayload, localResponse) => {
  if (!OPENAI_API_KEY) {
    return {
      ...localResponse,
      assistantMode: 'local-dataset',
      transport: 'local-only',
    };
  }

  const useWebSearch = requestPayload.mode === 'database_plus_web'
    && (localResponse.shouldSearchWeb || AIQueryCore.buildIntent(requestPayload.prompt, communityRows, requestPayload.mode).wantsExternalSearch);

  const conversation = normalizeConversation(requestPayload.conversation);
  const localContext = buildLocalContext(localResponse);
  const inputText = [
    'You are the C2A2 Community Explorer assistant.',
    'Answer in plain English.',
    'Use the local dataset first.',
    'Only use web search when the request explicitly asks to extend beyond the dataset or local fit is weak.',
    'Do not invent dataset rows or IDs.',
    '',
    `Current prompt: ${requestPayload.prompt}`,
    '',
    `Current filters: ${JSON.stringify(requestPayload.current_filters || {}, null, 2)}`,
    '',
    `Recent conversation: ${JSON.stringify(conversation, null, 2)}`,
    '',
    `Local retrieval context: ${JSON.stringify(localContext, null, 2)}`,
    '',
    'Return JSON only.',
    'recommendedIds must be chosen from the local dataset topMatches only.',
    'If you use external web search, summarize those findings in externalFindings and keep them separate from recommendedIds.',
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      reasoning: { effort: 'medium' },
      tools: useWebSearch ? [{ type: 'web_search_preview' }] : [],
      input: inputText,
      text: {
        format: {
          type: 'json_schema',
          name: 'community_assistant_response',
          strict: true,
          schema: llmResponseSchema,
        }
      }
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json();
  const rawText = extractResponseText(payload);
  const parsed = JSON.parse(rawText);
  const recommendedIds = Array.isArray(parsed.recommendedIds)
    ? parsed.recommendedIds.filter((communityId) => communityById.has(communityId))
    : [];
  const rankedMatches = recommendedIds
    .map((communityId) => localResponse.rankedMatches.find((match) => match.communityId === communityId))
    .filter(Boolean);

  return {
    ...localResponse,
    assistantMode: useWebSearch ? 'server-llm-dataset-plus-web' : 'server-llm-dataset',
    transport: 'openai-responses',
    searchScope: useWebSearch ? 'database_plus_web' : 'database_only',
    answerMarkdown: parsed.answerMarkdown || localResponse.answerMarkdown,
    followUpSuggestions: Array.isArray(parsed.followUpSuggestions) && parsed.followUpSuggestions.length
      ? parsed.followUpSuggestions
      : localResponse.followUpSuggestions,
    recommendedIds: recommendedIds.length ? recommendedIds : localResponse.recommendedIds,
    rankedMatches: rankedMatches.length ? rankedMatches : localResponse.rankedMatches,
    externalFindings: Array.isArray(parsed.externalFindings) ? parsed.externalFindings : [],
    evidence: localResponse.evidence.length ? localResponse.evidence : buildEvidenceFromIds(recommendedIds),
  };
};

const handleApiQuery = async (req, res) => {
  try {
    const requestPayload = await parseRequestBody(req);
    const localResponse = AIQueryCore.answerQueryLocally(communityRows, requestPayload.prompt || '', {
      currentFilters: requestPayload.current_filters || {},
      mode: requestPayload.mode || 'database_only',
      limit: 150,
    });
    try {
      const responsePayload = await callOpenAI(requestPayload, localResponse);
      sendJson(res, 200, responsePayload);
    } catch (error) {
      sendJson(res, 200, {
        ...localResponse,
        warning: error.message,
        transport: 'local-fallback',
      });
    }
  } catch (error) {
    sendJson(res, 400, {
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
