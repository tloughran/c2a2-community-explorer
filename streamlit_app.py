from __future__ import annotations

import hashlib
import re
from typing import Iterable

import pandas as pd
import streamlit as st
import pydeck as pdk

from country_coordinates import ALIASES, COUNTRY_COORDINATES
import platform_store as store


SEARCH_FIELDS = [
    "Community_Name",
    "Type",
    "Subtype",
    "SSubtype",
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
    store.initialize_store()
    frame = store.fetch_communities()
    frame["Narrative_Word_Count"] = pd.to_numeric(frame.get("Narrative_Word_Count", 0), errors="coerce").fillna(0).astype(int)
    frame["PRS_Triplet_Count"] = pd.to_numeric(frame.get("PRS_Triplet_Count", 0), errors="coerce").fillna(0).astype(int)
    frame["search_blob"] = frame.apply(
        lambda row: " ".join(normalize_text(row.get(column, "")) for column in SEARCH_FIELDS),
        axis=1,
    )
    return frame


def optional_secret(name: str, default: str = "") -> str:
    if name in st.secrets:
        return str(st.secrets[name]).strip()
    return default


def supports_oidc() -> bool:
    return hasattr(st, "login") and hasattr(st, "logout") and hasattr(st, "user")


def normalize_email_list(value: str) -> set[str]:
    return {item.strip().lower() for item in str(value or "").split(",") if item.strip()}


def is_logged_in() -> bool:
    if not supports_oidc():
        return False
    return bool(getattr(st.user, "is_logged_in", False))


def current_user_email() -> str:
    if not is_logged_in():
        return ""
    for key in ("email", "mail", "preferred_username"):
        value = getattr(st.user, key, None)
        if value:
            return str(value).strip().lower()
    if hasattr(st.user, "to_dict"):
        values = st.user.to_dict()
        for key in ("email", "mail", "preferred_username"):
            if values.get(key):
                return str(values[key]).strip().lower()
    return ""


def is_admin() -> bool:
    admin_emails = normalize_email_list(optional_secret("ADMIN_EMAILS", store.DEFAULT_ADMIN_EMAIL))
    return bool(current_user_email()) and current_user_email() in admin_emails


def apply_filters(
    frame: pd.DataFrame,
    query: str,
    types: Iterable[str],
    subtypes: Iterable[str],
    ssubtypes: Iterable[str],
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
    if ssubtypes:
        filtered = filtered[filtered["SSubtype"].isin(ssubtypes)]
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
    ssubtype_count = frame["SSubtype"].replace("", pd.NA).dropna().nunique() if not frame.empty else 0
    country_count = frame["Country"].nunique() if not frame.empty else 0
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Communities", f"{len(frame):,}")
    col2.metric("Types", f"{type_count:,}")
    col3.metric("Subtypes", f"{subtype_count:,}")
    col4.metric("Countries", f"{country_count:,}", delta=f"{ssubtype_count:,} ssubtypes")


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
    lineage = [row["Type"], row["Subtype"]]
    if str(row.get("SSubtype", "")).strip():
        lineage.append(row["SSubtype"])
    lineage.append(row["Country"])
    st.caption(" | ".join(lineage))

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


def render_auth_panel() -> None:
    st.subheader("Sign in")
    if not supports_oidc():
        st.caption("Google sign-in will appear here when Streamlit OIDC is configured for this deployment.")
        return
    if not is_logged_in():
        if st.button("Sign in with Google"):
            st.login()
        st.caption("Admin functions remain hidden until an approved Google account is signed in.")
        return
    email = current_user_email() or "Signed-in user"
    st.success(f"Signed in as {email}")
    if st.button("Sign out"):
        st.logout()


def render_platform_snapshot(all_rows: pd.DataFrame) -> None:
    summary = store.coverage_summary()
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Communities in database", f"{summary['total_communities']:,}")
    col2.metric("Countries represented", f"{summary['country_count']:,}")
    col3.metric("Religious communities", f"{summary['religious_count']:,}")
    col4.metric("Subtype families", f"{summary['subtype_count']:,}", delta=f"{summary['ssubtype_count']:,} ssubtypes")

    st.markdown("**Communities in the database thus far**")
    left, right = st.columns(2)
    with left:
        type_counts = all_rows["Type"].value_counts().head(12)
        if not type_counts.empty:
            st.bar_chart(type_counts)
    with right:
        country_counts = all_rows["Country"].value_counts().head(12)
        if not country_counts.empty:
            st.bar_chart(country_counts)


def render_suggest_tab(rows: pd.DataFrame) -> None:
    st.subheader("Suggest other communities")
    weekly_count = store.count_weekly_suggestions()
    remaining = max(0, 50 - weekly_count)
    st.caption(
        f"This public intake form is capped at 50 community suggestions per week. "
        f"{remaining} submission{'s' if remaining != 1 else ''} remain in the current week."
    )

    digest_email = store.get_setting("suggestion_digest_email", default=store.DEFAULT_ADMIN_EMAIL)
    email_service = store.get_setting("suggestion_email_service", default="gmail")
    st.info(
        f"Suggestions enter a pending review queue and are summarized weekly to the administrator via {email_service}. "
        f"Current destination: {digest_email}."
    )

    with st.form("community-suggestion-form", clear_on_submit=True):
        submitter_name = st.text_input("Your name")
        submitter_email = st.text_input("Your email")
        organization_name = st.text_input("Community or organization name")
        col1, col2 = st.columns(2)
        with col1:
            country = st.text_input("Country")
            type_value = st.selectbox("Type", sorted(rows["Type"].dropna().unique().tolist() + ["Religious"]))
        with col2:
            subtype = st.text_input("Subtype")
            ssubtype = st.text_input("SSubtype (optional)")
        website = st.text_input("Website")
        reason = st.text_area(
            "Why should this be added?",
            placeholder="Tell us what this community does, why it matters, and how it fits the C2A2 platform.",
        )
        submitted = st.form_submit_button("Submit suggestion")

    if submitted:
        missing = [
            label
            for label, value in (
                ("name", submitter_name),
                ("email", submitter_email),
                ("organization", organization_name),
                ("country", country),
                ("type", type_value),
                ("subtype", subtype),
                ("website", website),
                ("reason", reason),
            )
            if not str(value).strip()
        ]
        if missing:
            st.error(f"Please complete the following fields: {', '.join(missing)}.")
        else:
            try:
                result = store.create_suggestion(
                    submitter_name=submitter_name,
                    submitter_email=submitter_email,
                    organization_name=organization_name,
                    country=country,
                    type=type_value,
                    subtype=subtype,
                    ssubtype=ssubtype,
                    website=website,
                    reason=reason,
                )
                st.success(
                    f"Suggestion received. Queue ID {result['suggestion_id']} was added for weekly review. "
                    f"Weekly usage: {result['weekly_count_after_submit']}/{result['weekly_cap']}."
                )
            except ValueError as error:
                st.error(str(error))

    st.markdown("**What we are prioritizing now**")
    st.markdown(
        """
        - Small religious communities with substantial public presence
        - Civic consultancies and practical community-support organizations
        - Communities that are not primarily educational institutions
        - High-quality additions that improve country coverage over time
        """
    )

    if is_admin():
        st.divider()
        st.subheader("Admin review queue")
        pending = store.list_pending_suggestions(limit=100)
        st.caption(f"{len(pending):,} suggestions are currently pending review.")
        if pending.empty:
            st.info("No pending suggestions right now.")
        else:
            st.dataframe(pending, use_container_width=True, hide_index=True)

        with st.expander("Admin notification settings"):
            current_email = st.text_input("Weekly digest destination", value=digest_email)
            current_service = st.selectbox("Notification service", ["gmail", "resend", "smtp"], index=["gmail", "resend", "smtp"].index(email_service) if email_service in ["gmail", "resend", "smtp"] else 0)
            if st.button("Save admin notification settings"):
                store.set_setting("suggestion_digest_email", current_email)
                store.set_setting("suggestion_email_service", current_service)
                st.success("Admin notification settings saved.")


def point_offset(seed: str, scale: float = 0.9) -> tuple[float, float]:
    digest = hashlib.md5(seed.encode("utf-8")).digest()
    lat_raw = int.from_bytes(digest[:4], "big") / 0xFFFFFFFF
    lon_raw = int.from_bytes(digest[4:8], "big") / 0xFFFFFFFF
    lat_offset = (lat_raw - 0.5) * scale
    lon_offset = (lon_raw - 0.5) * scale
    return lat_offset, lon_offset


def build_map_frame(frame: pd.DataFrame) -> pd.DataFrame:
    map_rows = []
    for row in frame.to_dict(orient="records"):
        country = ALIASES.get(row["Country"], row["Country"])
        coords = COUNTRY_COORDINATES.get(country)
        if not coords:
            continue
        base_lat, base_lon = coords
        lat_offset, lon_offset = point_offset(row["Community_ID"], scale=1.1 if row["Country"] in {"Global", "Unspecified"} else 0.6)
        lineage = " / ".join([value for value in [row["Type"], row["Subtype"], row.get("SSubtype", "")] if str(value).strip()])
        map_rows.append(
            {
                "Community_ID": row["Community_ID"],
                "Community_Name": row["Community_Name"],
                "Type": row["Type"],
                "Subtype": row["Subtype"],
                "SSubtype": row.get("SSubtype", ""),
                "Country": row["Country"],
                "Verified_Link": row["Verified_Link"],
                "Problem_Statement": row["Problem_Statement"],
                "Resource_Statement": row["Resource_Statement"],
                "Solution_Statement": row["Solution_Statement"],
                "tooltip_lineage": lineage,
                "lat": base_lat + lat_offset,
                "lon": base_lon + lon_offset,
            }
        )
    return pd.DataFrame(map_rows)


def render_map_tab(frame: pd.DataFrame) -> None:
    st.subheader("Global map")
    st.caption(
        "This first map view places each listed community near its country centroid. "
        "Points separate as you zoom because each community gets a stable local offset."
    )
    map_frame = build_map_frame(frame)
    if map_frame.empty:
        st.info("No mappable communities are present in the current slice.")
        return

    view_state = pdk.ViewState(latitude=20, longitude=5, zoom=1.1, pitch=0)
    layer = pdk.Layer(
        "ScatterplotLayer",
        data=map_frame,
        get_position="[lon, lat]",
        get_fill_color="[24, 126, 214, 190]",
        get_line_color="[255, 255, 255, 180]",
        line_width_min_pixels=1,
        stroked=True,
        pickable=True,
        radius_min_pixels=5,
        radius_max_pixels=12,
        get_radius=90000,
    )
    deck = pdk.Deck(
        map_style="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
        initial_view_state=view_state,
        layers=[layer],
        tooltip={
            "html": (
                "<b>{Community_Name}</b><br/>"
                "{tooltip_lineage}<br/>"
                "{Country}<br/>"
                "<a href='{Verified_Link}' target='_blank'>Open website</a><br/>"
                "<small>See this community's PRS below in the table.</small>"
            ),
            "style": {
                "backgroundColor": "#111827",
                "color": "#f8fafc",
            },
        },
    )
    st.pydeck_chart(deck, use_container_width=True)

    st.markdown("**Mapped communities in the current slice**")
    st.dataframe(
        map_frame[["Community_ID", "Community_Name", "Type", "Subtype", "SSubtype", "Country", "Verified_Link"]],
        use_container_width=True,
        hide_index=True,
        column_config={
            "Verified_Link": st.column_config.LinkColumn("Website"),
        },
    )
    st.info("A dedicated internal reader pane and tab-specific AI companion will be layered onto this map workflow in a later platform slice.")


def render_prs_tab(frame: pd.DataFrame) -> None:
    st.subheader("Problem-Resource-Solution triplets")
    st.caption("Search and compare the PRS framing across the current community slice.")

    prs_search = st.text_input("Search PRS content", key="prs_search", placeholder="mistrust, mentorship, open standards")
    focus = st.radio("Focus", ["All", "Problems", "Resources", "Solutions"], horizontal=True)
    searchable = frame.copy()
    searchable["prs_blob"] = searchable.apply(
        lambda row: " ".join(
            normalize_text(row.get(column, ""))
            for column in ["Problem_Statement", "Resource_Statement", "Solution_Statement", "Community_Name", "Subtype", "SSubtype"]
        ),
        axis=1,
    )
    if prs_search.strip():
        tokens = tokenize_query(prs_search)
        if tokens:
            searchable = searchable[searchable["prs_blob"].apply(lambda blob: all(token in blob for token in tokens))]

    st.markdown(f"Showing **{len(searchable):,}** PRS records in the current slice.")
    display = searchable[[
        "Community_ID",
        "Community_Name",
        "Type",
        "Subtype",
        "SSubtype",
        "Problem_Statement",
        "Resource_Statement",
        "Solution_Statement",
        "Verified_Link",
    ]].copy()

    if focus == "Problems":
        display = display[["Community_ID", "Community_Name", "Type", "Subtype", "SSubtype", "Problem_Statement", "Verified_Link"]]
    elif focus == "Resources":
        display = display[["Community_ID", "Community_Name", "Type", "Subtype", "SSubtype", "Resource_Statement", "Verified_Link"]]
    elif focus == "Solutions":
        display = display[["Community_ID", "Community_Name", "Type", "Subtype", "SSubtype", "Solution_Statement", "Verified_Link"]]

    st.dataframe(
        display,
        use_container_width=True,
        hide_index=True,
        column_config={
            "Verified_Link": st.column_config.LinkColumn("Website"),
            "Problem_Statement": st.column_config.TextColumn("Problem", width="large"),
            "Resource_Statement": st.column_config.TextColumn("Resource", width="large"),
            "Solution_Statement": st.column_config.TextColumn("Solution", width="large"),
        },
    )

    with st.expander("PRS comparison notes"):
        st.markdown(
            """
            This tab is the beginning of the comparison workflow for communities across articulated
            problems, resources, and solutions. A later platform slice will add a tab-aware AI guide
            for clustering, contrast, and collaboration opportunities directly within the PRS surface.
            """
        )


def main() -> None:
    st.set_page_config(
        page_title="C2A2 Community Explorer",
        page_icon="🧭",
        layout="wide",
    )

    st.title("C2A2 Community Explorer")
    st.caption("Public Streamlit prototype for the emerging C2A2 platform.")

    rows = load_rows()

    with st.sidebar:
        st.header("Filters")
        search = st.text_input("Exact-text search", placeholder="youth civic action")
        types = st.multiselect("Type", sorted(rows["Type"].dropna().unique()))
        subtype_options = sorted(rows["Subtype"].dropna().unique())
        subtypes = st.multiselect("Subtype", subtype_options)
        ssubtype_options = sorted([value for value in rows["SSubtype"].dropna().unique() if str(value).strip()])
        ssubtypes = st.multiselect("SSubtype", ssubtype_options)
        countries = st.multiselect("Country", sorted(rows["Country"].dropna().unique()))
        sources = st.multiselect("Source directory", sorted(rows["Source_Directory"].dropna().unique()))
        st.divider()
        st.caption(
            "This public version is read-only by default, uses the current C2A2 dataset as its source of truth, "
            "and is being built so that future community-specific explorers can live within the same broader platform."
        )
        render_auth_panel()

    filtered = apply_filters(rows, search, types, subtypes, ssubtypes, countries, sources)

    explorer_tab, map_tab, prs_tab, assistant_tab, notes_tab, suggest_tab = st.tabs(
        ["Explorer", "Map", "PRS Triplets", "Assistant", "About C2A2", "Suggest Other Communities"]
    )

    with explorer_tab:
        render_platform_snapshot(rows)
        render_metrics(filtered)
        st.markdown(f"Showing **{len(filtered):,}** of **{len(rows):,}** total communities.")
        render_charts(filtered)
        st.subheader("Current slice")
        display_columns = [
            "Community_ID",
            "Community_Name",
            "Type",
            "Subtype",
            "SSubtype",
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

    with map_tab:
        render_map_tab(filtered)

    with prs_tab:
        render_prs_tab(filtered)

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
            - a first global map view using country-level placement with stable local offsets
            - a PRS Triplets tab for comparing articulated problems, resources, and solutions
            - filters across type, subtype, ssubtype, geography, and source
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

    with suggest_tab:
        render_suggest_tab(rows)


if __name__ == "__main__":
    main()
