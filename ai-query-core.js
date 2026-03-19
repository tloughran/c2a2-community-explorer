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
    'do', 'emphasize', 'emphasizes', 'explore', 'find', 'focused', 'for', 'from', 'help',
    'how', 'i', 'in', 'into', 'is', 'it', 'its', 'like', 'me', 'more', 'of', 'on', 'or',
    'organization', 'organizations', 'principle', 'request', 'show', 'similar', 'that', 'the',
    'their', 'them', 'these', 'those', 'through', 'to', 'toward', 'use', 'want', 'what',
    'which', 'whose', 'with'
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
      pattern: /\b(country|geograph|global|region)\b/,
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

  const normalizeForQuery = (value) => String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const uniq = (items) => Array.from(new Set(items.filter(Boolean)));

  const containsTerm = (haystack, needle) => {
    if (!haystack || !needle) return false;
    if (needle.includes(' ')) return haystack.includes(needle);
    const padded = ` ${haystack} `;
    return padded.includes(` ${needle} `);
  };

  const truncateText = (value, maxLength = 180) => {
    const text = String(value ?? '').trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trimEnd()}...`;
  };

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
      minKeywordMatches: Math.max(1, Math.min(3, Math.ceil(keywords.length / 2))),
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

  const scoreRowAgainstInterpretation = (row, interpretation) => {
    if (!interpretation.keywords.length && !interpretation.phrases.length) {
      return null;
    }
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
    if (!phraseCount && keywordCount < interpretation.minKeywordMatches) {
      return null;
    }

    score += keywordCount * 2.2;
    score += phraseCount * 3.6;
    if (interpretation.focusFields.length) {
      score += Math.min(4, interpretation.focusFields.length);
    }

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
      reason: buildMatchReason(row, evidence, interpretation),
    };
  };

  const buildMatchReason = (row, evidence, interpretation) => {
    const topEvidence = evidence.slice(0, 2);
    const fields = topEvidence.map((item) => item.fieldLabel.toLowerCase()).join(' and ');
    const matchedTerms = uniq(topEvidence.flatMap((item) => item.matchedTerms)).slice(0, 4);
    const termText = matchedTerms.length ? ` for ${matchedTerms.join(', ')}` : '';
    return `${row.Community_Name} rises because its ${fields}${termText} align with the request.`;
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
      .sort((a, b) => b.score - a.score || String(a.row.Community_Name).localeCompare(String(b.row.Community_Name)));

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

  return {
    normalizeForQuery,
    interpretPrompt,
    buildRowAiIndex,
    runDatasetQuery,
  };
}));
