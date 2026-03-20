# C2A2 Community Explorer

Community Context for AI Alignment

This project turns the rebuilt community directory into a static, interactive web interface.

## What is included

- `index.html` - modular browser entry point
- `styles.css` - page styling
- `data.js` - embedded dataset for immediate use without a server
- `community_data.json` - machine-readable JSON for future APIs or agents
- `search-core.js` - reusable search normalization and ranking helpers shared by the browser app and smoke tests
- `ai-query-core.js` - dataset-grounded AI query interpretation, ranking, explanation, and citation helpers
- `app.js` - filtering, visualization, pagination, detail panel, and prompt-generation logic
- `server.js` - required local server for the assistant; serves the app and routes `/api/query` to the OpenAI-backed assistant
- `package.json` - lightweight scripts for local server and smoke tests
- `community_record_schema.json` - a JSON Schema starter for future ingestion and validation
- `c2a2_community_explorer.html` - standalone single-file version for quick opening and sharing
- `test_search_smoke.js` - Node smoke test for the tokenized search logic
- `test_ai_query_smoke.js` - Node smoke test for the dataset-grounded AI retrieval path
- `test_assistant_query_smoke.js` - Node smoke test for local assistant answers such as count and region queries
- `docs/ai-query-architecture.md` - design note for the staged AI discovery layer and future webpage grounding

## What the interface currently does

- AI assistant panel with a scrollable conversation transcript, pinned clear action, and plain-English answers
- Dataset-first natural-language requests with local count, summarize, and retrieval behavior
- Optional server-assisted mode that can upgrade answers to an OpenAI-backed assistant and extend beyond the dataset when allowed
- Faceted filtering by type, subtype, country, source, and text search
- Interactive type x subtype heatmap
- Bar visualizations for subtype, country, and source coverage
- Detailed community panel showing narrative, PRS triplet, and provenance
- Download of the current filtered slice as CSV or JSON
- Shareable filter state encoded in the URL when the host environment allows it
- Auto-generated prompt stub for a future enrichment agent or LLM workflow

## AI discovery layer

This branch now treats the assistant as server-backed only:

- Run `node server.js` in the environment where the OpenAI-backed assistant is enabled.
- Open the app through the server, not by opening `index.html` directly.
- The model does not rely on one canned local answer. It can inspect the dataset through server-side tools for:
  - semantic dataset search
  - counts and grouped breakdowns
  - country/capital/area inspection
  - richer community-record lookup by ID
- The assistant searches the existing dataset first.
- It only widens beyond the dataset when local evidence is insufficient and outside search is allowed.
- Existing filters, visualizations, URL state, downloads, and detail rendering remain intact.
- Keyword search remains available as a second-pass exact-text filter on top of the LLM-driven slice.

See [`docs/ai-query-architecture.md`](docs/ai-query-architecture.md) for the staged design and future grounding hook, and [`server/query_contract.json`](server/query_contract.json) for the request/response shape.

## Search fix in this revision

The original search could feel nonresponsive in embedded HTML preview environments because it depended on a single live `input` pathway and exact substring matching.

This revision hardens search in four ways:

1. It adds explicit `Search` and `Clear` controls, plus Enter, Escape, `input`, `change`, and `search` event handling.
2. It normalizes text before indexing so punctuation and case are less fragile.
3. It tokenizes multi-term queries, so terms can match across fields in any order instead of only as one exact substring.
4. It catches URL history update failures so a sandbox preview cannot break filtering.

## Smoke test

Run this from the project directory:

```bash
node test_search_smoke.js
node test_ai_query_smoke.js
node test_assistant_query_smoke.js
```

## Run locally

Required local server with assistant endpoint:

```bash
node server.js
```

The server now auto-loads a repo-local `.env` file if present. Populate:

- [.env](/Users/tloughr1/Downloads/Community_Inventory_improvements_ChatGPT/c2a2-community-explorer/.env)
- or copy from [.env.example](/Users/tloughr1/Downloads/Community_Inventory_improvements_ChatGPT/c2a2-community-explorer/.env.example)

Required value:

```bash
OPENAI_API_KEY=your_real_key_here
```

You can still launch with an inline env var if you prefer:

```bash
OPENAI_API_KEY=... node server.js
```

## Recommended next steps for the next iteration

1. Replace `data.js` with an API endpoint and store the canonical data in a database or versioned JSON files.
2. Add a verification pipeline that checks each stored URL live before publication.
3. Add an enrichment worker that tries to locate public contact emails and direct website-grounded narrative excerpts.
4. Introduce a duplicate-detection step keyed on host, organization name, and source directory.
5. Add an LLM-backed query layer that maps natural-language requests into the filter state already supported in `app.js`.
6. Add an audit log so every added or revised community record keeps provenance and reviewer metadata.

## No-build workflow

For the AI-enabled explorer, run the server and open the served app at `http://127.0.0.1:4173`.

The standalone single-file snapshot remains available for quick sharing, but it is no longer the assistant path.

## Repository workflow prepared here

This project bundle is ready to be committed to Git and imported into GitHub for use with Codex-connected workflows under the C2A2 Community Explorer name. A companion feature branch scaffold can be created for the future AI query layer.
