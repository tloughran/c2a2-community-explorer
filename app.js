'use strict';

(function () {
  const SearchCore = window.CommunitySearchCore;
  const AIQueryCore = window.CommunityAIQueryCore;
  if (!SearchCore) {
    console.error('CommunitySearchCore is not available.');
    return;
  }
  const { buildRowSearchIndex, parseSearchQuery, scoreRowAgainstTerms } = SearchCore;
  const canUseAiQuery = Boolean(
    AIQueryCore &&
    AIQueryCore.answerQueryLocally &&
    AIQueryCore.runDatasetQuery &&
    AIQueryCore.buildRowAiIndex
  );

  const data = (window.COMMUNITY_DATA || []).map((row, index) => {
    const searchIndex = buildRowSearchIndex(row);
    const aiIndex = canUseAiQuery ? AIQueryCore.buildRowAiIndex(row) : null;
    return {
      ...row,
      __index: index,
      Narrative_Word_Count: Number(row.Narrative_Word_Count || 0),
      PRS_Triplet_Count: Number(row.PRS_Triplet_Count || 0),
      hasEmail: String(row.Email_Contact || '').trim().toLowerCase() !== 'none located' && String(row.Email_Contact || '').trim() !== '',
      manualCuration: row.Source_Directory === 'Manual curation from official homepages',
      geoGap: row.Country === 'Global' || row.Country === 'Unspecified',
      searchIndex,
      aiIndex,
      searchBlob: searchIndex.fullText,
    };
  });

  const meta = window.COMMUNITY_META || {};
  const dataById = new Map(data.map((row) => [row.Community_ID, row]));
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const numberFmt = new Intl.NumberFormat();
  const servedAppUrl = 'http://127.0.0.1:4173';
  const isStaticMode = window.location.protocol === 'file:';
  const staticModeMessage = `The AI assistant runs only through the local server. Open ${servedAppUrl} instead of index.html.`;
  const unavailableServerMessage = 'The LLM assistant is unavailable. Start node server.js with the working OPENAI_API_KEY-backed environment.';

  const typeOrder = ['Academic', 'Ideological', 'Corporate'];
  const countBy = (rows, key) => {
    const map = new Map();
    rows.forEach((row) => {
      const value = row[key] || 'Unspecified';
      map.set(value, (map.get(value) || 0) + 1);
    });
    return map;
  };
  const unique = (rows, key) => Array.from(new Set(rows.map((row) => row[key]).filter(Boolean)));
  const sortEntries = (entries) => entries.sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]));
  const subtypeCountsGlobal = countBy(data, 'Subtype');
  const countryCountsGlobal = countBy(data, 'Country');
  const sourceCountsGlobal = countBy(data, 'Source_Directory');
  const orderedSubtypes = sortEntries(Array.from(subtypeCountsGlobal.entries())).map(([name]) => name);
  const orderedCountries = Array.from(countryCountsGlobal.keys()).sort(collator.compare);
  const orderedSources = sortEntries(Array.from(sourceCountsGlobal.entries())).map(([name]) => name);
  const sparseSubtypesGlobal = orderedSubtypes.filter((subtype) => (subtypeCountsGlobal.get(subtype) || 0) <= 5);

  const els = {};
  const state = {
    aiQuery: '',
    aiResponse: null,
    aiStatus: isStaticMode ? 'unavailable' : 'checking',
    aiError: isStaticMode ? staticModeMessage : '',
    aiConversation: [],
    aiPending: false,
    allowExternalSearch: false,
    assistantTransport: isStaticMode ? 'server-required' : 'checking-server',
    assistantReady: false,
    search: '',
    types: new Set(),
    subtypes: new Set(),
    country: '',
    source: '',
    sort: 'name-asc',
    page: 1,
    pageSize: 25,
    manualOnly: false,
    geoOnly: false,
    selectedId: data[0] ? data[0].Community_ID : null,
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const normalizeExternalUrl = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/.*)?$/i.test(raw)) return `https://${raw}`;
    return '';
  };

  const openExternalUrl = async (value) => {
    const url = normalizeExternalUrl(value);
    if (!url) {
      showToast('No valid external URL available.');
      return;
    }
    let opened = false;
    try {
      const popup = window.open(url, '_blank', 'noopener,noreferrer');
      if (popup) {
        popup.opener = null;
        opened = true;
      }
    } catch (error) {}
    if (!opened) {
      try {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        opened = true;
      } catch (error) {}
    }
    if (!opened) {
      try {
        window.prompt('Copy this URL into a new tab:', url);
      } catch (error) {}
      showToast('Popup blocked; URL shown for manual copy.');
    }
  };

  const showToast = (message) => {
    const toast = els.toast;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('show'), 1800);
  };

  const copyText = async (text, fallbackElement) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard.');
    } catch (error) {
      if (fallbackElement) {
        fallbackElement.focus();
        fallbackElement.select();
      }
      showToast('Select and copy manually.');
    }
  };

  const downloadFile = (filename, content, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const toCsv = (rows) => {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]).filter((key) => !key.startsWith('__') && !['hasEmail', 'manualCuration', 'geoGap', 'searchBlob', 'searchIndex', 'aiIndex'].includes(key));
    const escapeCell = (value) => {
      const text = String(value ?? '');
      if (/[,"\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
      return text;
    };
    const lines = [headers.map(escapeCell).join(',')];
    rows.forEach((row) => {
      lines.push(headers.map((key) => escapeCell(row[key])).join(','));
    });
    return lines.join('\n');
  };

  const formatSearchTermsLabel = (searchTerms) => searchTerms.map((term) => term.isPhrase ? `"${term.raw}"` : term.raw).join(' + ');

  const getQueryParams = () => new URLSearchParams(window.location.search);

  const hydrateStateFromUrl = () => {
    const params = getQueryParams();
    state.aiQuery = params.get('ai') || '';
    state.allowExternalSearch = !isStaticMode && params.get('ext') === '1';
    state.search = params.get('q') || '';
    state.types = new Set((params.get('types') || '').split('|').filter(Boolean));
    state.subtypes = new Set((params.get('subtypes') || '').split('|').filter(Boolean));
    state.country = params.get('country') || '';
    state.source = params.get('source') || '';
    state.sort = params.get('sort') || 'name-asc';
    state.page = Math.max(1, Number(params.get('page') || 1));
    state.pageSize = Math.max(10, Number(params.get('size') || 25));
    state.manualOnly = params.get('manual') === '1';
    state.geoOnly = params.get('geo') === '1';
    const selected = params.get('selected');
    if (selected && data.some((row) => row.Community_ID === selected)) {
      state.selectedId = selected;
    }
  };

  const writeStateToUrl = () => {
    try {
      const url = new URL(window.location.href);
      const params = url.searchParams;
      const setParam = (key, value) => {
        if (value === '' || value === null || value === undefined || value === false) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      };
      setParam('q', state.search.trim() || '');
      setParam('ai', state.aiQuery.trim() || '');
      setParam('ext', state.allowExternalSearch ? '1' : '');
      setParam('types', state.types.size ? Array.from(state.types).join('|') : '');
      setParam('subtypes', state.subtypes.size ? Array.from(state.subtypes).join('|') : '');
      setParam('country', state.country || '');
      setParam('source', state.source || '');
      setParam('sort', state.sort !== 'name-asc' ? state.sort : '');
      setParam('page', state.page > 1 ? String(state.page) : '');
      setParam('size', state.pageSize !== 25 ? String(state.pageSize) : '');
      setParam('manual', state.manualOnly ? '1' : '');
      setParam('geo', state.geoOnly ? '1' : '');
      setParam('selected', state.selectedId || '');
      history.replaceState(null, '', url.toString());
    } catch (error) {
      // Some sandboxed HTML previews block history mutation; keep the interface usable.
    }
  };

  const resetState = () => {
    state.aiQuery = '';
    state.aiResponse = null;
    state.aiStatus = isStaticMode ? 'unavailable' : (state.assistantReady ? 'idle' : 'checking');
    state.aiError = isStaticMode ? staticModeMessage : '';
    state.aiConversation = [];
    state.aiPending = false;
    state.allowExternalSearch = false;
    state.search = '';
    state.types = new Set();
    state.subtypes = new Set();
    state.country = '';
    state.source = '';
    state.sort = 'name-asc';
    state.page = 1;
    state.pageSize = 25;
    state.manualOnly = false;
    state.geoOnly = false;
    state.selectedId = data[0] ? data[0].Community_ID : null;
    syncControls();
    update();
  };

  const syncControls = () => {
    const externalSearchDisabled = state.aiStatus === 'unavailable' || state.aiStatus === 'checking' || !state.assistantReady;
    if (els.aiQuery) els.aiQuery.value = state.aiQuery;
    if (els.allowExternalSearch) {
      els.allowExternalSearch.checked = state.allowExternalSearch;
      els.allowExternalSearch.disabled = externalSearchDisabled;
      els.allowExternalSearch.title = externalSearchDisabled
        ? (isStaticMode ? staticModeMessage : unavailableServerMessage)
        : 'Allow the assistant to extend beyond the dataset when needed.';
    }
    if (els.externalSearchNote) {
      els.externalSearchNote.textContent = isStaticMode
        ? staticModeMessage
        : state.assistantReady
          ? 'The LLM assistant is live. The checkbox allows it to widen beyond the dataset when needed.'
          : unavailableServerMessage;
    }
    if (els.aiQuery) els.aiQuery.disabled = false;
    if (els.runAiQuery) els.runAiQuery.disabled = Boolean(state.aiPending);
    els.search.value = state.search;
    els.country.value = state.country;
    els.source.value = state.source;
    els.sort.value = state.sort;
    els.pageSize.value = String(state.pageSize);
    els.manualOnly.checked = state.manualOnly;
    els.geoOnly.checked = state.geoOnly;
  };

  const buildCurrentFiltersPayload = () => ({
    search: state.search.trim(),
    types: Array.from(state.types),
    subtypes: Array.from(state.subtypes),
    country: state.country,
    source: state.source,
    manualOnly: state.manualOnly,
    geoOnly: state.geoOnly,
  });

  const addConversationMessage = (message) => {
    state.aiConversation = state.aiConversation.concat({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ...message,
    });
  };

  const clearConversation = () => {
    state.aiQuery = '';
    state.aiResponse = null;
    state.aiConversation = [];
    state.aiPending = false;
    state.aiStatus = isStaticMode ? 'unavailable' : (state.assistantReady ? 'idle' : 'checking');
    state.aiError = isStaticMode ? staticModeMessage : '';
    state.assistantTransport = isStaticMode ? 'server-required' : (state.assistantReady ? 'openai-responses' : 'checking-server');
    syncControls();
    update();
  };

  const refreshAssistantAvailability = async () => {
    if (isStaticMode) {
      state.assistantReady = false;
      state.aiStatus = 'unavailable';
      state.aiError = staticModeMessage;
      state.assistantTransport = 'server-required';
      syncControls();
      update();
      return false;
    }
    state.aiStatus = 'checking';
    state.aiError = '';
    state.assistantTransport = 'checking-server';
    syncControls();
    update();
    try {
      const response = await fetch('/health', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Health check failed with status ${response.status}.`);
      }
      const payload = await response.json();
      if (!payload.ok || !payload.llmEnabled) {
        throw new Error(unavailableServerMessage);
      }
      state.assistantReady = true;
      state.aiStatus = 'idle';
      state.aiError = '';
      state.assistantTransport = 'openai-responses';
      syncControls();
      update();
      return true;
    } catch (error) {
      state.assistantReady = false;
      state.aiStatus = 'unavailable';
      state.aiError = error && error.message ? error.message : unavailableServerMessage;
      state.assistantTransport = 'server-unavailable';
      syncControls();
      update();
      return false;
    }
  };

  const requestAssistantResponse = async (prompt) => {
    if (isStaticMode) {
      throw new Error(staticModeMessage);
    }
    const requestPayload = {
      prompt,
      conversation: state.aiConversation.map((message) => ({
        role: message.role,
        text: message.text || message.answerMarkdown || '',
      })),
      current_filters: buildCurrentFiltersPayload(),
      mode: state.allowExternalSearch ? 'database_plus_web' : 'database_only',
    };
    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload && payload.message ? payload.message : `Assistant request failed with status ${response.status}.`);
      }
      return await response.json();
    } catch (error) {
      throw error;
    }
  };

  const scrollConversationToBottom = () => {
    if (!els.aiConversation) return;
    requestAnimationFrame(() => {
      els.aiConversation.scrollTop = els.aiConversation.scrollHeight;
    });
  };

  const runAiQuery = async (value = '') => {
    const nextQuery = String(value ?? '').trim();
    state.aiQuery = nextQuery;
    state.page = 1;
    if (!nextQuery) {
      syncControls();
      update();
      return;
    }
    if (state.aiStatus === 'unavailable' || state.aiStatus === 'checking' || !state.assistantReady) {
      const becameReady = await refreshAssistantAvailability();
      if (becameReady) {
        syncControls();
        update();
      }
    }
    if (state.aiStatus === 'unavailable' || !state.assistantReady) {
      state.aiResponse = null;
      state.aiStatus = 'unavailable';
      state.aiError = isStaticMode ? staticModeMessage : unavailableServerMessage;
      addConversationMessage({
        role: 'assistant',
        text: state.aiError,
        response: {
          assistantMode: 'error',
          answerMarkdown: state.aiError,
          evidence: [],
          followUpSuggestions: isStaticMode
            ? ['Open the served app at http://127.0.0.1:4173 instead of index.html.']
            : ['Restart `node server.js` in the LLM-enabled environment and try again.'],
          rankedMatches: [],
        },
      });
      syncControls();
      update();
      scrollConversationToBottom();
      return;
    }

    addConversationMessage({ role: 'user', text: nextQuery });
    state.aiPending = true;
    state.aiStatus = 'pending';
    state.aiError = '';
    syncControls();
    update();
    scrollConversationToBottom();

    try {
      const response = await requestAssistantResponse(nextQuery);
      state.aiResponse = response;
      state.aiPending = false;
      state.aiStatus = 'ok';
      state.aiError = response.warning || '';
      state.assistantTransport = response.transport || 'openai-responses';
      if (state.sort === 'name-asc') state.sort = 'relevance';
      addConversationMessage({
        role: 'assistant',
        text: response.answerMarkdown || '',
        response,
      });
    } catch (error) {
      state.aiPending = false;
      state.aiStatus = 'unavailable';
      state.aiError = error && error.message
        ? error.message
        : unavailableServerMessage;
      addConversationMessage({
        role: 'assistant',
        text: state.aiError,
        response: {
          assistantMode: 'error',
          answerMarkdown: state.aiError,
          evidence: [],
          followUpSuggestions: ['Check that `node server.js` is running with the live OpenAI-enabled environment.'],
          rankedMatches: [],
        },
      });
    }
    syncControls();
    update();
    scrollConversationToBottom();
  };

  const getAiMatchMap = () => {
    const rankedMatches = state.aiResponse && Array.isArray(state.aiResponse.rankedMatches)
      ? state.aiResponse.rankedMatches
      : state.aiResponse && Array.isArray(state.aiResponse.matches)
        ? state.aiResponse.matches
        : [];
    if (!state.aiQuery.trim() || !rankedMatches.length) return null;
    return new Map(rankedMatches.map((match) => [match.communityId, match]));
  };

  const buildAiAnswerStatus = () => {
    if (state.aiStatus === 'checking') {
      return {
        label: 'Checking assistant',
        className: '',
      };
    }
    if (state.aiStatus === 'unavailable') {
      return {
        label: 'Assistant unavailable',
        className: 'unavailable',
      };
    }
    if (state.aiStatus === 'pending') {
      return {
        label: 'Assistant is thinking',
        className: '',
      };
    }
    if (!state.aiQuery.trim()) {
      return {
        label: 'Ready for an LLM assistant query',
        className: 'idle',
      };
    }
    return {
      label: 'LLM assistant response active',
      className: '',
    };
  };

  const sortRows = (rows, searchTerms = []) => {
    const sorted = [...rows];
    const compareText = (a, b) => collator.compare(a || '', b || '');
    const relevanceCompare = (a, b) =>
      (b.__aiScore || 0) - (a.__aiScore || 0) ||
      (b.__searchScore || 0) - (a.__searchScore || 0) ||
      compareText(a.Community_Name, b.Community_Name);
    sorted.sort((a, b) => {
      switch (state.sort) {
        case 'relevance':
          return relevanceCompare(a, b);
        case 'name-desc':
          return compareText(b.Community_Name, a.Community_Name);
        case 'type-subtype':
          return compareText(a.Type, b.Type) || compareText(a.Subtype, b.Subtype) || compareText(a.Community_Name, b.Community_Name);
        case 'country-name':
          return compareText(a.Country, b.Country) || compareText(a.Community_Name, b.Community_Name);
        case 'source-name':
          return compareText(a.Source_Directory, b.Source_Directory) || compareText(a.Community_Name, b.Community_Name);
        case 'host-name':
          return compareText(a.Verified_Link_Host, b.Verified_Link_Host) || compareText(a.Community_Name, b.Community_Name);
        default:
          return (state.aiQuery.trim() || searchTerms.length) ? relevanceCompare(a, b) : compareText(a.Community_Name, b.Community_Name);
      }
    });
    return sorted;
  };

  const getFilteredRows = () => {
    const searchTerms = parseSearchQuery(state.search);
    const aiMatches = getAiMatchMap();
    let rows = aiMatches
      ? Array.from(aiMatches.values())
        .map((match) => {
          const row = dataById.get(match.communityId);
          if (!row) return null;
          return {
            ...row,
            __aiScore: match.score,
            __aiReason: match.reason,
            __aiEvidence: match.evidence || [],
          };
        })
        .filter(Boolean)
      : data;
    if (searchTerms.length) {
      rows = rows
        .map((row) => {
          const score = scoreRowAgainstTerms(row.searchIndex, searchTerms);
          return score < 0 ? null : { ...row, __searchScore: score };
        })
        .filter(Boolean);
    }
    if (state.types.size) rows = rows.filter((row) => state.types.has(row.Type));
    if (state.subtypes.size) rows = rows.filter((row) => state.subtypes.has(row.Subtype));
    if (state.country) rows = rows.filter((row) => row.Country === state.country);
    if (state.source) rows = rows.filter((row) => row.Source_Directory === state.source);
    if (state.manualOnly) rows = rows.filter((row) => row.manualCuration);
    if (state.geoOnly) rows = rows.filter((row) => row.geoGap);
    return { rows: sortRows(rows, searchTerms), searchTerms };
  };

  const ensureSelection = (rows) => {
    if (!rows.length) {
      state.selectedId = null;
      return null;
    }
    const match = rows.find((row) => row.Community_ID === state.selectedId);
    if (match) return match;
    state.selectedId = rows[0].Community_ID;
    return rows[0];
  };

  const renderTypePills = () => {
    const counts = countBy(data, 'Type');
    els.typePills.innerHTML = typeOrder.map((type) => {
      const active = state.types.has(type) ? ' active' : '';
      return `<button class="pill${active}" data-type="${escapeHtml(type)}">${escapeHtml(type)} <span class="count">${numberFmt.format(counts.get(type) || 0)}</span></button>`;
    }).join('');
  };

  const renderSubtypePills = () => {
    els.subtypePills.innerHTML = orderedSubtypes.map((subtype) => {
      const active = state.subtypes.has(subtype) ? ' active' : '';
      return `<button class="pill${active}" data-subtype="${escapeHtml(subtype)}">${escapeHtml(subtype)} <span class="count">${numberFmt.format(subtypeCountsGlobal.get(subtype) || 0)}</span></button>`;
    }).join('');
  };

  const renderSelectOptions = () => {
    els.country.innerHTML = ['<option value="">All countries</option>']
      .concat(orderedCountries.map((country) => `<option value="${escapeHtml(country)}">${escapeHtml(country)} (${numberFmt.format(countryCountsGlobal.get(country) || 0)})</option>`))
      .join('');
    els.source.innerHTML = ['<option value="">All sources</option>']
      .concat(orderedSources.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)} (${numberFmt.format(sourceCountsGlobal.get(source) || 0)})</option>`))
      .join('');
    syncControls();
  };

  const renderMetrics = (rows) => {
    const cards = [
      {
        label: 'Communities shown',
        value: `${numberFmt.format(rows.length)} / ${numberFmt.format(data.length)}`,
        subtext: 'Current filtered slice versus the full working directory.',
      },
      {
        label: 'Types represented',
        value: `${numberFmt.format(unique(rows, 'Type').length)} / ${numberFmt.format(unique(data, 'Type').length)}`,
        subtext: 'How much of the high-level taxonomy is present in view.',
      },
      {
        label: 'Subtypes represented',
        value: `${numberFmt.format(unique(rows, 'Subtype').length)} / ${numberFmt.format(unique(data, 'Subtype').length)}`,
        subtext: 'Useful for spotting slices that collapse to a narrow organizing logic.',
      },
      {
        label: 'Countries represented',
        value: numberFmt.format(unique(rows, 'Country').length),
        subtext: 'Geographic spread after current filters are applied.',
      },
      {
        label: 'Verified hosts',
        value: numberFmt.format(unique(rows, 'Verified_Link_Host').length),
        subtext: 'Unique website hosts in the visible slice.',
      },
      {
        label: 'Public emails located',
        value: `${numberFmt.format(rows.filter((row) => row.hasEmail).length)} / ${numberFmt.format(rows.length)}`,
        subtext: 'This is a clear enrichment gap for the next iteration.',
      },
    ];
    els.metrics.innerHTML = cards.map((card) => `
      <article class="metric-card">
        <div class="metric-label">${escapeHtml(card.label)}</div>
        <div class="metric-value">${escapeHtml(card.value)}</div>
        <div class="metric-subtext">${escapeHtml(card.subtext)}</div>
      </article>
    `).join('');
  };

  const renderSearchStatus = (rows, searchTerms) => {
    if (!els.searchStatus) return;
    if (!searchTerms.length) {
      els.searchStatus.innerHTML = 'Exact-text search spans community names, type/subtype labels, geography, verified hosts, narrative descriptions, and all PRS fields. Use quotes for exact phrases.';
      return;
    }
    const label = formatSearchTermsLabel(searchTerms);
    const plural = rows.length === 1 ? 'match' : 'matches';
    els.searchStatus.innerHTML = `<strong>${numberFmt.format(rows.length)}</strong> exact-text ${plural} for <span>${escapeHtml(label)}</span>. Terms can appear in any order across the indexed fields.`;
  };

  const renderHeatmap = (rows) => {
    const counts = countBy(rows, 'Type');
    const matrix = new Map();
    rows.forEach((row) => {
      const key = `${row.Type}|||${row.Subtype}`;
      matrix.set(key, (matrix.get(key) || 0) + 1);
    });
    const rowTotals = new Map();
    const colTotals = new Map();
    orderedSubtypes.forEach((subtype) => rowTotals.set(subtype, 0));
    typeOrder.forEach((type) => colTotals.set(type, counts.get(type) || 0));
    rows.forEach((row) => {
      rowTotals.set(row.Subtype, (rowTotals.get(row.Subtype) || 0) + 1);
    });
    const maxValue = Math.max(1, ...Array.from(matrix.values()), ...Array.from(rowTotals.values()), ...Array.from(colTotals.values()));
    const rowsHtml = orderedSubtypes.map((subtype) => {
      const cells = typeOrder.map((type) => {
        const value = matrix.get(`${type}|||${subtype}`) || 0;
        const alpha = value === 0 ? 0.05 : Math.min(0.85, 0.08 + (value / maxValue) * 0.78);
        const active = state.types.size === 1 && state.subtypes.size === 1 && state.types.has(type) && state.subtypes.has(subtype) ? ' active' : '';
        return `<td><button class="heat-cell${value === 0 ? ' zero' : ''}${active}" style="--cell-alpha:${alpha.toFixed(3)}" data-heat-type="${escapeHtml(type)}" data-heat-subtype="${escapeHtml(subtype)}" title="${escapeHtml(type)} × ${escapeHtml(subtype)}: ${numberFmt.format(value)}">${value === 0 ? '0' : numberFmt.format(value)}</button></td>`;
      }).join('');
      const rowActive = state.subtypes.has(subtype) ? ' active' : '';
      return `<tr>
        <th scope="row"><button class="heatmap-row-label${rowActive}" data-row-subtype="${escapeHtml(subtype)}">${escapeHtml(subtype)}</button></th>
        ${cells}
        <td><button class="heatmap-total-label" data-row-subtype="${escapeHtml(subtype)}">${numberFmt.format(rowTotals.get(subtype) || 0)}</button></td>
      </tr>`;
    }).join('');
    const headerHtml = typeOrder.map((type) => {
      const active = state.types.has(type) ? ' active' : '';
      return `<th scope="col"><button class="heatmap-col-label${active}" data-col-type="${escapeHtml(type)}">${escapeHtml(type)}<br><span class="count">${numberFmt.format(colTotals.get(type) || 0)}</span></button></th>`;
    }).join('');
    const footerHtml = typeOrder.map((type) => `<td><button class="heatmap-total-label" data-col-type="${escapeHtml(type)}">${numberFmt.format(colTotals.get(type) || 0)}</button></td>`).join('');
    els.heatmap.innerHTML = `
      <div class="note-box">Darker cells indicate more communities in the current slice. Click any subtype label, type label, or cell to filter.</div>
      <div class="heatmap-wrap">
        <table class="heatmap-table">
          <thead>
            <tr>
              <th>Subtype</th>
              ${headerHtml}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot>
            <tr>
              <th><button class="heatmap-total-label">Total</button></th>
              ${footerHtml}
              <td><button class="heatmap-total-label">${numberFmt.format(rows.length)}</button></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  };

  const renderBarList = (container, rows, key, options = {}) => {
    const maxItems = options.maxItems || 12;
    const counts = sortEntries(Array.from(countBy(rows, key).entries())).slice(0, maxItems);
    if (!counts.length) {
      container.innerHTML = '<div class="empty-state">No values to chart for the current slice.</div>';
      return;
    }
    const maxValue = Math.max(...counts.map(([, value]) => value), 1);
    const dataAttr = options.dataAttr;
    container.innerHTML = `<div class="bar-list">${counts.map(([label, value]) => {
      const width = Math.max(4, (value / maxValue) * 100);
      return `<button class="bar-row" ${dataAttr}="${escapeHtml(label)}" title="${escapeHtml(label)}: ${numberFmt.format(value)}">
        <span class="bar-label">${escapeHtml(label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${width.toFixed(1)}%"></span></span>
        <span class="bar-value">${numberFmt.format(value)}</span>
      </button>`;
    }).join('')}</div>`;
  };

  const renderGrowthInsights = (rows) => {
    const missingEmails = rows.filter((row) => !row.hasEmail).length;
    const geoGapRows = rows.filter((row) => row.geoGap).length;
    const manualRows = rows.filter((row) => row.manualCuration).length;
    const sparseVisibleSubtypes = Array.from(new Set(rows.map((row) => row.Subtype).filter((subtype) => sparseSubtypesGlobal.includes(subtype))));
    els.growth.innerHTML = `
      <div class="insight-grid">
        <article class="insight-card">
          <h3>Contact enrichment backlog</h3>
          <p><strong>${numberFmt.format(missingEmails)}</strong> of the <strong>${numberFmt.format(rows.length)}</strong> visible communities still show <em>none located</em> for public email contact.</p>
        </article>
        <article class="insight-card">
          <h3>Geography cleanup opportunity</h3>
          <p><strong>${numberFmt.format(geoGapRows)}</strong> visible communities are currently labeled <em>Global</em> or <em>Unspecified</em>.</p>
          <div class="inline-actions"><button class="inline-button" data-preset="geo">Focus this slice</button></div>
        </article>
        <article class="insight-card">
          <h3>Sparse subtype expansion</h3>
          <p>${sparseVisibleSubtypes.length ? `Underrepresented subtype labels visible here: ${escapeHtml(sparseVisibleSubtypes.join(', '))}.` : 'No globally sparse subtypes are visible in the current slice.'}</p>
          <div class="inline-actions"><button class="inline-button" data-preset="sparse">Focus sparse subtypes</button></div>
        </article>
        <article class="insight-card">
          <h3>Manual curation slice</h3>
          <p><strong>${numberFmt.format(manualRows)}</strong> visible communities came from manual homepage curation instead of the large structured source directories.</p>
          <div class="inline-actions"><button class="inline-button" data-preset="manual">Focus manual rows</button></div>
        </article>
      </div>
    `;
  };

  const renderActiveFilters = () => {
    const chips = [];
    if (state.aiQuery.trim()) chips.push({ label: `AI query: ${state.aiQuery.trim()}`, clear: () => { state.aiQuery = ''; state.aiResponse = null; state.aiConversation = []; state.aiPending = false; state.aiStatus = isStaticMode ? 'unavailable' : (state.assistantReady ? 'idle' : 'checking'); state.aiError = isStaticMode ? staticModeMessage : ''; if (els.aiQuery) els.aiQuery.value = ''; } });
    if (state.search.trim()) chips.push({ label: `Search: ${state.search.trim()}`, clear: () => { state.search = ''; els.search.value = ''; } });
    Array.from(state.types).forEach((type) => chips.push({ label: `Type: ${type}`, clear: () => state.types.delete(type) }));
    Array.from(state.subtypes).forEach((subtype) => chips.push({ label: `Subtype: ${subtype}`, clear: () => state.subtypes.delete(subtype) }));
    if (state.country) chips.push({ label: `Country: ${state.country}`, clear: () => { state.country = ''; els.country.value = ''; } });
    if (state.source) chips.push({ label: `Source: ${state.source}`, clear: () => { state.source = ''; els.source.value = ''; } });
    if (state.manualOnly) chips.push({ label: 'Manual only', clear: () => { state.manualOnly = false; els.manualOnly.checked = false; } });
    if (state.geoOnly) chips.push({ label: 'Global / Unspecified only', clear: () => { state.geoOnly = false; els.geoOnly.checked = false; } });
    if (!chips.length) {
      els.activeFilters.innerHTML = '<span class="subtle">No active filters.</span>';
      return;
    }
    els.activeFilters.innerHTML = chips.map((chip, index) => `
      <span class="active-chip">${escapeHtml(chip.label)} <button type="button" data-clear-chip="${index}" aria-label="Remove filter">×</button></span>
    `).join('');
    els.activeFilters._clearHandlers = chips.map((chip) => chip.clear);
  };

  const renderAiPanels = () => {
    const status = buildAiAnswerStatus();
    const transportLabel = state.aiResponse && state.aiResponse.assistantMode
      ? state.aiResponse.assistantMode
      : state.aiPending
        ? 'Assistant is thinking'
        : 'Assistant ready';
    if (els.assistantModeLabel) els.assistantModeLabel.textContent = transportLabel.replace(/-/g, ' ');
    if (els.assistantTransportPill) {
      els.assistantTransportPill.textContent = state.assistantTransport === 'openai-responses'
        ? 'OpenAI Responses API'
        : state.assistantTransport === 'checking-server'
          ? 'Checking server'
          : state.assistantTransport === 'server-required'
            ? 'Server required'
            : state.assistantTransport === 'server-unavailable'
              ? 'Server unavailable'
              : state.assistantTransport;
    }

    if (state.aiStatus === 'checking') {
      els.aiQueryStatus.textContent = 'Checking whether the server-backed LLM assistant is available...';
    } else if (state.aiStatus === 'unavailable') {
      els.aiQueryStatus.textContent = state.aiError || unavailableServerMessage;
    } else if (state.aiPending) {
      els.aiQueryStatus.textContent = 'The assistant is assembling an answer in English and will update the explorer when the turn completes.';
    } else if (state.aiResponse && state.aiResponse.searchScope === 'database_plus_web') {
      els.aiQueryStatus.textContent = 'This turn is allowed to extend beyond the dataset when local fit is weak or when you asked for outside search.';
    } else if (state.assistantTransport === 'openai-responses') {
      els.aiQueryStatus.textContent = 'The server-backed assistant is reasoning over the dataset with tool access and can widen beyond it when appropriate.';
    } else {
      els.aiQueryStatus.textContent = unavailableServerMessage;
    }

    const conversation = [...state.aiConversation];
    if (state.aiPending) {
      conversation.push({
        id: 'pending',
        role: 'assistant',
        text: 'Thinking through the current dataset and deciding whether the request needs wider search...',
        response: {
          followUpSuggestions: [],
          evidence: [],
          rankedMatches: [],
        }
      });
    }

    if (!conversation.length) {
      els.aiConversation.innerHTML = `
        <div class="message-empty">Ask a question in plain language. This explorer now expects the server-backed LLM assistant to be available.</div>
      `;
      return;
    }

    els.aiConversation.innerHTML = conversation.map((message) => {
      const response = message.response || {};
      const evidence = Array.isArray(response.evidence) ? response.evidence : [];
      const followUps = Array.isArray(response.followUpSuggestions) ? response.followUpSuggestions : [];
      const externalFindings = Array.isArray(response.externalFindings) ? response.externalFindings : [];
      const tags = [];
      if (message.role === 'assistant' && response.assistantMode) tags.push({ label: response.assistantMode, className: '' });
      if (message.role === 'assistant' && response.transport) tags.push({ label: response.transport, className: '' });
      if (message.role === 'assistant' && response.warning) tags.push({ label: response.warning, className: 'warning' });
      return `
        <article class="conversation-message ${escapeHtml(message.role)}${message.id === 'pending' ? ' pending' : ''}">
          <div class="message-meta">${message.role === 'user' ? 'You' : 'Assistant'}</div>
          <div class="message-body">${escapeHtml(message.text || '')}</div>
          ${tags.length ? `<div class="message-tags">${tags.map((tag) => `<span class="message-pill${tag.className ? ` ${tag.className}` : ''}">${escapeHtml(tag.label)}</span>`).join('')}</div>` : ''}
          ${message.role === 'assistant' && evidence.length ? `
            <section class="message-section">
              <h4>Evidence</h4>
              <div class="message-list">
                ${evidence.slice(0, 4).map((item) => `
                  <div class="message-item">
                    <strong>${escapeHtml(item.communityName || item.communityId || 'Dataset evidence')}</strong>
                    <div>${escapeHtml(item.excerpt || '')}</div>
                  </div>
                `).join('')}
              </div>
            </section>
          ` : ''}
          ${message.role === 'assistant' && externalFindings.length ? `
            <section class="message-section">
              <h4>Outside-the-dataset findings</h4>
              <div class="message-list">
                ${externalFindings.map((item) => `
                  <div class="message-item">
                    <strong>${escapeHtml(item.title)}</strong>
                    <div>${escapeHtml(item.note)}</div>
                    <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a>
                  </div>
                `).join('')}
              </div>
            </section>
          ` : ''}
          ${message.role === 'assistant' && followUps.length ? `
            <section class="message-section">
              <h4>What I can do next</h4>
              <div class="message-list">
                ${followUps.map((item) => `<div class="message-item">${escapeHtml(item)}</div>`).join('')}
              </div>
            </section>
          ` : ''}
        </article>
      `;
    }).join('');
  };

  const renderResults = (rows) => {
    const totalPages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * state.pageSize;
    const pageRows = rows.slice(start, start + state.pageSize);
    const selected = ensureSelection(rows);
    els.resultsCount.textContent = state.aiQuery.trim()
      ? `${numberFmt.format(rows.length)} communities · AI ranked`
      : `${numberFmt.format(rows.length)} communities`;
    if (!pageRows.length) {
      els.resultsBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">No communities match the current filter state.</div></td></tr>';
    } else {
      els.resultsBody.innerHTML = pageRows.map((row) => {
        const selectedClass = selected && row.Community_ID === selected.Community_ID ? ' class="selected"' : '';
        const emailText = row.hasEmail ? row.Email_Contact : 'none located';
        const aiReason = state.aiQuery.trim() && row.__aiReason
          ? `<div class="match-reason">${escapeHtml(row.__aiReason)}</div>`
          : '';
        return `<tr${selectedClass}>
          <td><button class="name-button" data-select-id="${escapeHtml(row.Community_ID)}">${escapeHtml(row.Community_Name)}</button>${aiReason}</td>
          <td><span class="table-pill">${escapeHtml(row.Type)}</span></td>
          <td>${escapeHtml(row.Subtype)}</td>
          <td>${escapeHtml(row.Country)}</td>
          <td>${escapeHtml(row.Source_Directory)}</td>
          <td>
            <div class="external-link-cell">
              <button type="button" class="host-link host-link-button" data-open-url="${escapeHtml(row.Verified_Link)}" title="Open ${escapeHtml(row.Verified_Link)}">${escapeHtml(row.Verified_Link_Host || row.Verified_Link)}</button>
              <button type="button" class="mini-link-button" data-copy-url="${escapeHtml(row.Verified_Link)}" title="Copy ${escapeHtml(row.Verified_Link)}">Copy</button>
            </div>
          </td>
          <td>${escapeHtml(emailText)}</td>
        </tr>`;
      }).join('');
    }
    renderPagination(rows.length, totalPages, start, pageRows.length);
    renderDetail(selected);
  };

  const renderPagination = (totalRows, totalPages, start, pageCount) => {
    const from = totalRows ? start + 1 : 0;
    const to = totalRows ? start + pageCount : 0;
    const pages = [];
    const min = Math.max(1, state.page - 2);
    const max = Math.min(totalPages, state.page + 2);
    for (let page = min; page <= max; page += 1) pages.push(page);
    els.pagination.innerHTML = `
      <div class="subtle">Showing ${numberFmt.format(from)}–${numberFmt.format(to)} of ${numberFmt.format(totalRows)}</div>
      <div class="page-buttons">
        <button class="page-button" data-page="${Math.max(1, state.page - 1)}" ${state.page === 1 ? 'disabled' : ''}>Prev</button>
        ${pages.map((page) => `<button class="page-button${page === state.page ? ' active' : ''}" data-page="${page}">${page}</button>`).join('')}
        <button class="page-button" data-page="${Math.min(totalPages, state.page + 1)}" ${state.page === totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;
  };

  const renderDetail = (row) => {
    if (!row) {
      els.detail.innerHTML = '<div class="empty-state">Select a community to inspect its organizing principle, PRS triplet, and provenance details.</div>';
      return;
    }
    const aiEvidenceHtml = state.aiQuery.trim() && Array.isArray(row.__aiEvidence) && row.__aiEvidence.length
      ? `
        <section class="detail-ai-card">
          <h4>Why this matched the AI query</h4>
          <p>${escapeHtml(row.__aiReason || 'This community matched the current dataset-grounded AI query.')}</p>
          <div class="ai-evidence-list">
            ${row.__aiEvidence.map((item) => `
              <div class="ai-evidence-item">
                <strong>${escapeHtml(item.fieldLabel)}</strong>
                <div>${escapeHtml(item.snippet)}</div>
              </div>
            `).join('')}
          </div>
        </section>
      `
      : '';
    els.detail.innerHTML = `
      <div class="detail-card">
        <p class="eyebrow">Community detail</p>
        <h3>${escapeHtml(row.Community_Name)}</h3>
        <div class="chip-row">
          <span class="chip">${escapeHtml(row.Type)}</span>
          <span class="chip">${escapeHtml(row.Subtype)}</span>
          <span class="chip">${escapeHtml(row.Country)}</span>
        </div>
        <div class="detail-links">
          <button type="button" class="link-button" data-open-url="${escapeHtml(row.Verified_Link)}">Open verified site</button>
          <button type="button" class="link-button secondary" data-copy-url="${escapeHtml(row.Verified_Link)}">Copy verified URL</button>
          <button type="button" class="link-button" data-open-url="${escapeHtml(row.Source_Link)}">Open source listing</button>
          <button type="button" class="link-button secondary" data-copy-url="${escapeHtml(row.Source_Link)}">Copy source URL</button>
        </div>
        ${aiEvidenceHtml}
        <section>
          <h4>Central organizing principle</h4>
          <p>${escapeHtml(row.Narrative_Description)}</p>
        </section>
        <section>
          <h4>Problem–Resource–Solution</h4>
          <div class="prs-grid">
            <article class="prs-card problem">
              <div class="label">Problem</div>
              <p>${escapeHtml(row.Problem_Statement)}</p>
            </article>
            <article class="prs-card resource">
              <div class="label">Resource</div>
              <p>${escapeHtml(row.Resource_Statement)}</p>
            </article>
            <article class="prs-card solution">
              <div class="label">Solution</div>
              <p>${escapeHtml(row.Solution_Statement)}</p>
            </article>
          </div>
        </section>
        <section>
          <h4>Metadata and provenance</h4>
          <div class="detail-meta">
            <div class="detail-meta-row"><div class="key">Community ID</div><div>${escapeHtml(row.Community_ID)}</div></div>
            <div class="detail-meta-row"><div class="key">Verified host</div><div class="host-link">${escapeHtml(row.Verified_Link_Host || row.Verified_Link)}</div></div>
            <div class="detail-meta-row"><div class="key">Verified URL</div><div class="detail-url">${escapeHtml(row.Verified_Link)}</div></div>
            <div class="detail-meta-row"><div class="key">Source URL</div><div class="detail-url">${escapeHtml(row.Source_Link)}</div></div>
            <div class="detail-meta-row"><div class="key">Email contact</div><div>${escapeHtml(row.Email_Contact || 'none located')}</div></div>
            <div class="detail-meta-row"><div class="key">Email note</div><div>${escapeHtml(row.Email_Retrieval_Note)}</div></div>
            <div class="detail-meta-row"><div class="key">Narrative words</div><div>${numberFmt.format(row.Narrative_Word_Count || 0)}</div></div>
            <div class="detail-meta-row"><div class="key">PRS triplets</div><div>${numberFmt.format(row.PRS_Triplet_Count || 0)}</div></div>
            <div class="detail-meta-row"><div class="key">Directory source</div><div>${escapeHtml(row.Source_Directory)}</div></div>
            <div class="detail-meta-row"><div class="key">Verification</div><div>${escapeHtml(row.Verification_Method)}</div></div>
            <div class="detail-meta-row"><div class="key">Characterization status</div><div>${escapeHtml(row.Narrative_Grounding)}</div></div>
          </div>
        </section>
      </div>
    `;
  };

  const buildAgentPrompt = (rows) => {
    const visibleSubtypes = sortEntries(Array.from(countBy(rows, 'Subtype').entries())).slice(0, 8).map(([subtype, count]) => `${subtype} (${count})`).join(', ') || 'none';
    const missingEmailCount = rows.filter((row) => !row.hasEmail).length;
    const geoGapCount = rows.filter((row) => row.geoGap).length;
    const manualCount = rows.filter((row) => row.manualCuration).length;
    const filters = [
      state.aiQuery.trim() ? `AI discovery query: ${state.aiQuery.trim()}` : 'AI discovery query: none',
      state.search.trim() ? `Search text: ${state.search.trim()}` : 'Search text: none',
      state.types.size ? `Type filters: ${Array.from(state.types).join(', ')}` : 'Type filters: all',
      state.subtypes.size ? `Subtype filters: ${Array.from(state.subtypes).join(', ')}` : 'Subtype filters: all',
      state.country ? `Country filter: ${state.country}` : 'Country filter: all',
      state.source ? `Source filter: ${state.source}` : 'Source filter: all',
      state.manualOnly ? 'Manual-only mode: on' : 'Manual-only mode: off',
      state.geoOnly ? 'Global/Unspecified-only mode: on' : 'Global/Unspecified-only mode: off',
    ].join('\n- ');
    return [
      'Goal: expand the C2A2 Community Explorer with additional verified communities aligned to the current slice.',
      '',
      'Current filter state:',
      `- ${filters}`,
      '',
      'Hard requirements:',
      '- Only include communities with a live, official web presence.',
      '- Capture a 100-word narrative of the community\'s central organizing principle, grounded in its own website language.',
      '- Produce at least one complete-sentence Problem–Resource–Solution triplet.',
      '- Capture any public email contact, or explicitly record "none located".',
      '- Avoid duplicate communities and duplicate official hosts already present in C2A2.',
      '',
      'Current slice summary:',
      `- Visible communities: ${rows.length} of ${data.length}.`,
      `- Most common visible subtypes: ${visibleSubtypes}.`,
      `- Visible rows missing public email: ${missingEmailCount}.`,
      `- Visible rows with Global/Unspecified geography: ${geoGapCount}.`,
      `- Visible rows from manual homepage curation: ${manualCount}.`,
      `- Globally sparse subtypes worth growing: ${sparseSubtypesGlobal.join(', ')}.`,
      '',
      'Suggested next action:',
      'Search for additional official communities that fit the current filters, especially in sparse subtypes or geographies underrepresented in the visible slice. Return structured candidate records using the existing schema.',
    ].join('\n');
  };

  const renderAgentPrompt = (rows) => {
    const prompt = buildAgentPrompt(rows);
    els.agentPrompt.value = prompt;
  };

  const applyPreset = (preset) => {
    if (preset === 'manual') {
      state.manualOnly = true;
      state.geoOnly = false;
      els.manualOnly.checked = true;
      els.geoOnly.checked = false;
    } else if (preset === 'geo') {
      state.geoOnly = true;
      els.geoOnly.checked = true;
    } else if (preset === 'sparse') {
      state.subtypes = new Set(sparseSubtypesGlobal);
    }
    state.page = 1;
    renderTypePills();
    renderSubtypePills();
    update();
  };

  const update = () => {
    const { rows, searchTerms } = getFilteredRows();
    renderAiPanels();
    renderMetrics(rows);
    renderSearchStatus(rows, searchTerms);
    renderHeatmap(rows);
    renderBarList(els.subtypeBars, rows, 'Subtype', { maxItems: 12, dataAttr: 'data-bar-subtype' });
    renderBarList(els.countryBars, rows, 'Country', { maxItems: 12, dataAttr: 'data-bar-country' });
    renderBarList(els.sourceBars, rows, 'Source_Directory', { maxItems: 6, dataAttr: 'data-bar-source' });
    renderGrowthInsights(rows);
    renderActiveFilters();
    renderResults(rows);
    renderAgentPrompt(rows);
    writeStateToUrl();
  };

  const setUpElements = () => {
    els.aiQuery = document.querySelector('#ai-query-input');
    els.runAiQuery = document.querySelector('#run-ai-query');
    els.clearAiQuery = document.querySelector('#clear-ai-query');
    els.clearAiConversation = document.querySelector('#clear-ai-conversation');
    els.allowExternalSearch = document.querySelector('#allow-external-search');
    els.externalSearchNote = document.querySelector('#external-search-note');
    els.aiQueryStatus = document.querySelector('#ai-query-status');
    els.aiConversation = document.querySelector('#ai-conversation');
    els.assistantModeLabel = document.querySelector('#assistant-mode-label');
    els.assistantTransportPill = document.querySelector('#assistant-transport-pill');
    els.search = document.querySelector('#search-input');
    els.applySearch = document.querySelector('#apply-search');
    els.clearSearch = document.querySelector('#clear-search');
    els.searchStatus = document.querySelector('#search-status');
    els.country = document.querySelector('#country-select');
    els.source = document.querySelector('#source-select');
    els.sort = document.querySelector('#sort-select');
    els.pageSize = document.querySelector('#page-size');
    els.manualOnly = document.querySelector('#manual-only');
    els.geoOnly = document.querySelector('#geo-only');
    els.typePills = document.querySelector('#type-pills');
    els.subtypePills = document.querySelector('#subtype-pills');
    els.metrics = document.querySelector('#metrics');
    els.heatmap = document.querySelector('#heatmap');
    els.subtypeBars = document.querySelector('#subtype-bars');
    els.countryBars = document.querySelector('#country-bars');
    els.sourceBars = document.querySelector('#source-bars');
    els.growth = document.querySelector('#growth-insights');
    els.activeFilters = document.querySelector('#active-filters');
    els.resultsCount = document.querySelector('#results-count');
    els.resultsBody = document.querySelector('#results-body');
    els.pagination = document.querySelector('#pagination');
    els.detail = document.querySelector('#detail-panel');
    els.agentPrompt = document.querySelector('#agent-prompt');
    els.toast = document.querySelector('#toast');
  };

  const wireEvents = () => {
    const commitSearch = (value = els.search.value) => {
      state.search = value;
      state.page = 1;
      update();
    };
    const clearSearch = () => {
      els.search.value = '';
      commitSearch('');
    };

    if (els.aiQuery) {
      els.aiQuery.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          runAiQuery(els.aiQuery.value);
        }
      });
    }
    if (els.allowExternalSearch) {
      els.allowExternalSearch.addEventListener('change', () => {
        state.allowExternalSearch = els.allowExternalSearch.checked;
        update();
      });
    }
    if (els.runAiQuery) els.runAiQuery.addEventListener('click', () => runAiQuery(els.aiQuery.value));
    if (els.clearAiQuery) els.clearAiQuery.addEventListener('click', () => {
      state.aiQuery = '';
      if (els.aiQuery) els.aiQuery.value = '';
      update();
      if (els.aiQuery) els.aiQuery.focus();
    });
    if (els.clearAiConversation) els.clearAiConversation.addEventListener('click', clearConversation);

    els.search.addEventListener('input', () => commitSearch(els.search.value));
    els.search.addEventListener('change', () => commitSearch(els.search.value));
    els.search.addEventListener('search', () => commitSearch(els.search.value));
    els.search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitSearch(els.search.value);
      } else if (event.key === 'Escape' && els.search.value) {
        event.preventDefault();
        clearSearch();
      }
    });
    if (els.applySearch) els.applySearch.addEventListener('click', () => commitSearch(els.search.value));
    if (els.clearSearch) els.clearSearch.addEventListener('click', () => { clearSearch(); els.search.focus(); });

    els.country.addEventListener('change', () => { state.country = els.country.value; state.page = 1; update(); });
    els.source.addEventListener('change', () => { state.source = els.source.value; state.page = 1; update(); });
    els.sort.addEventListener('change', () => { state.sort = els.sort.value; update(); });
    els.pageSize.addEventListener('change', () => { state.pageSize = Number(els.pageSize.value); state.page = 1; update(); });
    els.manualOnly.addEventListener('change', () => { state.manualOnly = els.manualOnly.checked; state.page = 1; update(); });
    els.geoOnly.addEventListener('change', () => { state.geoOnly = els.geoOnly.checked; state.page = 1; update(); });

    document.querySelector('#reset-filters').addEventListener('click', resetState);
    document.querySelector('#download-csv').addEventListener('click', () => {
      const { rows } = getFilteredRows();
      downloadFile('c2a2_community_explorer_filtered.csv', toCsv(rows), 'text/csv;charset=utf-8');
    });
    document.querySelector('#download-json').addEventListener('click', () => {
      const rows = getFilteredRows().rows.map(({ __index, hasEmail, manualCuration, geoGap, searchBlob, searchIndex, aiIndex, ...row }) => row);
      downloadFile('c2a2_community_explorer_filtered.json', JSON.stringify(rows, null, 2), 'application/json;charset=utf-8');
    });
    document.querySelector('#copy-share-link').addEventListener('click', () => copyText(window.location.href));
    document.querySelector('#copy-prompt').addEventListener('click', () => copyText(els.agentPrompt.value, els.agentPrompt));

    document.addEventListener('click', (event) => {
      const openUrlTrigger = event.target.closest('[data-open-url]');
      if (openUrlTrigger) {
        event.preventDefault();
        event.stopPropagation();
        openExternalUrl(openUrlTrigger.getAttribute('data-open-url'));
        return;
      }
      const aiExample = event.target.closest('[data-ai-example]');
      if (aiExample) {
        const example = aiExample.getAttribute('data-ai-example') || '';
        if (els.aiQuery) els.aiQuery.value = example;
        runAiQuery(example);
        return;
      }
      const copyUrlTrigger = event.target.closest('[data-copy-url]');
      if (copyUrlTrigger) {
        event.preventDefault();
        event.stopPropagation();
        const url = normalizeExternalUrl(copyUrlTrigger.getAttribute('data-copy-url')) || copyUrlTrigger.getAttribute('data-copy-url') || '';
        copyText(url);
        return;
      }
      const typePill = event.target.closest('[data-type]');
      if (typePill) {
        const type = typePill.getAttribute('data-type');
        if (state.types.has(type)) state.types.delete(type); else state.types.add(type);
        state.page = 1;
        renderTypePills();
        update();
        return;
      }
      const subtypePill = event.target.closest('[data-subtype]');
      if (subtypePill) {
        const subtype = subtypePill.getAttribute('data-subtype');
        if (state.subtypes.has(subtype)) state.subtypes.delete(subtype); else state.subtypes.add(subtype);
        state.page = 1;
        renderSubtypePills();
        update();
        return;
      }
      const heatCell = event.target.closest('[data-heat-type][data-heat-subtype]');
      if (heatCell) {
        const type = heatCell.getAttribute('data-heat-type');
        const subtype = heatCell.getAttribute('data-heat-subtype');
        const already = state.types.size === 1 && state.subtypes.size === 1 && state.types.has(type) && state.subtypes.has(subtype);
        state.types = already ? new Set() : new Set([type]);
        state.subtypes = already ? new Set() : new Set([subtype]);
        state.page = 1;
        renderTypePills();
        renderSubtypePills();
        update();
        return;
      }
      const heatType = event.target.closest('[data-col-type]');
      if (heatType) {
        const type = heatType.getAttribute('data-col-type');
        if (state.types.has(type)) state.types.delete(type); else state.types.add(type);
        state.page = 1;
        renderTypePills();
        update();
        return;
      }
      const heatSubtype = event.target.closest('[data-row-subtype]');
      if (heatSubtype) {
        const subtype = heatSubtype.getAttribute('data-row-subtype');
        if (state.subtypes.has(subtype)) state.subtypes.delete(subtype); else state.subtypes.add(subtype);
        state.page = 1;
        renderSubtypePills();
        update();
        return;
      }
      const barSubtype = event.target.closest('[data-bar-subtype]');
      if (barSubtype) {
        const subtype = barSubtype.getAttribute('data-bar-subtype');
        if (state.subtypes.has(subtype)) state.subtypes.delete(subtype); else state.subtypes.add(subtype);
        state.page = 1;
        renderSubtypePills();
        update();
        return;
      }
      const barCountry = event.target.closest('[data-bar-country]');
      if (barCountry) {
        state.country = barCountry.getAttribute('data-bar-country') || '';
        els.country.value = state.country;
        state.page = 1;
        update();
        return;
      }
      const barSource = event.target.closest('[data-bar-source]');
      if (barSource) {
        state.source = barSource.getAttribute('data-bar-source') || '';
        els.source.value = state.source;
        state.page = 1;
        update();
        return;
      }
      const preset = event.target.closest('[data-preset]');
      if (preset) {
        applyPreset(preset.getAttribute('data-preset'));
        return;
      }
      const selectButton = event.target.closest('[data-select-id]');
      if (selectButton) {
        state.selectedId = selectButton.getAttribute('data-select-id');
        update();
        return;
      }
      const clearChip = event.target.closest('[data-clear-chip]');
      if (clearChip) {
        const handlers = els.activeFilters._clearHandlers || [];
        const index = Number(clearChip.getAttribute('data-clear-chip'));
        if (handlers[index]) handlers[index]();
        state.page = 1;
        renderTypePills();
        renderSubtypePills();
        update();
        return;
      }
      const pageButton = event.target.closest('[data-page]');
      if (pageButton && !pageButton.disabled) {
        state.page = Number(pageButton.getAttribute('data-page'));
        update();
      }
    });
  };

  const renderStaticMeta = () => {
    document.querySelector('#hero-record-count').textContent = numberFmt.format(data.length);
    document.querySelector('#hero-type-count').textContent = numberFmt.format(unique(data, 'Type').length);
    document.querySelector('#hero-subtype-count').textContent = numberFmt.format(unique(data, 'Subtype').length);
    document.querySelector('#hero-country-count').textContent = numberFmt.format(unique(data, 'Country').length);
    document.querySelector('#footer-meta').textContent = `Built from ${meta.source_file || 'community_directory_rebuilt_main.csv'} · generated ${meta.generated_at || ''} · this interface visualizes the rebuilt working dataset without live re-verification.`;
  };

  const init = async () => {
    if (isStaticMode) {
      window.location.replace(servedAppUrl);
      return;
    }
    setUpElements();
    hydrateStateFromUrl();
    renderStaticMeta();
    renderSelectOptions();
    renderTypePills();
    renderSubtypePills();
    syncControls();
    wireEvents();
    const assistantReady = await refreshAssistantAvailability();
    if (state.aiQuery.trim()) {
      if (assistantReady) runAiQuery(state.aiQuery);
      return;
    }
    update();
  };

  document.addEventListener('DOMContentLoaded', init);
}());
