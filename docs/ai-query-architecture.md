# AI Query Architecture

## Scope

This first production-credible AI layer is dataset-grounded only. It interprets natural-language prompts, ranks matching communities from the existing C2A2 dataset, and synthesizes a short explanation with evidence snippets drawn from the matched dataset rows.

It does not make webpage-grounded claims yet. The current authoritative input is still the existing `data.js` dataset.

## Current flow

1. `index.html` renders a top-level AI Discovery panel while keeping the original explorer layout, charts, filters, and detail panel.
2. `ai-query-core.js` provides the retrieval pipeline:
   - prompt interpretation
   - field-aware ranking over the current dataset
   - explanation synthesis
   - citation/evidence packaging
3. `app.js` treats the AI query response as another ranked slice of the same dataset:
   - the result table updates
   - charts and metrics recompute against the AI-ranked slice
   - the detail panel shows why the selected row matched
   - keyword search remains available as a fallback or second-pass filter

## Retrieval model

The local adapter is intentionally inspectable:

- `interpretPrompt(prompt)` extracts keywords, a small set of meaningful adjacent phrases, and field-focus hints.
- `buildRowAiIndex(row, options)` normalizes the current dataset fields into a reusable retrieval index.
- `runDatasetQuery(rows, prompt, options)` scores rows, filters weak matches, and returns structured output:
  - `answer.summary`
  - `answer.citations`
  - `matches[]` with scores, reasons, and evidence

The current field weighting favors:

- organizing principle / narrative
- PRS problem/resource/solution fields
- subtype/type
- source and provenance metadata as lighter signals

## Extension points for webpage grounding

The retrieval core is designed so future grounding can be added without replacing the UI contract:

- `buildRowAiIndex(row, { additionalGroundingDocuments })`
- `meta.futureGroundingHook === "additionalGroundingDocuments"`

The intended next step is to attach webpage-derived grounding passages per community and pass them in as additional grounding documents. That keeps the ranking and citation structure stable while allowing richer evidence later.

## Fallback behavior

- If the AI module is unavailable, the app still loads and the explorer continues to work with filters, charts, detail rendering, downloads, URL state, and keyword search.
- If an AI query returns no strong matches, the UI explains that outcome and keeps the rest of the explorer usable.

## Validation

Run:

```bash
node test_ai_query_smoke.js
```

This validates that the local AI retrieval path returns structured matches, explanations, and evidence for representative prompts.
