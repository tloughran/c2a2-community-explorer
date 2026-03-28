from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

import pandas as pd


APP_DIR = Path(__file__).resolve().parent
DEFAULT_DB_PATH = APP_DIR / "c2a2_platform.db"
DATA_PATH = APP_DIR / "community_data.json"
DEFAULT_TENANT = "c2a2-public"
DEFAULT_ADMIN_EMAIL = "c2a2.thomas.loughran@gmail.com"


@contextmanager
def connect(db_path: str | Path = DEFAULT_DB_PATH) -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(str(db_path))
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def ensure_schema(db_path: str | Path = DEFAULT_DB_PATH) -> None:
    with connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS platform_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS communities (
                community_id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'approved',
                type TEXT NOT NULL,
                subtype TEXT NOT NULL,
                ssubtype TEXT NOT NULL DEFAULT '',
                community_name TEXT NOT NULL,
                country TEXT NOT NULL,
                country_source TEXT,
                verified_link TEXT,
                verified_link_host TEXT,
                source_link TEXT,
                source_directory TEXT,
                email_contact TEXT,
                email_retrieval_note TEXT,
                narrative_description TEXT,
                narrative_word_count INTEGER DEFAULT 0,
                problem_statement TEXT,
                resource_statement TEXT,
                solution_statement TEXT,
                prs_triplet_count INTEGER DEFAULT 0,
                verification_method TEXT,
                narrative_grounding TEXT,
                latitude REAL,
                longitude REAL,
                entry_date TEXT,
                entered_by TEXT,
                entry_method TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_communities_tenant_status
                ON communities (tenant_id, status);
            CREATE INDEX IF NOT EXISTS idx_communities_country
                ON communities (country);
            CREATE INDEX IF NOT EXISTS idx_communities_type_subtype
                ON communities (type, subtype, ssubtype);

            CREATE TABLE IF NOT EXISTS community_suggestions (
                suggestion_id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                submitted_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                submitter_name TEXT NOT NULL,
                submitter_email TEXT NOT NULL,
                organization_name TEXT NOT NULL,
                country TEXT NOT NULL,
                type TEXT NOT NULL,
                subtype TEXT NOT NULL,
                ssubtype TEXT NOT NULL DEFAULT '',
                website TEXT NOT NULL,
                reason TEXT NOT NULL,
                review_notes TEXT NOT NULL DEFAULT '',
                source_context TEXT NOT NULL DEFAULT 'public-form'
            );

            CREATE INDEX IF NOT EXISTS idx_suggestions_status_submitted
                ON community_suggestions (status, submitted_at);

            CREATE TABLE IF NOT EXISTS agent_runs (
                run_id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                agent_name TEXT NOT NULL,
                run_started_at TEXT NOT NULL,
                run_finished_at TEXT,
                status TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                details_json TEXT NOT NULL DEFAULT '{}'
            );
            """
        )
        now = utc_now()
        connection.execute(
            """
            INSERT INTO platform_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO NOTHING
            """,
            ("suggestion_digest_email", DEFAULT_ADMIN_EMAIL, now),
        )
        connection.execute(
            """
            INSERT INTO platform_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO NOTHING
            """,
            ("suggestion_email_service", "gmail", now),
        )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def seed_communities_from_json(
    db_path: str | Path = DEFAULT_DB_PATH,
    data_path: str | Path = DATA_PATH,
    tenant_id: str = DEFAULT_TENANT,
) -> int:
    ensure_schema(db_path)
    rows = json.loads(Path(data_path).read_text())
    inserted = 0
    now = utc_now()
    with connect(db_path) as connection:
        current_count = connection.execute("SELECT COUNT(*) AS count FROM communities").fetchone()["count"]
        if current_count:
            return 0
        for row in rows:
            connection.execute(
                """
                INSERT INTO communities (
                    community_id, tenant_id, status, type, subtype, ssubtype, community_name, country,
                    country_source, verified_link, verified_link_host, source_link, source_directory,
                    email_contact, email_retrieval_note, narrative_description, narrative_word_count,
                    problem_statement, resource_statement, solution_statement, prs_triplet_count,
                    verification_method, narrative_grounding, latitude, longitude, entry_date,
                    entered_by, entry_method, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row.get("Community_ID"),
                    tenant_id,
                    "approved",
                    row.get("Type", ""),
                    row.get("Subtype", ""),
                    row.get("SSubtype", ""),
                    row.get("Community_Name", ""),
                    row.get("Country", ""),
                    row.get("Country_Source", ""),
                    row.get("Verified_Link", ""),
                    row.get("Verified_Link_Host", ""),
                    row.get("Source_Link", ""),
                    row.get("Source_Directory", ""),
                    row.get("Email_Contact", ""),
                    row.get("Email_Retrieval_Note", ""),
                    row.get("Narrative_Description", ""),
                    int(row.get("Narrative_Word_Count") or 0),
                    row.get("Problem_Statement", ""),
                    row.get("Resource_Statement", ""),
                    row.get("Solution_Statement", ""),
                    int(row.get("PRS_Triplet_Count") or 0),
                    row.get("Verification_Method", ""),
                    row.get("Narrative_Grounding", ""),
                    row.get("Latitude"),
                    row.get("Longitude"),
                    row.get("Entry_Date", ""),
                    row.get("Entered_By", ""),
                    row.get("Entry_Method", ""),
                    now,
                    now,
                ),
            )
            inserted += 1
    return inserted


def initialize_store(db_path: str | Path = DEFAULT_DB_PATH) -> dict[str, object]:
    ensure_schema(db_path)
    seeded = seed_communities_from_json(db_path)
    return {
        "db_path": str(db_path),
        "seeded_rows": seeded,
    }


def fetch_communities(
    db_path: str | Path = DEFAULT_DB_PATH,
    tenant_id: str = DEFAULT_TENANT,
    status: str = "approved",
) -> pd.DataFrame:
    initialize_store(db_path)
    with connect(db_path) as connection:
        frame = pd.read_sql_query(
            """
            SELECT
                community_id AS Community_ID,
                type AS Type,
                subtype AS Subtype,
                ssubtype AS SSubtype,
                community_name AS Community_Name,
                country AS Country,
                country_source AS Country_Source,
                verified_link AS Verified_Link,
                verified_link_host AS Verified_Link_Host,
                source_link AS Source_Link,
                source_directory AS Source_Directory,
                email_contact AS Email_Contact,
                email_retrieval_note AS Email_Retrieval_Note,
                narrative_description AS Narrative_Description,
                narrative_word_count AS Narrative_Word_Count,
                problem_statement AS Problem_Statement,
                resource_statement AS Resource_Statement,
                solution_statement AS Solution_Statement,
                prs_triplet_count AS PRS_Triplet_Count,
                verification_method AS Verification_Method,
                narrative_grounding AS Narrative_Grounding,
                latitude AS Latitude,
                longitude AS Longitude,
                entry_date AS Entry_Date,
                entered_by AS Entered_By,
                entry_method AS Entry_Method
            FROM communities
            WHERE tenant_id = ? AND status = ?
            ORDER BY community_name ASC, community_id ASC
            """,
            connection,
            params=(tenant_id, status),
        )
    if "SSubtype" not in frame.columns:
        frame["SSubtype"] = ""
    return frame


def week_window(reference: datetime | None = None) -> tuple[str, str]:
    current = reference or datetime.now(timezone.utc)
    start = (current - timedelta(days=current.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)
    return start.isoformat(), end.isoformat()


def count_weekly_suggestions(
    db_path: str | Path = DEFAULT_DB_PATH,
    tenant_id: str = DEFAULT_TENANT,
    reference: datetime | None = None,
) -> int:
    ensure_schema(db_path)
    start, end = week_window(reference)
    with connect(db_path) as connection:
        row = connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM community_suggestions
            WHERE tenant_id = ? AND submitted_at >= ? AND submitted_at < ?
            """,
            (tenant_id, start, end),
        ).fetchone()
        return int(row["count"] if row else 0)


def create_suggestion(
    db_path: str | Path = DEFAULT_DB_PATH,
    tenant_id: str = DEFAULT_TENANT,
    *,
    submitter_name: str,
    submitter_email: str,
    organization_name: str,
    country: str,
    type: str,
    subtype: str,
    ssubtype: str,
    website: str,
    reason: str,
    weekly_cap: int = 50,
) -> dict[str, object]:
    ensure_schema(db_path)
    current_count = count_weekly_suggestions(db_path, tenant_id)
    if current_count >= weekly_cap:
        raise ValueError("The public suggestion cap for this week has been reached. Please try again next week.")
    submitted_at = utc_now()
    with connect(db_path) as connection:
        cursor = connection.execute(
            """
            INSERT INTO community_suggestions (
                tenant_id, submitted_at, status, submitter_name, submitter_email,
                organization_name, country, type, subtype, ssubtype, website, reason
            ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tenant_id,
                submitted_at,
                submitter_name.strip(),
                submitter_email.strip(),
                organization_name.strip(),
                country.strip(),
                type.strip(),
                subtype.strip(),
                ssubtype.strip(),
                website.strip(),
                reason.strip(),
            ),
        )
        suggestion_id = int(cursor.lastrowid)
    return {
        "suggestion_id": suggestion_id,
        "submitted_at": submitted_at,
        "weekly_count_after_submit": current_count + 1,
        "weekly_cap": weekly_cap,
    }


def list_pending_suggestions(
    db_path: str | Path = DEFAULT_DB_PATH,
    tenant_id: str = DEFAULT_TENANT,
    limit: int = 100,
) -> pd.DataFrame:
    ensure_schema(db_path)
    with connect(db_path) as connection:
        return pd.read_sql_query(
            """
            SELECT
                suggestion_id,
                submitted_at,
                status,
                submitter_name,
                submitter_email,
                organization_name,
                country,
                type,
                subtype,
                ssubtype,
                website,
                reason,
                review_notes
            FROM community_suggestions
            WHERE tenant_id = ? AND status = 'pending'
            ORDER BY submitted_at DESC
            LIMIT ?
            """,
            connection,
            params=(tenant_id, limit),
        )


def get_setting(
    key: str,
    db_path: str | Path = DEFAULT_DB_PATH,
    default: str = "",
) -> str:
    ensure_schema(db_path)
    with connect(db_path) as connection:
        row = connection.execute(
            "SELECT value FROM platform_settings WHERE key = ?",
            (key,),
        ).fetchone()
        return str(row["value"]) if row else default


def set_setting(
    key: str,
    value: str,
    db_path: str | Path = DEFAULT_DB_PATH,
) -> None:
    ensure_schema(db_path)
    with connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO platform_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
            """,
            (key, value, utc_now()),
        )


def coverage_summary(
    db_path: str | Path = DEFAULT_DB_PATH,
    tenant_id: str = DEFAULT_TENANT,
) -> dict[str, object]:
    frame = fetch_communities(db_path=db_path, tenant_id=tenant_id, status="approved")
    religious_count = int((frame["Type"] == "Religious").sum()) if not frame.empty else 0
    civic_like_count = int(frame["Subtype"].str.contains("consult", case=False, na=False).sum()) if not frame.empty else 0
    return {
        "total_communities": int(len(frame)),
        "country_count": int(frame["Country"].nunique()) if not frame.empty else 0,
        "type_count": int(frame["Type"].nunique()) if not frame.empty else 0,
        "subtype_count": int(frame["Subtype"].nunique()) if not frame.empty else 0,
        "ssubtype_count": int(frame["SSubtype"].replace("", pd.NA).dropna().nunique()) if not frame.empty else 0,
        "religious_count": religious_count,
        "civic_consultancy_like_count": civic_like_count,
    }
