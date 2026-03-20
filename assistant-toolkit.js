const AIQueryCore = require('./ai-query-core.js');

const COUNTRY_METADATA = {
  Argentina: { capital: 'Buenos Aires', areaKm2: 2780400 },
  Australia: { capital: 'Canberra', areaKm2: 7692024 },
  Austria: { capital: 'Vienna', areaKm2: 83879 },
  Barbados: { capital: 'Bridgetown', areaKm2: 430 },
  Belarus: { capital: 'Minsk', areaKm2: 207600 },
  Belgium: { capital: 'Brussels', areaKm2: 30528 },
  Botswana: { capital: 'Gaborone', areaKm2: 581730 },
  Brazil: { capital: 'Brasilia', areaKm2: 8515767 },
  Bulgaria: { capital: 'Sofia', areaKm2: 110879 },
  Canada: { capital: 'Ottawa', areaKm2: 9984670 },
  Chile: { capital: 'Santiago', areaKm2: 756102 },
  China: { capital: 'Beijing', areaKm2: 9596961 },
  Colombia: { capital: 'Bogota', areaKm2: 1141748 },
  'Costa Rica': { capital: 'San Jose', areaKm2: 51100 },
  'Côte d\'Ivoire': { capital: 'Yamoussoukro', areaKm2: 322463 },
  Cyprus: { capital: 'Nicosia', areaKm2: 9251 },
  'Czech Republic': { capital: 'Prague', areaKm2: 78867 },
  Denmark: { capital: 'Copenhagen', areaKm2: 42952 },
  'Dominican Republic': { capital: 'Santo Domingo', areaKm2: 48671 },
  Egypt: { capital: 'Cairo', areaKm2: 1002450 },
  Finland: { capital: 'Helsinki', areaKm2: 338455 },
  France: { capital: 'Paris', areaKm2: 551695 },
  Germany: { capital: 'Berlin', areaKm2: 357022 },
  Ghana: { capital: 'Accra', areaKm2: 238533 },
  Greece: { capital: 'Athens', areaKm2: 131957 },
  'Hong Kong': { capital: 'Hong Kong', areaKm2: 1104 },
  Hungary: { capital: 'Budapest', areaKm2: 93028 },
  Iceland: { capital: 'Reykjavik', areaKm2: 103000 },
  India: { capital: 'New Delhi', areaKm2: 3287263 },
  Indonesia: { capital: 'Jakarta', areaKm2: 1904569 },
  Iran: { capital: 'Tehran', areaKm2: 1648195 },
  Iraq: { capital: 'Baghdad', areaKm2: 438317 },
  Ireland: { capital: 'Dublin', areaKm2: 70273 },
  Italy: { capital: 'Rome', areaKm2: 301340 },
  Japan: { capital: 'Tokyo', areaKm2: 377975 },
  Kazakhstan: { capital: 'Astana', areaKm2: 2724900 },
  Kenya: { capital: 'Nairobi', areaKm2: 580367 },
  'Korea, Republic of': { capital: 'Seoul', areaKm2: 100210 },
  'Lao People\'s Democratic Republic': { capital: 'Vientiane', areaKm2: 236800 },
  Latvia: { capital: 'Riga', areaKm2: 64559 },
  Lebanon: { capital: 'Beirut', areaKm2: 10452 },
  Libya: { capital: 'Tripoli', areaKm2: 1759540 },
  Lithuania: { capital: 'Vilnius', areaKm2: 65300 },
  Luxembourg: { capital: 'Luxembourg', areaKm2: 2586 },
  Malta: { capital: 'Valletta', areaKm2: 316 },
  Mexico: { capital: 'Mexico City', areaKm2: 1964375 },
  Mongolia: { capital: 'Ulaanbaatar', areaKm2: 1564116 },
  Morocco: { capital: 'Rabat', areaKm2: 446550 },
  Mozambique: { capital: 'Maputo', areaKm2: 801590 },
  Myanmar: { capital: 'Naypyidaw', areaKm2: 676578 },
  Nepal: { capital: 'Kathmandu', areaKm2: 147181 },
  Netherlands: { capital: 'Amsterdam', areaKm2: 41543 },
  'New Zealand': { capital: 'Wellington', areaKm2: 268838 },
  Nigeria: { capital: 'Abuja', areaKm2: 923768 },
  Norway: { capital: 'Oslo', areaKm2: 385207 },
  Pakistan: { capital: 'Islamabad', areaKm2: 881913 },
  Paraguay: { capital: 'Asuncion', areaKm2: 406752 },
  Peru: { capital: 'Lima', areaKm2: 1285216 },
  Philippines: { capital: 'Manila', areaKm2: 300000 },
  Poland: { capital: 'Warsaw', areaKm2: 312696 },
  Portugal: { capital: 'Lisbon', areaKm2: 92212 },
  'Puerto Rico': { capital: 'San Juan', areaKm2: 9104 },
  Qatar: { capital: 'Doha', areaKm2: 11586 },
  Romania: { capital: 'Bucharest', areaKm2: 238397 },
  'Russian Federation': { capital: 'Moscow', areaKm2: 17098246 },
  'Saudi Arabia': { capital: 'Riyadh', areaKm2: 2149690 },
  Singapore: { capital: 'Singapore', areaKm2: 734 },
  Slovakia: { capital: 'Bratislava', areaKm2: 49035 },
  Slovenia: { capital: 'Ljubljana', areaKm2: 20273 },
  Spain: { capital: 'Madrid', areaKm2: 505990 },
  'Sri Lanka': { capital: 'Sri Jayawardenepura Kotte', areaKm2: 65610 },
  Sweden: { capital: 'Stockholm', areaKm2: 450295 },
  Switzerland: { capital: 'Bern', areaKm2: 41285 },
  'Taiwan, Province of China': { capital: 'Taipei', areaKm2: 36193 },
  Thailand: { capital: 'Bangkok', areaKm2: 513120 },
  'Trinidad and Tobago': { capital: 'Port of Spain', areaKm2: 5130 },
  Turkey: { capital: 'Ankara', areaKm2: 783562 },
  Turkiye: { capital: 'Ankara', areaKm2: 783562 },
  Uganda: { capital: 'Kampala', areaKm2: 241550 },
  Ukraine: { capital: 'Kyiv', areaKm2: 603500 },
  'United Arab Emirates': { capital: 'Abu Dhabi', areaKm2: 83600 },
  'United Kingdom': { capital: 'London', areaKm2: 243610 },
  'United States': { capital: 'Washington, D.C.', areaKm2: 9833517 },
  Uzbekistan: { capital: 'Tashkent', areaKm2: 448978 },
  'Viet Nam': { capital: 'Hanoi', areaKm2: 331212 },
  Vietnam: { capital: 'Hanoi', areaKm2: 331212 },
};

const GROUPABLE_FIELDS = new Set(['Type', 'Subtype', 'Country', 'Source_Directory', 'Verified_Link_Host']);

const formatNumber = (value) => new Intl.NumberFormat().format(value);
const uniq = (items) => Array.from(new Set(items.filter(Boolean)));

const normalizeFilters = (filters = {}) => ({
  search: String(filters.search || ''),
  types: Array.isArray(filters.types) ? filters.types : [],
  subtypes: Array.isArray(filters.subtypes) ? filters.subtypes : [],
  country: String(filters.country || ''),
  source: String(filters.source || ''),
  manualOnly: Boolean(filters.manualOnly),
  geoOnly: Boolean(filters.geoOnly),
});

const buildAppliedScope = (rows, filters) => AIQueryCore.applyCurrentFilters(rows, normalizeFilters(filters));

const buildRowSummary = (row, match) => ({
  communityId: row.Community_ID,
  communityName: row.Community_Name,
  type: row.Type,
  subtype: row.Subtype,
  country: row.Country,
  countrySource: row.Country_Source,
  sourceDirectory: row.Source_Directory,
  sourceUrl: row.Source_Link,
  verifiedUrl: row.Verified_Link,
  verifiedHost: row.Verified_Link_Host,
  emailContact: row.Email_Contact,
  emailRetrievalNote: row.Email_Retrieval_Note,
  organizingPrinciple: row.Narrative_Description,
  problemStatement: row.Problem_Statement,
  resourceStatement: row.Resource_Statement,
  solutionStatement: row.Solution_Statement,
  verificationMethod: row.Verification_Method,
  characterizationStatus: row.Narrative_Grounding,
  entryDate: row.Entry_Date || '',
  enteredBy: row.Entered_By || '',
  entryMethod: row.Entry_Method || '',
  reasoning: match && match.reason ? match.reason : '',
  evidence: match && Array.isArray(match.evidence) ? match.evidence : [],
  geography: COUNTRY_METADATA[row.Country] || null,
});

const countEntries = (rows, field, topN = 10) => {
  const counts = new Map();
  rows.forEach((row) => {
    const value = String(row[field] || 'Unspecified');
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([label, count]) => ({ label, count }));
};

const resolveQueryRows = (rows, filters, query, limit = 20) => {
  const scopedRows = buildAppliedScope(rows, filters);
  const trimmedQuery = String(query || '').trim();
  if (!trimmedQuery) {
    return {
      scopedRows,
      matchedRows: scopedRows,
      matches: scopedRows.slice(0, limit).map((row, index) => ({
        communityId: row.Community_ID,
        score: limit - index,
        reason: 'Included in the current scoped dataset view.',
        evidence: [],
      })),
      query: '',
    };
  }
  const retrieval = AIQueryCore.runDatasetQuery(scopedRows, trimmedQuery, { limit });
  const matches = Array.isArray(retrieval.matches) ? retrieval.matches : [];
  const matchMap = new Map(matches.map((match) => [match.communityId, match]));
  const matchedRows = matches
    .map((match) => scopedRows.find((row) => row.Community_ID === match.communityId))
    .filter(Boolean);
  return {
    scopedRows,
    matchedRows,
    matches: matchedRows.map((row) => matchMap.get(row.Community_ID)),
    query: trimmedQuery,
  };
};

const searchDataset = (rows, filters, args = {}) => {
  const limit = Math.max(1, Math.min(50, Number(args.limit || 12)));
  const resolved = resolveQueryRows(rows, filters, args.query || '', limit);
  return {
    tool: 'search_dataset',
    query: resolved.query,
    totalScopedRows: resolved.scopedRows.length,
    totalMatches: resolved.matchedRows.length,
    appliedFilters: normalizeFilters(filters),
    matches: resolved.matchedRows.slice(0, limit).map((row, index) => buildRowSummary(row, resolved.matches[index])),
  };
};

const countDataset = (rows, filters, args = {}) => {
  const topN = Math.max(1, Math.min(20, Number(args.top_n || 8)));
  const resolved = resolveQueryRows(rows, filters, args.query || '', Math.max(50, topN));
  const targetRows = resolved.query ? resolved.matchedRows : resolved.scopedRows;
  const distinctBy = GROUPABLE_FIELDS.has(args.distinct_by) ? args.distinct_by : '';
  const topBy = GROUPABLE_FIELDS.has(args.top_by) ? args.top_by : '';
  const distinctCount = distinctBy ? uniq(targetRows.map((row) => row[distinctBy] || 'Unspecified')).length : null;
  return {
    tool: 'count_dataset',
    query: resolved.query,
    totalScopedRows: resolved.scopedRows.length,
    count: targetRows.length,
    distinctBy,
    distinctCount,
    topBy,
    topValues: topBy ? countEntries(targetRows, topBy, topN) : [],
    appliedFilters: normalizeFilters(filters),
  };
};

const inspectGeographies = (rows, filters, args = {}) => {
  const limit = Math.max(1, Math.min(50, Number(args.limit || 20)));
  const resolved = resolveQueryRows(rows, filters, args.query || '', Math.max(100, limit));
  const targetRows = resolved.query ? resolved.matchedRows : resolved.scopedRows;
  const byCountry = new Map();
  targetRows.forEach((row) => {
    const country = String(row.Country || 'Unspecified');
    const existing = byCountry.get(country) || {
      country,
      communityCount: 0,
      sampleCommunityIds: [],
    };
    existing.communityCount += 1;
    if (existing.sampleCommunityIds.length < 5) existing.sampleCommunityIds.push(row.Community_ID);
    byCountry.set(country, existing);
  });
  const representedCountries = Array.from(byCountry.values())
    .sort((a, b) => b.communityCount - a.communityCount || a.country.localeCompare(b.country))
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      capital: COUNTRY_METADATA[entry.country] ? COUNTRY_METADATA[entry.country].capital : null,
      areaKm2: COUNTRY_METADATA[entry.country] ? COUNTRY_METADATA[entry.country].areaKm2 : null,
    }));
  return {
    tool: 'inspect_geographies',
    query: resolved.query,
    totalScopedRows: resolved.scopedRows.length,
    representedCountryCount: byCountry.size,
    appliedFilters: normalizeFilters(filters),
    representedCountries,
  };
};

const getCommunities = (rows, args = {}) => {
  const ids = Array.isArray(args.community_ids) ? args.community_ids.slice(0, 25) : [];
  const byId = new Map(rows.map((row) => [row.Community_ID, row]));
  return {
    tool: 'get_communities',
    communities: ids
      .map((communityId) => byId.get(communityId))
      .filter(Boolean)
      .map((row) => buildRowSummary(row)),
  };
};

const listTaxonomy = (rows, args = {}) => {
  const field = ['Type', 'Subtype', 'Country', 'Source_Directory'].includes(args.field) ? args.field : 'Subtype';
  const limit = Math.max(1, Math.min(250, Number(args.limit || 100)));
  const values = countEntries(rows, field, limit);
  return {
    tool: 'list_taxonomy',
    field,
    totalDistinctValues: uniq(rows.map((row) => row[field] || 'Unspecified')).length,
    values,
  };
};

const TOOL_SCHEMAS = [
  {
    type: 'function',
    name: 'search_dataset',
    description: 'Search the current C2A2 dataset for communities matching a natural-language query within the active explorer filters.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 }
      },
      required: ['query']
    }
  },
  {
    type: 'function',
    name: 'count_dataset',
    description: 'Count rows or matched communities in the current C2A2 dataset, optionally returning distinct counts or grouped breakdowns.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        distinct_by: { type: 'string', enum: ['', 'Type', 'Subtype', 'Country', 'Source_Directory', 'Verified_Link_Host'] },
        top_by: { type: 'string', enum: ['', 'Type', 'Subtype', 'Country', 'Source_Directory', 'Verified_Link_Host'] },
        top_n: { type: 'integer', minimum: 1, maximum: 20 }
      },
      required: []
    }
  },
  {
    type: 'function',
    name: 'inspect_geographies',
    description: 'List represented countries in the current dataset slice, including counts plus capital-city and area metadata when available.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 }
      },
      required: []
    }
  },
  {
    type: 'function',
    name: 'get_communities',
    description: 'Fetch fuller record details for specific community IDs already surfaced by other tools.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        community_ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 25
        }
      },
      required: ['community_ids']
    }
  },
  {
    type: 'function',
    name: 'list_taxonomy',
    description: 'List current distinct Type, Subtype, Country, or Source_Directory values in the dataset so you can reason about existing labels before answering or writing.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        field: { type: 'string', enum: ['Type', 'Subtype', 'Country', 'Source_Directory'] },
        limit: { type: 'integer', minimum: 1, maximum: 250 }
      },
      required: ['field']
    }
  }
];

const executeToolCall = (rows, filters, toolName, args) => {
  switch (toolName) {
    case 'search_dataset':
      return searchDataset(rows, filters, args);
    case 'count_dataset':
      return countDataset(rows, filters, args);
    case 'inspect_geographies':
      return inspectGeographies(rows, filters, args);
    case 'get_communities':
      return getCommunities(rows, args);
    case 'list_taxonomy':
      return listTaxonomy(rows, args);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
};

module.exports = {
  COUNTRY_METADATA,
  TOOL_SCHEMAS,
  executeToolCall,
  searchDataset,
  countDataset,
  inspectGeographies,
  getCommunities,
  listTaxonomy,
};
