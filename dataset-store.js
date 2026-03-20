const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DEFAULT_ROOT_DIR = __dirname;

const createDatasetStore = (options = {}) => {
  const rootDir = options.rootDir || DEFAULT_ROOT_DIR;
  const jsonPath = options.jsonPath || path.join(rootDir, 'community_data.json');
  const jsPath = options.jsPath || path.join(rootDir, 'data.js');

  const readText = (filePath) => fs.readFileSync(filePath, 'utf8');

  const loadCurrentMeta = () => {
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(readText(jsPath), sandbox, { filename: path.basename(jsPath) });
    return sandbox.window.COMMUNITY_META || {};
  };

  const deriveHost = (value) => {
    try {
      return new URL(value).host;
    } catch (error) {
      return '';
    }
  };

  const countWords = (value) => String(value || '').trim().split(/\s+/).filter(Boolean).length;

  const normalizeForCompare = (value) => String(value || '').trim().toLowerCase();

  const nextCommunityId = (rows) => {
    const maxValue = rows.reduce((maxId, row) => {
      const numeric = Number(String(row.Community_ID || '').replace(/^C/, ''));
      return Number.isFinite(numeric) ? Math.max(maxId, numeric) : maxId;
    }, 0);
    return `C${String(maxValue + 1).padStart(4, '0')}`;
  };

  const buildMeta = (rows, previousMeta) => ({
    generated_at: new Date().toISOString().slice(0, 10),
    source_file: previousMeta.source_file || path.basename(jsonPath),
    total_records: rows.length,
    types: Array.from(new Set(rows.map((row) => row.Type).filter(Boolean))).sort(),
    subtypes: Array.from(new Set(rows.map((row) => row.Subtype).filter(Boolean))).sort(),
    countries: Array.from(new Set(rows.map((row) => row.Country).filter(Boolean))).sort(),
    source_directories: Array.from(new Set(rows.map((row) => row.Source_Directory).filter(Boolean))).sort(),
  });

  const loadRows = () => JSON.parse(readText(jsonPath));

  const findDuplicate = (rows, input) => {
    const normalizedName = normalizeForCompare(input.community_name);
    const normalizedCountry = normalizeForCompare(input.country);
    const normalizedVerifiedLink = normalizeForCompare(input.verified_link);
    const normalizedSourceLink = normalizeForCompare(input.source_link);
    const verifiedHost = deriveHost(input.verified_link || '');
    return rows.find((row) => {
      const sameNameCountry = normalizedName
        && normalizedCountry
        && normalizeForCompare(row.Community_Name) === normalizedName
        && normalizeForCompare(row.Country) === normalizedCountry;
      const sameVerifiedLink = normalizedVerifiedLink && normalizeForCompare(row.Verified_Link) === normalizedVerifiedLink;
      const sameSourceLink = normalizedSourceLink && normalizeForCompare(row.Source_Link) === normalizedSourceLink;
      const sameHost = verifiedHost && normalizeForCompare(row.Verified_Link_Host) === normalizeForCompare(verifiedHost);
      return sameNameCountry || sameVerifiedLink || sameSourceLink || sameHost;
    }) || null;
  };

  const prepareRecord = (rows, input, options = {}) => {
    const today = options.today || new Date().toISOString().slice(0, 10);
    const actor = String(options.actor || 'local-admin').trim() || 'local-admin';
    const verifiedLink = String(input.verified_link || '').trim();
    const sourceLink = String(input.source_link || verifiedLink).trim();
    const type = String(input.type || '').trim();
    const subtype = String(input.subtype || '').trim();
    const communityName = String(input.community_name || '').trim();
    const country = String(input.country || '').trim();
    const narrative = String(input.narrative_description || '').trim();
    const problem = String(input.problem_statement || '').trim();
    const resource = String(input.resource_statement || '').trim();
    const solution = String(input.solution_statement || '').trim();

    if (!type || !subtype || !communityName || !country || !verifiedLink || !sourceLink || !narrative || !problem || !resource || !solution) {
      throw new Error('New records require type, subtype, community_name, country, verified_link, source_link, narrative_description, problem_statement, resource_statement, and solution_statement.');
    }

    const duplicate = findDuplicate(rows, {
      community_name: communityName,
      country,
      verified_link: verifiedLink,
      source_link: sourceLink,
    });
    if (duplicate) {
      throw new Error(`A likely duplicate already exists in the dataset (${duplicate.Community_ID}: ${duplicate.Community_Name}).`);
    }

    return {
      Community_ID: nextCommunityId(rows),
      Type: type,
      Subtype: subtype,
      Community_Name: communityName,
      Country: country,
      Country_Source: String(input.country_source || 'official website').trim(),
      Verified_Link: verifiedLink,
      Verified_Link_Host: deriveHost(verifiedLink),
      Email_Contact: String(input.email_contact || 'none located').trim(),
      Email_Retrieval_Note: String(input.email_retrieval_note || 'No machine-readable email was captured during this rebuild.').trim(),
      Narrative_Description: narrative,
      Narrative_Word_Count: countWords(narrative),
      Problem_Statement: problem,
      Resource_Statement: resource,
      Solution_Statement: solution,
      PRS_Triplet_Count: 1,
      Source_Directory: String(input.source_directory || 'Manual curation from official homepages').trim(),
      Source_Link: sourceLink,
      Verification_Method: String(input.verification_method || `Official site reviewed and added via server-authorized LLM curation on ${today}.`).trim(),
      Narrative_Grounding: String(input.narrative_grounding || 'Website-grounded summary paraphrased from official mission/about text reviewed via server-authorized LLM curation.').trim(),
      Entry_Date: today,
      Entered_By: String(input.entered_by || actor).trim(),
      Entry_Method: String(input.entry_method || 'server-llm-write').trim(),
    };
  };

  const persistRows = (rows) => {
    const previousMeta = loadCurrentMeta();
    const nextMeta = buildMeta(rows, previousMeta);
    fs.writeFileSync(jsonPath, `${JSON.stringify(rows, null, 2)}\n`);
    const jsPayload = `window.COMMUNITY_DATA = ${JSON.stringify(rows)};\nwindow.COMMUNITY_META = ${JSON.stringify(nextMeta)};\n`;
    fs.writeFileSync(jsPath, jsPayload);
    return nextMeta;
  };

  const addRecord = (input, options = {}) => {
    const rows = loadRows();
    const record = prepareRecord(rows, input, options);
    const nextRows = rows.concat(record);
    const meta = persistRows(nextRows);
    return {
      record,
      meta,
    };
  };

  return {
    rootDir,
    jsonPath,
    jsPath,
    loadCurrentMeta,
    loadRows,
    prepareRecord,
    addRecord,
  };
};

const defaultStore = createDatasetStore();

module.exports = {
  JSON_PATH: defaultStore.jsonPath,
  JS_PATH: defaultStore.jsPath,
  createDatasetStore,
  loadRows: defaultStore.loadRows,
  prepareRecord: defaultStore.prepareRecord,
  addRecord: defaultStore.addRecord,
};
