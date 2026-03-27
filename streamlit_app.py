from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterable

import pandas as pd
import streamlit as st


APP_DIR = Path(__file__).resolve().parent
DATA_PATH = APP_DIR / "community_data.json"
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


def render_under_construction_panel() -> None:
    st.markdown(
        """
        <style>
        .construction-card {
            background: linear-gradient(135deg, #0f0f0f 0%, #1b1b1b 100%);
            border: 4px solid #f7d046;
            border-radius: 18px;
            padding: 1.5rem;
            box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
            color: #f6f1d5;
        }
        .construction-tape {
            margin: 0 0 1rem 0;
            padding: 0.55rem 0.8rem;
            border-radius: 999px;
            background: repeating-linear-gradient(
                -45deg,
                #f7d046,
                #f7d046 16px,
                #141414 16px,
                #141414 32px
            );
            color: #141414;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            display: inline-block;
        }
        .construction-card h3 {
            color: #ffe16e;
            margin-bottom: 0.5rem;
        }
        .construction-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 0.9rem;
            margin-top: 1rem;
        }
        .construction-note {
            background: rgba(247, 208, 70, 0.1);
            border: 1px solid rgba(247, 208, 70, 0.38);
            border-radius: 14px;
            padding: 0.9rem 1rem;
        }
        </style>
        <div class="construction-card">
            <div class="construction-tape">Assistant Under Construction</div>
            <h3>Public AI assistant is temporarily offline</h3>
            <p>
                The public Streamlit prototype is intentionally showing the explorer only.
                We are still hardening the LLM pathway for reliable public deployment.
            </p>
            <div class="construction-grid">
                <div class="construction-note">
                    <strong>What works now</strong><br/>
                    Filters, charts, detail views, and CSV export over the full C2A2 dataset.
                </div>
                <div class="construction-note">
                    <strong>What returns later</strong><br/>
                    Natural-language querying, source-grounded explanations, and guided comparison.
                </div>
                <div class="construction-note">
                    <strong>Current status</strong><br/>
                    Demo-safe public shell first, assistant reliability work next.
                </div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


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

    explorer_tab, assistant_tab, notes_tab = st.tabs(["Explorer", "Assistant", "About C2A2"])

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
        render_under_construction_panel()
        st.info("For now, use the Explorer tab for the public demo.")

    with notes_tab:
        st.subheader("C2A2 Community Explorer prototype")
        st.markdown(
            """
            This public app is a **C2A2 Community Explorer prototype**, part of the emerging **C2A2 platform**.

            C2A2 takes a **Community-Context-for-AI-Alignment** approach. The idea is that communities already carry
            rich purposes, practices, tensions, histories, and ways of learning. A useful AI-alignment platform should
            help communities make those forms of life more intelligible to themselves and to one another, rather than
            treating alignment only as an abstract technical problem.
            """
        )

        st.subheader("What the broader platform is meant to support")
        st.markdown(
            """
            1. Explore a variety of pre-loaded, user-loaded, and/or C2A2-member communities.
            2. Articulate purpose, status, and curricula for entry, growth, and participation within any interested community.
            3. Compare community goals and practical projects in terms of articulated and mappable **Problem-Resource-Solution triplets**, as demonstrated in this explorer, to foster collaboration or contrast across approaches.
            4. Grow a community's goals and resources, where desired, through guidance from and consultation with other communities.
            5. Dialogue with other communities to stabilize an approach to shared goals and, where appropriate, expand those goals.
            6. Eventually, study rich dialectical engagement among mature communities of the sort Alasdair MacIntyre described as characteristic of the rationality of tradition and craft.
            """
        )

        st.subheader("What this prototype shows now")
        st.markdown(
            """
            This public prototype focuses on one slice of that larger vision:

            - a community explorer over a curated C2A2 dataset
            - filters across type, subtype, geography, and source
            - detail views for each community's organizing principle
            - Problem-Resource-Solution framing for comparison across communities

            The Assistant tab is currently presented as **under construction** while the public AI pathway is being hardened.
            """
        )

        st.subheader("Contact")
        st.markdown(
            """
            Contact [Thomas Loughran](https://linkedin.com/in/tloughran) on LinkedIn.
            """
        )


if __name__ == "__main__":
    main()
