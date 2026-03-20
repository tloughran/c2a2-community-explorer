(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.CommunityAIQueryCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STOPWORDS = new Set([
    'a', 'about', 'across', 'after', 'all', 'an', 'and', 'any', 'are', 'around', 'as', 'at',
    'be', 'because', 'between', 'both', 'by', 'can', 'communities', 'community', 'compare',
    'countries', 'country', 'do', 'emphasize', 'emphasizes', 'explore', 'find', 'focused', 'for', 'from', 'help',
    'how', 'i', 'in', 'into', 'is', 'it', 'its', 'like', 'me', 'more', 'of', 'on', 'or',
    'located', 'many', 'organization', 'organizations', 'principle', 'request', 'show', 'similar', 'state',
    'states', 'than', 'that', 'the', 'their', 'them', 'these', 'those', 'through', 'to', 'toward',
    'use', 'want', 'what',
    'which', 'whose', 'with'
  ]);

  const COUNT_HINTS = /\b(how many|count|number of|total(?: number)? of)\b/;
  const SUMMARY_HINTS = /\b(summarize|summary|explain|what did you find|what do you see|tell me about)\b/;
  const COMPARE_HINTS = /\b(compare|comparison|versus|vs\b|difference between)\b/;
  const EXTERNAL_HINTS = /\b(outside the dataset|beyond the dataset|beyond c2a2|search the web|search online|web search|internet search|outside c2a2|broaden beyond the dataset|look outside the dataset|extend beyond the dataset|external sources?)\b/;
  const AUTO_EXTEND_HINTS = /\b(if nothing fits|if no local data|if no local fit|if nothing matches|if you need to go beyond)\b/;
  const COUNT_NOISE = new Set([
    'are', 'bigger', 'count', 'counts', 'countries', 'country', 'fewer', 'greater', 'how',
    'larger', 'less', 'located', 'location', 'locations', 'many', 'number', 'smaller', 'state',
    'states', 'than', 'there', 'total'
  ]);

  const FIELD_DEFINITIONS = [
    { key: 'Community_Name', label: 'Community name', weight: 8 },
    { key: 'Type', label: 'Type', weight: 4 },
    { key: 'Subtype', label: 'Subtype', weight: 7 },
    { key: 'Country', label: 'Country', weight: 3 },
    { key: 'Source_Directory', label: 'Source directory', weight: 3 },
    { key: 'Narrative_Description', label: 'Organizing principle', weight: 12 },
    { key: 'Problem_Statement', label: 'Problem statement', weight: 9 },
    { key: 'Resource_Statement', label: 'Resource statement', weight: 8 },
    { key: 'Solution_Statement', label: 'Solution statement', weight: 9 },
    { key: 'Verification_Method', label: 'Verification method', weight: 2 },
    { key: 'Narrative_Grounding', label: 'Characterization status', weight: 2 },
    { key: 'Verified_Link_Host', label: 'Verified host', weight: 2 },
  ];

  const FIELD_FOCUS_RULES = [
    {
      pattern: /\b(organizing principle|narrative|mission|emphas(?:is|ize|izes|ized)|focus(?:ed|es)? on)\b/,
      boosts: { Narrative_Description: 4, Subtype: 1 }
    },
    {
      pattern: /\b(problem|address(?:es|ing)?|challenge|mistrust|trust)\b/,
      boosts: { Problem_Statement: 4, Solution_Statement: 2, Narrative_Description: 1 }
    },
    {
      pattern: /\b(resource|capacity|infrastructure|mentorship|peer support)\b/,
      boosts: { Resource_Statement: 4, Solution_Statement: 2 }
    },
    {
      pattern: /\b(solution|education|deliberation|support|organizing|action)\b/,
      boosts: { Solution_Statement: 4, Narrative_Description: 1 }
    },
    {
      pattern: /\b(country|geograph|global|region|located)\b/,
      boosts: { Country: 3 }
    },
    {
      pattern: /\b(source|directory|provenance|verification|grounding)\b/,
      boosts: { Source_Directory: 2, Verification_Method: 2, Narrative_Grounding: 2 }
    }
  ];

  const CONCEPT_ALIASES = {
    action: ['action', 'activism', 'mobilization'],
    civic: ['citizen', 'civic', 'democracy', 'deliberation', 'participatory'],
    'civic action': ['civic action', 'civic activism', 'citizen action'],
    deliberation: ['assembly', 'deliberation', 'dialogue', 'discussion', 'forum'],
    education: ['education', 'learning', 'teaching', 'training'],
    mentorship: ['coach', 'coaching', 'mentor', 'mentoring', 'mentorship'],
    mistrust: ['confidence', 'mistrust', 'skepticism', 'trust'],
    open: ['open', 'open science', 'shared'],
    'open standards': ['interoperability', 'open standards', 'protocol', 'standards'],
    peer: ['peer', 'peers', 'mutual aid'],
    'peer support': ['care', 'mutual aid', 'peer support', 'solidarity', 'support group'],
    standards: ['coordination', 'interoperability', 'protocol', 'standard', 'standards'],
    support: ['care', 'mutual aid', 'peer support', 'solidarity', 'support'],
    technical: ['digital', 'engineering', 'tech', 'technical', 'technology'],
    'technical mentorship': ['mentor', 'mentoring', 'technical mentorship', 'technical training'],
    youth: ['adolescent', 'student', 'teen', 'young', 'youth']
  };

  const REGION_TO_COUNTRIES = {
    europe: [
      'Austria', 'Belarus', 'Belgium', 'Bulgaria', 'Cyprus', 'Czech Republic', 'Denmark',
      'Europe', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'Ireland',
      'Italy', 'Kazakhstan', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands',
      'Norway', 'Poland', 'Portugal', 'Romania', 'Russian Federation', 'Slovakia', 'Slovenia',
      'Spain', 'Sweden', 'Switzerland', 'Turkey', 'Turkiye', 'Ukraine', 'United Kingdom'
    ],
    africa: [
      'Botswana', 'Côte d\'Ivoire', 'Egypt', 'Ghana', 'Kenya', 'Libya', 'Morocco', 'Mozambique',
      'Nigeria', 'Uganda'
    ],
    asia: [
      'China', 'Hong Kong', 'India', 'Indonesia', 'Iran', 'Iraq', 'Japan', 'Korea, Republic of',
      'Lao People\'s Democratic Republic', 'Lebanon', 'Mongolia', 'Myanmar', 'Nepal', 'Pakistan',
      'Philippines', 'Qatar', 'Saudi Arabia', 'Singapore', 'Sri Lanka', 'Taiwan, Province of China',
      'Thailand', 'United Arab Emirates', 'Uzbekistan', 'Viet Nam', 'Vietnam'
    ],
    'north america': [
      'Barbados', 'Canada', 'Costa Rica', 'Dominican Republic', 'Mexico', 'Puerto Rico',
      'Trinidad and Tobago', 'United States'
    ],
    'south america': [
      'Argentina', 'Brazil', 'Chile', 'Colombia', 'Paraguay', 'Peru'
    ],
    oceania: [
      'Australia', 'New Zealand'
    ],
    global: ['Global', 'Unspecified']
  };

  const REGION_ALIASES = {
    africa: 'africa',
    african: 'africa',
    asia: 'asia',
    asian: 'asia',
    europe: 'europe',
    european: 'europe',
    eu: 'europe',
    global: 'global',
    international: 'global',
    oceania: 'oceania',
    oceanian: 'oceania',
    worldwide: 'global',
    'north america': 'north america',
    'north american': 'north america',
    'south america': 'south america',
    'south american': 'south america',
  };

  const COUNTRY_ALIASES = {
    'cote d ivoire': 'Côte d\'Ivoire',
    'ivory coast': 'Côte d\'Ivoire',
    'south korea': 'Korea, Republic of',
    'uk': 'United Kingdom',
    'u k': 'United Kingdom',
    'united states of america': 'United States',
    'usa': 'United States',
    'uae': 'United Arab Emirates',
  };

  const COUNTRY_AREA_KM2 = {
    Argentina: 2780400,
    Australia: 7692024,
    Austria: 83879,
    Barbados: 430,
    Belarus: 207600,
    Belgium: 30528,
    Botswana: 581730,
    Brazil: 8515767,
    Bulgaria: 110879,
    Canada: 9984670,
    Chile: 756102,
    China: 9596961,
    Colombia: 1141748,
    'Costa Rica': 51100,
    'Côte d\'Ivoire': 322463,
    Cyprus: 9251,
    'Czech Republic': 78867,
    Denmark: 42952,
    'Dominican Republic': 48671,
    Egypt: 1002450,
    Finland: 338455,
    France: 551695,
    Germany: 357022,
    Ghana: 238533,
    Greece: 131957,
    'Hong Kong': 1104,
    Hungary: 93028,
    Iceland: 103000,
    India: 3287263,
    Indonesia: 1904569,
    Iran: 1648195,
    Iraq: 438317,
    Ireland: 70273,
    Italy: 301340,
    Japan: 377975,
    Kazakhstan: 2724900,
    Kenya: 580367,
    'Korea, Republic of': 100210,
    'Lao People\'s Democratic Republic': 236800,
    Latvia: 64559,
    Lebanon: 10452,
    Libya: 1759540,
    Lithuania: 65300,
    Luxembourg: 2586,
    Malta: 316,
    Mexico: 1964375,
    Mongolia: 1564116,
    Morocco: 446550,
    Mozambique: 801590,
    Myanmar: 676578,
    Nepal: 147181,
    Netherlands: 41543,
    'New Zealand': 268838,
    Nigeria: 923768,
    Norway: 385207,
    Pakistan: 881913,
    Paraguay: 406752,
    Peru: 1285216,
    Philippines: 300000,
    Poland: 312696,
    Portugal: 92212,
    'Puerto Rico': 9104,
    Qatar: 11586,
    Romania: 238397,
    'Russian Federation': 17098246,
    'Saudi Arabia': 2149690,
    Singapore: 734,
    Slovakia: 49035,
    Slovenia: 20273,
    Spain: 505990,
    'Sri Lanka': 65610,
    Sweden: 450295,
    Switzerland: 41285,
    'Taiwan, Province of China': 36193,
    Thailand: 513120,
    'Trinidad and Tobago': 5130,
    Turkey: 783562,
    Turkiye: 783562,
    Uganda: 241550,
    Ukraine: 603500,
    'United Arab Emirates': 83600,
    'United Kingdom': 243610,
    'United States': 9833517,
    Uzbekistan: 448978,
    'Viet Nam': 331212,
    Vietnam: 331212,
  };

  const AREA_REFERENCE_ALIASES = {
    texas: {
      label: 'Texas',
      areaKm2: 695662,
      kind: 'reference geography',
    },
    'state of texas': {
      label: 'Texas',
      areaKm2: 695662,
      kind: 'reference geography',
    }
  };

  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

  const normalizeForQuery = (value) => String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const uniq = (items) => Array.from(new Set(items.filter(Boolean)));
  const sortByName = (rows) => [...rows].sort((a, b) => collator.compare(String(a.Community_Name || ''), String(b.Community_Name || '')));
  const sortEntries = (entries) => [...entries].sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
  const countBy = (rows, key) => {
    const counts = new Map();
    rows.forEach((row) => {
      const value = row[key] || 'Unspecified';
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    return counts;
  };

  const containsTerm = (haystack, needle) => {
    if (!haystack || !needle) return false;
    if (needle.includes(' ')) return haystack.includes(needle);
    const padded = ` ${haystack} `;
    return padded.includes(` ${needle} `);
  };

  const formatNumber = (value) => new Intl.NumberFormat().format(value);
  const truncateText = (value, maxLength = 180) => {
    const text = String(value ?? '').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trimEnd()}...`;
  };

  const listLabels = (items, maxItems = 4) => {
    const visible = items.slice(0, maxItems);
    if (!visible.length) return '';
    if (items.length > maxItems) visible.push(`+${items.length - maxItems} more`);
    return visible.join(', ');
  };

  const formatArea = (value) => `${formatNumber(value)} km²`;

  const getFieldDefinition = (key) => FIELD_DEFINITIONS.find((field) => field.key === key) || {
    key,
    label: key,
    weight: 1,
  };

  const buildConcept = (raw, isPhrase) => {
    const normalized = normalizeForQuery(raw);
    const tokens = uniq(normalized.split(' ').filter((token) => token.length > 1 && !STOPWORDS.has(token)));
    const variants = new Set([normalized]);
    tokens.forEach((token) => variants.add(token));
    if (!isPhrase) {
      tokens.forEach((token) => {
        (CONCEPT_ALIASES[token] || []).forEach((alias) => variants.add(normalizeForQuery(alias)));
      });
    }
    (CONCEPT_ALIASES[normalized] || []).forEach((alias) => variants.add(normalizeForQuery(alias)));
    return {
      raw: raw.trim(),
      normalized,
      isPhrase,
      tokens,
      variants: Array.from(variants).filter(Boolean),
    };
  };

  const parseQuotedPhrases = (prompt) => {
    const phrases = [];
    const regex = /"([^"]+)"/g;
    let match;
    while ((match = regex.exec(prompt))) {
      const value = String(match[1] || '').trim();
      if (value) phrases.push(value);
    }
    return uniq(phrases);
  };

  const deriveAdjacentPhrases = (keywords) => {
    if (keywords.length < 2) return [];
    const phrases = [];
    for (let index = 0; index < keywords.length - 1; index += 1) {
      const phrase = `${keywords[index]} ${keywords[index + 1]}`;
      if (CONCEPT_ALIASES[phrase]) phrases.push(phrase);
    }
    return uniq(phrases.slice(0, 5));
  };

  const interpretPrompt = (prompt) => {
    const rawPrompt = String(prompt ?? '').trim();
    const normalizedPrompt = normalizeForQuery(rawPrompt);
    const keywordTokens = uniq(normalizedPrompt
      .split(' ')
      .filter((token) => token.length > 2 && !STOPWORDS.has(token)));
    const explicitPhrases = parseQuotedPhrases(rawPrompt);
    const derivedPhrases = deriveAdjacentPhrases(keywordTokens);
    const phrases = uniq(explicitPhrases.concat(derivedPhrases))
      .map((phrase) => buildConcept(phrase, true))
      .filter((phrase) => phrase.tokens.length);
    const keywords = keywordTokens
      .map((token) => buildConcept(token, false))
      .filter((concept) => concept.tokens.length);
    const fieldBoosts = {};
    FIELD_FOCUS_RULES.forEach((rule) => {
      if (rule.pattern.test(normalizedPrompt)) {
        Object.entries(rule.boosts).forEach(([fieldKey, value]) => {
          fieldBoosts[fieldKey] = (fieldBoosts[fieldKey] || 0) + value;
        });
      }
    });
    const focusFields = Object.keys(fieldBoosts)
      .map((fieldKey) => getFieldDefinition(fieldKey).label)
      .filter(Boolean);
    return {
      rawPrompt,
      normalizedPrompt,
      phrases,
      keywords,
      keywordLabels: keywords.map((keyword) => keyword.raw),
      phraseLabels: phrases.map((phrase) => phrase.raw),
      focusFields,
      fieldBoosts,
      minKeywordMatches: Math.max(1, Math.min(3, Math.ceil(keywordTokens.length / 2))),
    };
  };

  const buildRowAiIndex = (row, options = {}) => {
    const additionalGroundingDocuments = Array.isArray(options.additionalGroundingDocuments)
      ? options.additionalGroundingDocuments
      : [];
    const searchableFields = FIELD_DEFINITIONS.map((field) => ({
      ...field,
      raw: String(row[field.key] ?? ''),
      normalized: normalizeForQuery(row[field.key]),
    }));
    additionalGroundingDocuments.forEach((document, index) => {
      searchableFields.push({
        key: `grounding_document_${index + 1}`,
        label: document.label || `Grounding document ${index + 1}`,
        weight: Number(document.weight || 5),
        raw: String(document.text ?? ''),
        normalized: normalizeForQuery(document.text),
      });
    });
    return {
      searchableFields,
      fullText: searchableFields.map((field) => field.normalized).filter(Boolean).join(' '),
      groundingSources: additionalGroundingDocuments.map((document) => document.label || 'Additional grounding document'),
    };
  };

  const scoreConceptOnField = (field, concept, fieldBoost) => {
    if (!field.normalized) return null;
    const exactPhrase = containsTerm(field.normalized, concept.normalized);
    const tokenMatches = concept.tokens.filter((token) => containsTerm(field.normalized, token));
    const variantMatches = concept.isPhrase
      ? []
      : concept.variants.filter((variant) => containsTerm(field.normalized, variant));
    const matchedTerms = uniq(tokenMatches.concat(variantMatches));
    if (concept.isPhrase && !exactPhrase && tokenMatches.length !== concept.tokens.length) return null;
    if (!matchedTerms.length && !exactPhrase) return null;

    let strength = 0;
    if (exactPhrase) {
      strength = concept.isPhrase ? 3.4 : 2.4;
    } else if (concept.tokens.length > 1 && tokenMatches.length === concept.tokens.length) {
      strength = 2.2;
    } else if (tokenMatches.length >= 2) {
      strength = 1.8;
    } else if (variantMatches.length) {
      strength = 1.25;
    } else {
      strength = 1;
    }

    const effectiveWeight = field.weight + (fieldBoost || 0);
    return {
      score: Number((effectiveWeight * strength).toFixed(3)),
      evidence: {
        fieldKey: field.key,
        fieldLabel: field.label,
        matchedTerms: matchedTerms.slice(0, 4),
        snippet: truncateText(field.raw),
      }
    };
  };

  const buildMatchReason = (row, evidence) => {
    const topEvidence = evidence.slice(0, 2);
    const fields = topEvidence.map((item) => item.fieldLabel.toLowerCase()).join(' and ');
    const matchedTerms = uniq(topEvidence.flatMap((item) => item.matchedTerms)).slice(0, 4);
    const termText = matchedTerms.length ? ` for ${matchedTerms.join(', ')}` : '';
    return `${row.Community_Name} rises because its ${fields}${termText} align with the request.`;
  };

  const scoreRowAgainstInterpretation = (row, interpretation) => {
    if (!interpretation.keywords.length && !interpretation.phrases.length) return null;
    const aiIndex = row.aiIndex || buildRowAiIndex(row);
    const evidenceByField = new Map();
    const matchedKeywords = [];
    const matchedPhrases = [];
    let score = 0;

    const scoreConcepts = (concepts, matchedList) => {
      concepts.forEach((concept) => {
        let bestMatch = null;
        aiIndex.searchableFields.forEach((field) => {
          const fieldMatch = scoreConceptOnField(field, concept, interpretation.fieldBoosts[field.key] || 0);
          if (fieldMatch && (!bestMatch || fieldMatch.score > bestMatch.score)) {
            bestMatch = fieldMatch;
          }
        });
        if (!bestMatch) return;
        matchedList.push(concept.raw);
        score += bestMatch.score;
        const existing = evidenceByField.get(bestMatch.evidence.fieldKey);
        if (!existing || bestMatch.score > existing.score) {
          evidenceByField.set(bestMatch.evidence.fieldKey, {
            ...bestMatch.evidence,
            score: bestMatch.score,
          });
        }
      });
    };

    scoreConcepts(interpretation.phrases, matchedPhrases);
    scoreConcepts(interpretation.keywords, matchedKeywords);

    const keywordCount = uniq(matchedKeywords).length;
    const phraseCount = uniq(matchedPhrases).length;
    if (!phraseCount && keywordCount < interpretation.minKeywordMatches) return null;

    score += keywordCount * 2.2;
    score += phraseCount * 3.6;
    if (interpretation.focusFields.length) score += Math.min(4, interpretation.focusFields.length);

    const evidence = Array.from(evidenceByField.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ score: _score, ...item }) => item);
    if (!evidence.length) return null;

    return {
      row,
      score: Number(score.toFixed(3)),
      matchedKeywords: uniq(matchedKeywords),
      matchedPhrases: uniq(matchedPhrases),
      evidence,
      reason: buildMatchReason(row, evidence),
    };
  };

  const buildAnswerSummary = (matches, interpretation) => {
    if (!matches.length) {
      return 'No strong dataset-grounded matches surfaced for this prompt. Try broadening the request or use the keyword fallback for exact text filtering.';
    }
    const topFields = matches
      .slice(0, 5)
      .flatMap((match) => match.evidence.map((item) => item.fieldLabel))
      .reduce((counts, label) => {
        counts.set(label, (counts.get(label) || 0) + 1);
        return counts;
      }, new Map());
    const fieldSummary = Array.from(topFields.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([label]) => label.toLowerCase())
      .join(', ');
    const termSummary = uniq(interpretation.keywordLabels.concat(interpretation.phraseLabels)).slice(0, 6).join(', ');
    return `Found ${matches.length} dataset-grounded match${matches.length === 1 ? '' : 'es'} for ${termSummary || 'this request'}. The strongest evidence appears in ${fieldSummary || 'the current dataset fields'}.`;
  };

  const runDatasetQuery = (rows, prompt, options = {}) => {
    const interpretation = interpretPrompt(prompt);
    const datasetRows = Array.isArray(rows) ? rows : [];
    if (!interpretation.rawPrompt) {
      return {
        status: 'idle',
        mode: 'dataset-local',
        interpretation,
        answer: {
          summary: 'Ask a natural-language question to rank and explain matching communities from the current dataset.',
          citations: [],
        },
        matches: [],
        meta: {
          totalRows: datasetRows.length,
          inspectedRows: datasetRows.length,
          groundingSources: ['dataset'],
          futureGroundingHook: 'additionalGroundingDocuments',
        }
      };
    }

    const scored = datasetRows
      .map((row) => scoreRowAgainstInterpretation(row, interpretation))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || collator.compare(String(a.row.Community_Name || ''), String(b.row.Community_Name || '')));

    const topScore = scored.length ? scored[0].score : 0;
    const minScore = topScore ? Math.max(8, topScore * 0.28) : 0;
    const matches = scored
      .filter((match) => match.score >= minScore)
      .slice(0, Number(options.limit || 250));

    return {
      status: 'ok',
      mode: 'dataset-local',
      interpretation,
      answer: {
        summary: buildAnswerSummary(matches, interpretation),
        citations: matches.slice(0, 5).map((match) => ({
          communityId: match.row.Community_ID,
          communityName: match.row.Community_Name,
          sourceUrl: match.row.Source_Link,
          evidence: match.evidence,
        })),
      },
      matches: matches.map((match) => ({
        communityId: match.row.Community_ID,
        communityName: match.row.Community_Name,
        score: match.score,
        reason: match.reason,
        matchedKeywords: match.matchedKeywords,
        matchedPhrases: match.matchedPhrases,
        evidence: match.evidence,
      })),
      meta: {
        totalRows: datasetRows.length,
        inspectedRows: datasetRows.length,
        groundingSources: ['dataset'],
        futureGroundingHook: 'additionalGroundingDocuments',
        minScore,
      }
    };
  };

  const resolveQueryMode = (prompt, requestedMode) => {
    const normalizedPrompt = normalizeForQuery(prompt);
    if (EXTERNAL_HINTS.test(normalizedPrompt)) return 'database_plus_web';
    if (requestedMode === 'database_plus_web') return 'database_plus_web';
    return 'database_only';
  };

  const rowIsManual = (row) => Boolean(row.manualCuration || row.Source_Directory === 'Manual curation from official homepages');
  const rowIsGeoGap = (row) => Boolean(row.geoGap || row.Country === 'Global' || row.Country === 'Unspecified');

  const applyCurrentFilters = (rows, filters = {}) => {
    let filtered = Array.isArray(rows) ? [...rows] : [];
    if (Array.isArray(filters.types) && filters.types.length) {
      const allowed = new Set(filters.types);
      filtered = filtered.filter((row) => allowed.has(row.Type));
    }
    if (Array.isArray(filters.subtypes) && filters.subtypes.length) {
      const allowed = new Set(filters.subtypes);
      filtered = filtered.filter((row) => allowed.has(row.Subtype));
    }
    if (filters.country) {
      filtered = filtered.filter((row) => row.Country === filters.country);
    }
    if (filters.source) {
      filtered = filtered.filter((row) => row.Source_Directory === filters.source);
    }
    if (filters.manualOnly) {
      filtered = filtered.filter((row) => rowIsManual(row));
    }
    if (filters.geoOnly) {
      filtered = filtered.filter((row) => rowIsGeoGap(row));
    }
    if (filters.search) {
      const terms = uniq(normalizeForQuery(filters.search).split(' ').filter(Boolean));
      if (terms.length) {
        filtered = filtered.filter((row) => {
          const fullText = row.aiIndex ? row.aiIndex.fullText : buildRowAiIndex(row).fullText;
          return terms.every((term) => containsTerm(fullText, term));
        });
      }
    }
    return filtered;
  };

  const buildCountryLookup = (rows) => {
    const lookup = new Map();
    rows.forEach((row) => {
      const country = String(row.Country || '').trim();
      if (!country) return;
      lookup.set(normalizeForQuery(country), country);
    });
    Object.entries(COUNTRY_ALIASES).forEach(([alias, canonical]) => {
      lookup.set(normalizeForQuery(alias), canonical);
    });
    return lookup;
  };

  const findAreaReference = (normalizedPrompt, rows) => {
    const referenceAliases = Object.entries(AREA_REFERENCE_ALIASES)
      .sort((a, b) => b[0].length - a[0].length);
    for (const [alias, reference] of referenceAliases) {
      const normalizedAlias = normalizeForQuery(alias);
      if (containsTerm(normalizedPrompt, normalizedAlias)) {
        return {
          ...reference,
          matchedTerm: normalizedAlias,
          supported: Number.isFinite(reference.areaKm2),
        };
      }
    }

    const countryLookup = buildCountryLookup(rows || []);
    const countryEntries = Array.from(countryLookup.entries())
      .sort((a, b) => b[0].length - a[0].length);
    for (const [normalizedCountry, canonicalCountry] of countryEntries) {
      if (!containsTerm(normalizedPrompt, normalizedCountry)) continue;
      const areaKm2 = COUNTRY_AREA_KM2[canonicalCountry];
      return {
        label: canonicalCountry,
        areaKm2,
        kind: 'country',
        matchedTerm: normalizedCountry,
        supported: Number.isFinite(areaKm2),
      };
    }
    return null;
  };

  const detectAreaComparison = (prompt, rows) => {
    const normalizedPrompt = normalizeForQuery(prompt);
    let operator = '';
    let operatorLabel = '';
    if (/\b(larger|bigger|greater)\s+than\b/.test(normalizedPrompt)) {
      operator = 'gt';
      operatorLabel = 'larger than';
    } else if (/\b(smaller|less)\s+than\b/.test(normalizedPrompt)) {
      operator = 'lt';
      operatorLabel = 'smaller than';
    }
    if (!operator) {
      return {
        hasAny: false,
        supported: false,
        matchedTerms: [],
      };
    }

    const reference = findAreaReference(normalizedPrompt, rows);
    return {
      hasAny: true,
      supported: Boolean(reference && reference.supported),
      operator,
      operatorLabel,
      referenceLabel: reference ? reference.label : 'the referenced place',
      referenceAreaKm2: reference ? reference.areaKm2 : null,
      referenceKind: reference ? reference.kind : '',
      matchedTerms: uniq([reference && reference.matchedTerm, operatorLabel].filter(Boolean).map((value) => normalizeForQuery(value))),
    };
  };

  const detectGeography = (prompt, rows) => {
    const normalizedPrompt = normalizeForQuery(prompt);
    const countryLookup = buildCountryLookup(rows || []);
    const matchedCountries = [];
    const matchedRegions = [];
    const matchedTerms = [];

    countryLookup.forEach((country, normalizedCountry) => {
      if (containsTerm(normalizedPrompt, normalizedCountry)) {
        matchedCountries.push(country);
        matchedTerms.push(normalizedCountry);
      }
    });
    Object.entries(REGION_ALIASES).forEach(([alias, region]) => {
      if (containsTerm(normalizedPrompt, normalizeForQuery(alias))) {
        matchedRegions.push(region);
        matchedTerms.push(normalizeForQuery(alias));
      }
    });

    const regions = uniq(matchedRegions);
    const regionLabels = new Set(regions.map((region) => {
      if (region === 'north america') return 'North America';
      if (region === 'south america') return 'South America';
      return region.charAt(0).toUpperCase() + region.slice(1);
    }));
    const countries = uniq(matchedCountries).filter((country) => !regionLabels.has(country));
    const labels = uniq(countries.concat(regions.map((region) => {
      if (region === 'north america') return 'North America';
      if (region === 'south america') return 'South America';
      return region.charAt(0).toUpperCase() + region.slice(1);
    })));

    return {
      countries,
      regions,
      matchedTerms: uniq(matchedTerms),
      label: labels.length ? listLabels(labels, 2) : '',
      hasAny: Boolean(countries.length || regions.length),
    };
  };

  const rowMatchesGeography = (row, geography) => {
    if (!geography || !geography.hasAny) return true;
    if (geography.countries.includes(row.Country)) return true;
    return geography.regions.some((region) => (REGION_TO_COUNTRIES[region] || []).includes(row.Country));
  };

  const rowMatchesAreaComparison = (row, areaComparison) => {
    if (!areaComparison || !areaComparison.hasAny || !areaComparison.supported) return true;
    const countryArea = COUNTRY_AREA_KM2[row.Country];
    if (!Number.isFinite(countryArea)) return false;
    return areaComparison.operator === 'gt'
      ? countryArea > areaComparison.referenceAreaKm2
      : countryArea < areaComparison.referenceAreaKm2;
  };

  const buildIntent = (prompt, rows, requestedMode) => {
    const normalizedPrompt = normalizeForQuery(prompt);
    const geography = detectGeography(prompt, rows || []);
    const areaComparison = detectAreaComparison(prompt, rows || []);
    const interpretation = interpretPrompt(prompt);
    const wantsExternalSearch = EXTERNAL_HINTS.test(normalizedPrompt);
    const autoExtendIfNeeded = wantsExternalSearch || AUTO_EXTEND_HINTS.test(normalizedPrompt) || requestedMode === 'database_plus_web';
    const contentKeywords = interpretation.keywordLabels.filter((keyword) => {
      const normalizedKeyword = normalizeForQuery(keyword);
      if (COUNT_NOISE.has(normalizedKeyword)) return false;
      if (geography.matchedTerms.some((term) => containsTerm(normalizedKeyword, term) || containsTerm(term, normalizedKeyword))) return false;
      if (areaComparison.matchedTerms.some((term) => containsTerm(normalizedKeyword, term) || containsTerm(term, normalizedKeyword))) return false;
      return true;
    });

    let type = 'find';
    if (COUNT_HINTS.test(normalizedPrompt)) type = 'count';
    else if (COMPARE_HINTS.test(normalizedPrompt)) type = 'compare';
    else if (SUMMARY_HINTS.test(normalizedPrompt)) type = 'summarize';

    return {
      type,
      interpretation,
      geography,
      areaComparison,
      wantsExternalSearch,
      autoExtendIfNeeded,
      requestedMode: resolveQueryMode(prompt, requestedMode),
      contentKeywords,
    };
  };

  const buildEvidenceItems = (matches, limit) => matches.slice(0, limit).map((match) => ({
    communityId: match.communityId,
    communityName: match.communityName,
    sourceUrl: match.sourceUrl || '',
    excerpt: match.evidence && match.evidence[0] ? match.evidence[0].snippet : '',
    provenance: match.evidence && match.evidence[0] ? match.evidence[0].fieldLabel : 'Dataset row',
    evidence: match.evidence || [],
  }));

  const buildGeographyMatches = (rows, geography) => sortByName(rows).map((row) => ({
    communityId: row.Community_ID,
    communityName: row.Community_Name,
    score: 1,
    reason: geography && geography.label
      ? `${row.Community_Name} is included because its Country field falls under ${geography.label} in the current dataset.`
      : `${row.Community_Name} is included in the current filtered slice.`,
    evidence: [{
      fieldKey: 'Country',
      fieldLabel: 'Country',
      matchedTerms: geography && geography.label ? [geography.label] : [String(row.Country || '')],
      snippet: String(row.Country || 'Unspecified'),
    }],
    sourceUrl: row.Source_Link || '',
  }));

  const buildAreaComparisonMatches = (rows, areaComparison) => sortByName(rows).map((row) => ({
    communityId: row.Community_ID,
    communityName: row.Community_Name,
    score: 1,
    reason: `${row.Community_Name} is included because ${row.Country} is ${areaComparison.operatorLabel} ${areaComparison.referenceLabel} by total area.`,
    evidence: [{
      fieldKey: 'Country',
      fieldLabel: 'Country area',
      matchedTerms: [areaComparison.referenceLabel, row.Country],
      snippet: `${row.Country} (${formatArea(COUNTRY_AREA_KM2[row.Country])})`,
    }],
    sourceUrl: row.Source_Link || '',
  }));

  const buildTopBreakdown = (rows, key, maxItems) => sortEntries(Array.from(countBy(rows, key).entries()))
    .slice(0, maxItems)
    .map(([label, count]) => `${label} (${formatNumber(count)})`);

  const buildSuggestedFilters = (currentFilters, geography, rankedMatches) => {
    const topIds = rankedMatches.slice(0, 25).map((match) => match.communityId);
    const filters = {
      search: currentFilters && currentFilters.search ? currentFilters.search : '',
      types: currentFilters && Array.isArray(currentFilters.types) ? [...currentFilters.types] : [],
      subtypes: currentFilters && Array.isArray(currentFilters.subtypes) ? [...currentFilters.subtypes] : [],
      country: currentFilters && currentFilters.country ? currentFilters.country : '',
      source: currentFilters && currentFilters.source ? currentFilters.source : '',
      manualOnly: Boolean(currentFilters && currentFilters.manualOnly),
      geoOnly: Boolean(currentFilters && currentFilters.geoOnly),
    };
    if (!filters.country && geography && geography.countries.length === 1 && !geography.regions.length) {
      filters.country = geography.countries[0];
    }
    return {
      filters,
      recommendedIds: topIds,
    };
  };

  const answerAreaComparisonIntent = (baseRows, retrieval, intent, currentFilters) => {
    const scopedRows = baseRows.filter((row) => rowMatchesAreaComparison(row, intent.areaComparison));
    const unknownCountryLabels = uniq(baseRows
      .map((row) => row.Country)
      .filter((country) => country && !Number.isFinite(COUNTRY_AREA_KM2[country]) && country !== 'Global' && country !== 'Europe' && country !== 'Unspecified'));
    if (!intent.areaComparison.supported) {
      return {
        answerMarkdown: `I could not answer that locally because this static assistant does not yet have area metadata for **${intent.areaComparison.referenceLabel}**.\n\nIf you want, I can search beyond the dataset next and bring back a sourced answer.`,
        rankedMatches: [],
        evidence: [],
        suggestedFilters: currentFilters,
        recommendedIds: [],
        followUpSuggestions: [
          'Search beyond the dataset for a sourced answer.',
          'Ask the same question with a named country or region in the dataset.',
          'Narrow the question with a subtype or organizing principle.',
        ],
        shouldSearchWeb: true,
      };
    }

    const rankedMatches = retrieval.matches.length && intent.contentKeywords.length
      ? retrieval.matches.map((match) => ({
        ...match,
        sourceUrl: match.sourceUrl || '',
      }))
      : buildAreaComparisonMatches(scopedRows, intent.areaComparison);
    const resultRows = rankedMatches.length && intent.contentKeywords.length
      ? rankedMatches.map((match) => scopedRows.find((row) => row.Community_ID === match.communityId)).filter(Boolean)
      : scopedRows;
    const qualifyingCountries = uniq(resultRows.map((row) => row.Country).filter(Boolean));
    const topCountries = buildTopBreakdown(resultRows, 'Country', 4);
    const topSubtypes = buildTopBreakdown(resultRows, 'Subtype', 4);
    const answerLines = [
      `I found **${formatNumber(resultRows.length)} communities** located in dataset countries **${intent.areaComparison.operatorLabel} ${intent.areaComparison.referenceLabel}** (${formatArea(intent.areaComparison.referenceAreaKm2)}).`,
      `I answered this with the app's embedded country-area reference table, then counted only rows whose \`Country\` value maps to a larger national area.`,
    ];
    if (unknownCountryLabels.length) {
      answerLines.push(`I excluded non-country or unresolved labels such as ${listLabels(unknownCountryLabels, 3)} because they do not map cleanly to a single country area.`);
    }
    if (qualifyingCountries.length) {
      answerLines.push(`That slice covers **${formatNumber(qualifyingCountries.length)} countries** in the current dataset.`);
    }
    if (topCountries.length) {
      answerLines.push(`The strongest country labels in that slice are ${listLabels(topCountries, 4)}.`);
    }
    if (topSubtypes.length) {
      answerLines.push(`The most common subtypes there are ${listLabels(topSubtypes, 4)}.`);
    }
    answerLines.push('If you want, I can list the qualifying countries, compare that slice to a different size threshold, or search beyond the dataset.');

    const evidence = buildEvidenceItems(rankedMatches, 5);
    const suggested = buildSuggestedFilters(currentFilters, intent.geography, rankedMatches);
    return {
      answerMarkdown: answerLines.join('\n\n'),
      rankedMatches,
      evidence,
      suggestedFilters: suggested.filters,
      recommendedIds: suggested.recommendedIds,
      followUpSuggestions: [
        'List the countries that qualify for this area threshold.',
        'Compare this slice to countries smaller than the same reference.',
        'Search beyond the dataset for a sourced geographic answer.',
      ],
      shouldSearchWeb: false,
    };
  };

  const answerCountIntent = (prompt, baseRows, scopedRows, retrieval, intent, currentFilters) => {
    if (intent.areaComparison && intent.areaComparison.hasAny) {
      return answerAreaComparisonIntent(scopedRows, retrieval, intent, currentFilters);
    }
    const rankedMatches = retrieval.matches.length && intent.contentKeywords.length
      ? retrieval.matches.map((match) => ({
        ...match,
        sourceUrl: match.sourceUrl || '',
      }))
      : buildGeographyMatches(scopedRows, intent.geography);
    const resultRows = rankedMatches.length && intent.contentKeywords.length
      ? rankedMatches.map((match) => scopedRows.find((row) => row.Community_ID === match.communityId)).filter(Boolean)
      : scopedRows;
    const topCountries = buildTopBreakdown(resultRows, 'Country', 4);
    const topSubtypes = buildTopBreakdown(resultRows, 'Subtype', 4);
    const scopeLabel = intent.geography.label || 'the current filtered slice';
    const answerLines = [
      `I found **${formatNumber(resultRows.length)} communities** in **${scopeLabel}** within the current C2A2 dataset.`,
    ];
    if (intent.geography.hasAny) {
      answerLines.push(`I matched ${scopeLabel} against the dataset's \`Country\` field, including rows explicitly labeled that way and countries assigned to that region.`);
    }
    if (topCountries.length) {
      answerLines.push(`The strongest country labels in that slice are ${listLabels(topCountries, 4)}.`);
    }
    if (topSubtypes.length) {
      answerLines.push(`The most common subtypes there are ${listLabels(topSubtypes, 4)}.`);
    }
    answerLines.push(intent.autoExtendIfNeeded
      ? 'If you want broader coverage, I can try an outside-the-dataset search next.'
      : 'If you want, I can narrow this further by subtype, country, or organizing principle.');

    const evidence = buildEvidenceItems(rankedMatches, 5);
    const suggested = buildSuggestedFilters(currentFilters, intent.geography, rankedMatches);
    return {
      answerMarkdown: answerLines.join('\n\n'),
      rankedMatches,
      evidence,
      suggestedFilters: suggested.filters,
      recommendedIds: suggested.recommendedIds,
      followUpSuggestions: [
        'Compare this region against another geography.',
        'Narrow this slice by subtype or type.',
        intent.autoExtendIfNeeded ? 'Search beyond the dataset for missing communities.' : 'Ask for a summary of the strongest local matches.',
      ],
      shouldSearchWeb: !rankedMatches.length && intent.autoExtendIfNeeded,
    };
  };

  const answerFindIntent = (prompt, baseRows, scopedRows, retrieval, intent, currentFilters) => {
    const rankedMatches = retrieval.matches.map((match) => ({
      ...match,
      sourceUrl: scopedRows.find((row) => row.Community_ID === match.communityId)?.Source_Link || '',
    }));
    const evidence = buildEvidenceItems(rankedMatches, 5);
    const topNames = rankedMatches.slice(0, 3).map((match) => match.communityName);
    const answerLines = [];
    if (rankedMatches.length) {
      answerLines.push(`I found **${formatNumber(rankedMatches.length)} strong dataset matches** for your request.`);
      answerLines.push(`The leading matches are **${topNames.join(', ')}**${rankedMatches.length > 3 ? ', among others' : ''}.`);
      answerLines.push(`These results are grounded in the current dataset's organizing-principle summaries, PRS fields, subtype labels, and provenance metadata.`);
      answerLines.push(intent.autoExtendIfNeeded
        ? 'If you want broader coverage or no local fit is strong enough, I can extend beyond the dataset next.'
        : 'If you want, I can now compare these matches, count them by geography, or narrow them with another condition.');
    } else {
      answerLines.push('I did not find a strong local match in the current dataset for that request.');
      answerLines.push(intent.autoExtendIfNeeded
        ? 'Because you asked for broader coverage, the next step is to search beyond the dataset and return sourced candidates.'
        : 'I can broaden the wording, relax the constraints, or search beyond the dataset if you want me to go wider.');
    }

    const suggested = buildSuggestedFilters(currentFilters, intent.geography, rankedMatches);
    return {
      answerMarkdown: answerLines.join('\n\n'),
      rankedMatches,
      evidence,
      suggestedFilters: suggested.filters,
      recommendedIds: suggested.recommendedIds,
      followUpSuggestions: rankedMatches.length
        ? ['Compare the top matches.', 'Count these by country or subtype.', intent.autoExtendIfNeeded ? 'Search beyond the dataset for additional candidates.' : 'Add another constraint to narrow the slice.']
        : ['Rephrase the request with broader language.', 'Try a region, subtype, or type constraint.', 'Ask me to search beyond the dataset.'],
      shouldSearchWeb: !rankedMatches.length && intent.autoExtendIfNeeded,
    };
  };

  const answerQueryLocally = (rows, prompt, options = {}) => {
    const requestedMode = resolveQueryMode(prompt, options.mode);
    const baseRows = applyCurrentFilters(Array.isArray(rows) ? rows : [], options.currentFilters || {});
    const intent = buildIntent(prompt, baseRows, requestedMode);
    let scopedRows = intent.geography.hasAny ? baseRows.filter((row) => rowMatchesGeography(row, intent.geography)) : baseRows;
    if (intent.areaComparison && intent.areaComparison.hasAny && intent.areaComparison.supported) {
      scopedRows = scopedRows.filter((row) => rowMatchesAreaComparison(row, intent.areaComparison));
    }
    const retrievalRows = scopedRows.length ? scopedRows : baseRows;
    const retrievalPrompt = intent.contentKeywords.length
      ? intent.contentKeywords.join(' ')
      : intent.interpretation.phraseLabels.join(' ');
    const retrieval = runDatasetQuery(retrievalRows, retrievalPrompt || prompt, { limit: Number(options.limit || 150) });

    if (!String(prompt || '').trim()) {
      return {
        status: 'idle',
        assistantMode: 'local-dataset',
        searchScope: requestedMode,
        answerMarkdown: 'Ask a question in plain language and I will search the current dataset first, explain what I found, and suggest what to do next.',
        rankedMatches: [],
        evidence: [],
        recommendedIds: [],
        suggestedFilters: options.currentFilters || {},
        followUpSuggestions: [
          'Count a geography or subtype.',
          'Ask for communities with a shared organizing principle.',
          'Tell me to search beyond the dataset when you want wider coverage.',
        ],
        shouldSearchWeb: false,
        meta: {
          intent,
          baseRowCount: baseRows.length,
          scopedRowCount: scopedRows.length,
        }
      };
    }

    const answered = intent.type === 'count'
      ? answerCountIntent(prompt, baseRows, scopedRows, retrieval, intent, options.currentFilters || {})
      : answerFindIntent(prompt, baseRows, scopedRows, retrieval, intent, options.currentFilters || {});

    return {
      status: 'ok',
      assistantMode: 'local-dataset',
      searchScope: requestedMode,
      answerMarkdown: answered.answerMarkdown,
      rankedMatches: answered.rankedMatches,
      evidence: answered.evidence,
      recommendedIds: answered.recommendedIds,
      suggestedFilters: answered.suggestedFilters,
      followUpSuggestions: answered.followUpSuggestions,
      shouldSearchWeb: answered.shouldSearchWeb,
      localRetrieval: retrieval,
      meta: {
        intent,
        baseRowCount: baseRows.length,
        scopedRowCount: scopedRows.length,
        localMatchCount: answered.rankedMatches.length,
      }
    };
  };

  return {
    normalizeForQuery,
    interpretPrompt,
    buildRowAiIndex,
    runDatasetQuery,
    resolveQueryMode,
    applyCurrentFilters,
    detectGeography,
    buildIntent,
    answerQueryLocally,
  };
}));
