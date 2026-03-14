# AI Atlas Query Architecture

This branch is the scaffold for replacing the deterministic text-search box with an AI query layer.

## Goal

Allow a user to ask natural-language questions such as:

- "Find interdisciplinary communities in Canada with explicit social innovation goals."
- "Show me student-led think tanks in Europe that mention policy training."
- "Suggest underrepresented subtypes with active public contact emails."

The long-term target is a two-stage system:

1. **Database reasoning** over the local community dataset.
2. **Live webpage grounding** against the official community site and selected subpages when deeper evidence is needed.

## Recommended request flow

1. The browser sends the user prompt and current filter state to a server endpoint.
2. The server runs an LLM planning step that maps the request into structured constraints.
3. The server queries the atlas dataset and returns candidate community IDs.
4. When the prompt needs fresh evidence, the server fetches the official community webpages for those candidates.
5. The server asks the model to synthesize a response grounded in the dataset plus fetched webpage snippets.
6. The browser receives:
   - a natural-language answer,
   - structured filters to apply in the UI,
   - supporting evidence,
   - a list of recommended communities.

## Why this should be server-side

Live webpage enrichment should not be done directly from a static browser page because:

- most sites will block or degrade direct browser scraping,
- cross-origin policy will limit access,
- rate limiting and caching should be centralized,
- provenance and audit logs should be captured consistently.

## Minimal endpoint contract

See `server/query_contract.json` for the proposed request/response schema.

## Migration strategy

- Keep the current deterministic search as a fallback.
- Add an assistant panel that can propose filters and rank candidates.
- Move URL fetching, excerpting, and citation storage to the server.
- Add provenance fields to each response so a user can inspect why a recommendation was made.
