(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.CommunitySearchCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const EMPTY_TERMS = [];

  const normalizeForSearch = (value) => String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parseSearchQuery = (query) => {
    const text = String(query ?? '').trim();
    if (!text) return EMPTY_TERMS;
    const terms = [];
    const regex = /"([^"]+)"|(\S+)/g;
    let match;
    while ((match = regex.exec(text))) {
      const raw = (match[1] || match[2] || '').trim();
      const normalized = normalizeForSearch(raw);
      if (!normalized) continue;
      if (!terms.some((term) => term.normalized === normalized)) {
        terms.push({ raw, normalized, isPhrase: Boolean(match[1]) });
      }
    }
    return terms;
  };

  const buildRowSearchIndex = (row) => {
    const fields = {
      name: normalizeForSearch(row.Community_Name),
      type: normalizeForSearch(row.Type),
      subtype: normalizeForSearch(row.Subtype),
      country: normalizeForSearch(row.Country),
      host: normalizeForSearch(row.Verified_Link_Host || row.Verified_Link),
      verifiedUrl: normalizeForSearch(row.Verified_Link),
      email: normalizeForSearch(row.Email_Contact),
      narrative: normalizeForSearch(row.Narrative_Description),
      problem: normalizeForSearch(row.Problem_Statement),
      resource: normalizeForSearch(row.Resource_Statement),
      solution: normalizeForSearch(row.Solution_Statement),
      source: normalizeForSearch(row.Source_Directory),
      verification: normalizeForSearch(row.Verification_Method),
      grounding: normalizeForSearch(row.Narrative_Grounding),
    };
    const fullText = Object.values(fields).filter(Boolean).join(' ');
    return { fields, fullText };
  };

  const weightedFieldMatches = [
    ['name', 14],
    ['subtype', 10],
    ['type', 8],
    ['country', 6],
    ['host', 6],
    ['source', 4],
    ['verification', 3],
    ['grounding', 2],
    ['narrative', 4],
    ['problem', 4],
    ['resource', 4],
    ['solution', 4],
    ['verifiedUrl', 2],
    ['email', 2],
  ];

  const scoreRowAgainstTerms = (searchIndex, terms) => {
    if (!terms || !terms.length) return 0;
    const { fullText, fields } = searchIndex;
    let score = 0;
    for (const term of terms) {
      const needle = term.normalized;
      if (!fullText.includes(needle)) return -1;
      let termScore = 1;
      for (const [field, weight] of weightedFieldMatches) {
        if (fields[field] && fields[field].includes(needle)) {
          termScore += weight;
        }
      }
      score += termScore;
    }
    return score;
  };

  return {
    normalizeForSearch,
    parseSearchQuery,
    buildRowSearchIndex,
    scoreRowAgainstTerms,
  };
}));
