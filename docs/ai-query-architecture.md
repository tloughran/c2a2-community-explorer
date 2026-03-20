# AI Query Architecture

## Scope

This assistant layer is dataset-first. It interprets natural-language prompts, answers locally over the current C2A2 dataset, and can optionally upgrade to an OpenAI-backed server flow when a local server and API key are available.

The authoritative local input is still the existing dataset. External search is an opt-in extension path rather than the default.

## Current flow

1. `index.html` renders a top-level assistant panel with a scrollable transcript and sticky clear action while keeping the explorer layout, charts, filters, and detail panel.
2. `ai-query-core.js` provides the shared local planner:
   - prompt interpretation
   - region and count handling
   - field-aware ranking over the current dataset
   - answer synthesis
   - evidence packaging
3. `app.js` treats the latest assistant turn as another ranked slice of the same dataset:
   - the result table updates
   - charts and metrics recompute against the latest recommended slice
   - the detail panel shows why the selected row matched
   - keyword search remains available as a fallback or second-pass filter
4. `server.js` optionally serves the app and `/api/query`:
   - local fallback if no server LLM is available
   - a tool-using OpenAI-backed assistant when `OPENAI_API_KEY` is present
   - outside-the-dataset search only when allowed
5. `assistant-toolkit.js` gives the server LLM inspectable dataset tools instead of one precomputed reply:
   - `search_dataset`
   - `count_dataset`
   - `inspect_geographies`
   - `get_communities`

## Why this changed

The earlier version still behaved too much like a smarter keyword layer. It could rank rows and answer a few structured prompt types, but it was not a genuinely conversational assistant over the dataset.

The deeper fix is to move the primary intelligence into a server-side LLM agent that can:

- decide which dataset operations it needs
- inspect structured tool output before answering
- carry a conversation across turns
- separate dataset-grounded findings from outside-the-dataset findings
- choose when broader web search is warranted

That means the browser-only planner is now explicitly the fallback path, not the main intelligence layer.

## Retrieval model

The local adapter remains intentionally inspectable and still handles more than simple retrieval:

- `interpretPrompt(prompt)` extracts keywords, a small set of meaningful adjacent phrases, and field-focus hints.
- `buildIntent(prompt, rows, requestedMode)` adds count/list intent detection, region detection, and search-scope routing.
- `buildRowAiIndex(row, options)` normalizes the current dataset fields into a reusable retrieval index.
- `runDatasetQuery(rows, prompt, options)` scores rows, filters weak matches, and returns structured output:
  - `answer.summary`
  - `answer.citations`
  - `matches[]` with scores, reasons, and evidence
- `answerQueryLocally(rows, prompt, options)` returns an assistant-ready English answer, ranked IDs, evidence, next steps, and a signal for whether external search would help.

In full server mode, that local answer is no longer treated as the primary intelligence. It is used as a fallback only when the server LLM is unavailable.

The server LLM now works differently:

1. Receive the user prompt, current filters, and recent conversation.
2. Call dataset tools as needed.
3. Optionally call web search only when allowed and justified.
4. Return:
   - a plain-English answer
   - a dataset-backed recommended ID slice
   - follow-up suggestions
   - explicitly separated external findings when applicable

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

- If the server is unavailable, the app still loads and the assistant uses the local dataset planner.
- If `OPENAI_API_KEY` is not set, the server still works in local-answer mode.
- If an AI query returns no strong matches, the UI explains that outcome and keeps the rest of the explorer usable.
- The transcript remains visible and scrollable, and the clear action stays in sight.
- The UI now labels local mode as a heuristic fallback so it is not confused with full conversational assistant behavior.

## Validation

Run:

```bash
node test_ai_query_smoke.js
node test_assistant_query_smoke.js
node test_assistant_toolkit_smoke.js
```

This validates both the local retrieval path and the dataset-tool layer that the server LLM uses in full conversational mode.
