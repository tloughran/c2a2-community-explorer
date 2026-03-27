from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Iterable

import pandas as pd
import streamlit as st

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover - import is runtime-dependent in deployment
    OpenAI = None


APP_DIR = Path(__file__).resolve().parent
DATA_PATH = APP_DIR / "community_data.json"
DEFAULT_MODEL = "gpt-5.4"
SEARCH_FIELDS = [
    "Community_Name",
    "Type",
    "Subtype",
    "Country",
    "Source_Directory",
    "Verified_Link_Host",
    "Narrative_Description",
    "Problem_Statement",
    "Resource_Statement",
    "Solution_Statement",
    "Verification_Method",
    "Narrative_Grounding",
]


def normalize_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def tokenize_query(query: str) -> list[str]:
    return [token for token in re.split(r"[^a-z0-9]+", normalize_text(query)) if len(token) > 1]


@st.cache_data(show_spinner=False)
def load_rows() -> pd.DataFrame:
    rows = json.loads(DATA_PATH.read_text())
    frame = pd.DataFrame(rows)
    frame["Narrative_Word_Count"] = pd.to_numeric(frame.get("Narrative_Word_Count", 0), errors="coerce").fillna(0).astype(int)
    frame["PRS_Triplet_Count"] = pd.to_numeric(frame.get("PRS_Triplet_Count", 0), errors="coerce").fillna(0).astype(int)
    frame["search_blob"] = frame.apply(
        lambda row: " ".join(normalize_text(row.get(column, "")) for column in SEARCH_FIELDS),
        axis=1,
    )
    return frame


def apply_filters(
    frame: pd.DataFrame,
    query: str,
    types: Iterable[str],
    subtypes: Iterable[str],
    countries: Iterable[str],
    sources: Iterable[str],
) -> pd.DataFrame:
    filtered = frame.copy()
    if query.strip():
        tokens = tokenize_query(query)
        if tokens:
            mask = filtered["search_blob"].apply(lambda blob: all(token in blob for token in tokens))
            filtered = filtered[mask]
    if types:
        filtered = filtered[filtered["Type"].isin(types)]
    if subtypes:
        filtered = filtered[filtered["Subtype"].isin(subtypes)]
    if countries:
        filtered = filtered[filtered["Country"].isin(countries)]
    if sources:
        filtered = filtered[filtered["Source_Directory"].isin(sources)]
    return filtered.sort_values(["Community_Name", "Community_ID"]).reset_index(drop=True)


def rank_rows_for_question(frame: pd.DataFrame, question: str, limit: int = 18) -> pd.DataFrame:
    query = normalize_text(question)
    tokens = tokenize_query(question)
    if not tokens:
        return frame.head(limit).copy()

    scored = frame.copy()

    def score_blob(blob: str) -> int:
        value = normalize_text(blob)
        score = sum(1 for token in tokens if token in value)
        if query and query in value:
            score += 3
        return score

    scored["__score"] = scored["search_blob"].apply(score_blob)
    scored = scored[scored["__score"] > 0].sort_values(["__score", "Community_Name"], ascending=[False, True])
    if scored.empty:
        return frame.head(limit).copy()
    return scored.head(limit).copy()


def compact_context(frame: pd.DataFrame, limit: int = 18) -> str:
    lines = []
    for row in frame.head(limit).to_dict(orient="records"):
        lines.append(
            "\n".join(
                [
                    f"ID: {row['Community_ID']}",
                    f"Name: {row['Community_Name']}",
                    f"Type/Subtype: {row['Type']} / {row['Subtype']}",
                    f"Country: {row['Country']}",
                    f"Verified URL: {row['Verified_Link']}",
                    f"Organizing principle: {row['Narrative_Description']}",
                    f"Problem: {row['Problem_Statement']}",
                    f"Resource: {row['Resource_Statement']}",
                    f"Solution: {row['Solution_Statement']}",
                ]
            )
        )
    return "\n\n---\n\n".join(lines)


def resolve_openai_credentials() -> tuple[str, str]:
    api_key = ""
    model = DEFAULT_MODEL
    if "OPENAI_API_KEY" in st.secrets:
        api_key = st.secrets["OPENAI_API_KEY"]
    elif os.getenv("OPENAI_API_KEY"):
        api_key = os.getenv("OPENAI_API_KEY", "")
    if "OPENAI_MODEL" in st.secrets:
        model = st.secrets["OPENAI_MODEL"]
    elif os.getenv("OPENAI_MODEL"):
        model = os.getenv("OPENAI_MODEL", DEFAULT_MODEL)
    return api_key, model


def ask_dataset_assistant(question: str, filtered_frame: pd.DataFrame) -> dict[str, object]:
    api_key, model = resolve_openai_credentials()
    if not api_key or OpenAI is None:
        raise RuntimeError("OPENAI_API_KEY is not configured for this Streamlit app.")

    candidate_rows = rank_rows_for_question(filtered_frame, question)
    context = compact_context(candidate_rows)
    client = OpenAI(api_key=api_key)
    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "You are the public C2A2 Community Explorer demo assistant. "
                            "Answer conversationally in English using the supplied dataset rows only. "
                            "Do not claim to write to the dataset from Streamlit. "
                            "If the supplied slice is insufficient, say so plainly. "
                            "Cite community IDs inline when you make specific claims."
                        ),
                    }
                ],
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            f"Current filtered slice size: {len(filtered_frame)} communities.\n"
                            f"Candidate rows selected for this question:\n\n{context}\n\n"
                            f"Question: {question}"
                        ),
                    }
                ],
            },
        ],
    )
    answer = getattr(response, "output_text", "") or ""
    return {
        "answer": answer.strip(),
        "candidate_rows": candidate_rows.drop(columns=["search_blob"], errors="ignore"),
        "model": model,
    }


def render_metrics(frame: pd.DataFrame) -> None:
    type_count = frame["Type"].nunique() if not frame.empty else 0
    subtype_count = frame["Subtype"].nunique() if not frame.empty else 0
    country_count = frame["Country"].nunique() if not frame.empty else 0
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Communities", f"{len(frame):,}")
    col2.metric("Types", f"{type_count:,}")
    col3.metric("Subtypes", f"{subtype_count:,}")
    col4.metric("Countries", f"{country_count:,}")


def render_charts(frame: pd.DataFrame) -> None:
    left, right = st.columns(2)
    subtype_counts = frame["Subtype"].value_counts().head(12)
    country_counts = frame["Country"].value_counts().head(12)
    with left:
        st.subheader("Top subtypes")
        if subtype_counts.empty:
            st.info("No subtype data in the current slice.")
        else:
            st.bar_chart(subtype_counts)
    with right:
        st.subheader("Top countries")
        if country_counts.empty:
            st.info("No country data in the current slice.")
        else:
            st.bar_chart(country_counts)


def render_detail(frame: pd.DataFrame) -> None:
    st.subheader("Community detail")
    if frame.empty:
        st.info("No communities match the current filters.")
        return
    options = frame["Community_Name"] + " [" + frame["Community_ID"] + "]"
    selected_label = st.selectbox("Inspect a community", options, index=0)
    selected_id = selected_label.rsplit("[", 1)[-1].rstrip("]")
    row = frame.loc[frame["Community_ID"] == selected_id].iloc[0]

    st.markdown(f"### {row['Community_Name']}")
    st.caption(f"{row['Type']} | {row['Subtype']} | {row['Country']}")

    with st.container(border=True):
        st.markdown("**Central organizing principle**")
        st.write(row["Narrative_Description"])

    col1, col2, col3 = st.columns(3)
    with col1:
        st.markdown("**Problem**")
        st.write(row["Problem_Statement"])
    with col2:
        st.markdown("**Resource**")
        st.write(row["Resource_Statement"])
    with col3:
        st.markdown("**Solution**")
        st.write(row["Solution_Statement"])

    st.markdown("**Metadata and provenance**")
    meta = {
        "Community ID": row["Community_ID"],
        "Verified URL": row["Verified_Link"],
        "Source URL": row["Source_Link"],
        "Verified host": row["Verified_Link_Host"],
        "Directory source": row["Source_Directory"],
        "Verification": row["Verification_Method"],
        "Characterization status": row["Narrative_Grounding"],
        "Entry date": row.get("Entry_Date", ""),
        "Entered by": row.get("Entered_By", ""),
        "Entry method": row.get("Entry_Method", ""),
    }
    meta_frame = pd.DataFrame(
        [{"Field": key, "Value": value} for key, value in meta.items() if str(value).strip()]
    )
    st.dataframe(meta_frame, use_container_width=True, hide_index=True)


def main() -> None:
    st.set_page_config(
        page_title="C2A2 Community Explorer",
        page_icon="🧭",
        layout="wide",
    )

    st.title("C2A2 Community Explorer")
    st.caption("Public Streamlit prototype: dataset-first exploration with an optional LLM analysis layer.")

    rows = load_rows()

    with st.sidebar:
        st.header("Filters")
        search = st.text_input("Exact-text search", placeholder="youth civic action")
        types = st.multiselect("Type", sorted(rows["Type"].dropna().unique()))
        subtype_options = sorted(rows["Subtype"].dropna().unique())
        subtypes = st.multiselect("Subtype", subtype_options)
        countries = st.multiselect("Country", sorted(rows["Country"].dropna().unique()))
        sources = st.multiselect("Source directory", sorted(rows["Source_Directory"].dropna().unique()))
        st.divider()
        st.caption(
            "This Streamlit version is the fast public demo path: read-only by default, "
            "using the local dataset as the source of truth."
        )

    filtered = apply_filters(rows, search, types, subtypes, countries, sources)

    explorer_tab, assistant_tab, notes_tab = st.tabs(["Explorer", "Assistant", "Deployment notes"])

    with explorer_tab:
        render_metrics(filtered)
        st.markdown(f"Showing **{len(filtered):,}** of **{len(rows):,}** total communities.")
        render_charts(filtered)
        st.subheader("Current slice")
        display_columns = [
            "Community_ID",
            "Community_Name",
            "Type",
            "Subtype",
            "Country",
            "Verified_Link_Host",
            "Source_Directory",
        ]
        st.dataframe(filtered[display_columns], use_container_width=True, hide_index=True)
        render_detail(filtered)
        st.download_button(
            "Download current slice as CSV",
            data=filtered.drop(columns=["search_blob"], errors="ignore").to_csv(index=False),
            file_name="c2a2_filtered_slice.csv",
            mime="text/csv",
        )

    with assistant_tab:
        st.subheader("Dataset assistant")
        api_key, model = resolve_openai_credentials()
        if not api_key:
            st.warning(
                "No `OPENAI_API_KEY` is configured for this Streamlit deployment yet. "
                "The explorer still works, but the chat assistant is disabled."
            )
        else:
            st.caption(f"Using model: `{model}`")

        if "streamlit_messages" not in st.session_state:
            st.session_state.streamlit_messages = [
                {
                    "role": "assistant",
                    "content": (
                        "Ask about the current filtered slice in plain English. "
                        "This public Streamlit demo is read-only and answers from the local dataset."
                    ),
                }
            ]

        for message in st.session_state.streamlit_messages:
            with st.chat_message(message["role"]):
                st.markdown(message["content"])

        prompt = st.chat_input(
            "Ask about the current filtered slice",
            disabled=not bool(api_key),
        )
        if prompt:
            st.session_state.streamlit_messages.append({"role": "user", "content": prompt})
            with st.chat_message("user"):
                st.markdown(prompt)

            with st.chat_message("assistant"):
                with st.spinner("Reviewing the filtered dataset..."):
                    try:
                        result = ask_dataset_assistant(prompt, filtered)
                        answer = result["answer"] or "I couldn't produce an answer from the current slice."
                        st.markdown(answer)
                        st.markdown("**Rows consulted for this answer**")
                        consulted = result["candidate_rows"][
                            ["Community_ID", "Community_Name", "Type", "Subtype", "Country"]
                        ]
                        st.dataframe(consulted, use_container_width=True, hide_index=True)
                    except Exception as error:  # pragma: no cover - depends on runtime secrets/network
                        answer = f"Assistant error: {error}"
                        st.error(answer)

            st.session_state.streamlit_messages.append({"role": "assistant", "content": answer})

    with notes_tab:
        st.subheader("How this Streamlit prototype relates to the Node app")
        st.markdown(
            """
            - The existing Node/HTML app remains the richer engineering version.
            - This Streamlit app is the quick public-demo path.
            - It reads the same canonical dataset file: `community_data.json`.
            - It intentionally stays read-only for public deployment stability.
            - If you want admin write actions later, add a separate authenticated admin surface rather than exposing dataset writes publicly.
            """
        )
        st.subheader("Streamlit deployment checklist")
        st.markdown(
            """
            1. Deploy this repo with `streamlit_app.py` as the entrypoint.
            2. Add `OPENAI_API_KEY` as a Streamlit secret if you want the assistant enabled.
            3. Keep the demo public and read-only at first.
            4. Add admin authentication before enabling any dataset mutation.
            """
        )


if __name__ == "__main__":
    main()
