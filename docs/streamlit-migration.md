# Streamlit Migration Strategy

## What to migrate first

For a public prototype, the right first move is not to port the entire Node app one-to-one. The stable path is:

1. Use `community_data.json` as the source of truth.
2. Rebuild the explorer UI directly in Streamlit.
3. Keep public deployment read-only.
4. Present the Assistant tab as under construction until the transport path is reliable.
5. Leave dataset writes and external search for a later authenticated admin path.

That gives you something demoable quickly without exposing the more fragile server-only mutation workflow on a public endpoint.

## Why not host the existing app inside Streamlit

The current app is built as:

- static browser files: `index.html`, `app.js`, `styles.css`
- a Node server: `server.js`
- OpenAI tool loop and dataset writes on the server side

Streamlit Community Cloud is happiest with a Python entrypoint, Python dependencies, and secrets managed in the Streamlit environment. It is not the right home for a Node-first server app unless you want to fight the platform.

## Recommended public architecture

### Phase 1: Public read-only prototype

- `streamlit_app.py`
- `community_data.json`
- `requirements.txt`
- Streamlit secret: `OPENAI_API_KEY`

Capabilities:

- filter by type, subtype, country, and source
- exact-text search
- current-slice table
- basic charts
- detail view
- deliberate under-construction assistant placeholder for public demo clarity

### Phase 2: Private admin workflow

Keep write actions off the public Streamlit app.

Instead, add either:

- a separate private Streamlit admin app, or
- keep writes in the existing Node/local-admin workflow

Admin-only features later:

- add community
- edit community
- approve AI-proposed additions
- view audit trail

## What the prototype already does

`streamlit_app.py` now provides:

- cached loading of `community_data.json`
- sidebar filters
- metrics and simple charts
- detail view with provenance
- CSV export
- an under-construction Assistant tab that avoids exposing a flaky public AI path

## What to do next if you want parity later

1. Move shared data transforms into a small Python module.
2. Add a more inspectable retrieval/ranking layer in Python instead of simple token scoring.
3. Add structured assistant responses with citations and recommended IDs.
4. Add authentication before any write path.
5. Only after auth, connect to a true database or versioned write API.
