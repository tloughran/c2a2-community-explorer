# C2A2 Community Explorer

Community Context for AI Alignment

This project turns the rebuilt community directory into a static, interactive web interface.

## What is included

- `index.html` - modular browser entry point
- `styles.css` - page styling
- `data.js` - embedded dataset for immediate use without a server
- `community_data.json` - machine-readable JSON for future APIs or agents
- `search-core.js` - reusable search normalization and ranking helpers shared by the browser app and smoke tests
- `app.js` - filtering, visualization, pagination, detail panel, and prompt-generation logic
- `community_record_schema.json` - a JSON Schema starter for future ingestion and validation
- `c2a2_community_explorer.html` - standalone single-file version for quick opening and sharing
- `test_search_smoke.js` - Node smoke test for the tokenized search logic

## What the interface currently does

- Faceted filtering by type, subtype, country, source, and text search
- Interactive type x subtype heatmap
- Bar visualizations for subtype, country, and source coverage
- Detailed community panel showing narrative, PRS triplet, and provenance
- Download of the current filtered slice as CSV or JSON
- Shareable filter state encoded in the URL when the host environment allows it
- Auto-generated prompt stub for a future enrichment agent or LLM workflow

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
```

## Recommended next steps for the next iteration

1. Replace `data.js` with an API endpoint and store the canonical data in a database or versioned JSON files.
2. Add a verification pipeline that checks each stored URL live before publication.
3. Add an enrichment worker that tries to locate public contact emails and direct website-grounded narrative excerpts.
4. Introduce a duplicate-detection step keyed on host, organization name, and source directory.
5. Add an LLM-backed query layer that maps natural-language requests into the filter state already supported in `app.js`.
6. Add an audit log so every added or revised community record keeps provenance and reviewer metadata.

## No-build workflow

You can open either:

- `c2a2_community_explorer.html` for a single-file version, or
- `index.html` for the modular version.

No server or build step is required for either file.

## Repository workflow prepared here

This project bundle is ready to be committed to Git and imported into GitHub for use with Codex-connected workflows under the C2A2 Community Explorer name. A companion feature branch scaffold can be created for the future AI query layer.
