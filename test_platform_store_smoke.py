import os
import tempfile

import platform_store as store


def main() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        db_path = os.path.join(temp_dir, "c2a2_test.db")
        result = store.initialize_store(db_path)
        assert result["db_path"].endswith("c2a2_test.db")

        summary = store.coverage_summary(db_path=db_path)
        assert summary["total_communities"] >= 800
        assert summary["country_count"] >= 80
        assert summary["subtype_count"] >= 10

        submit_result = store.create_suggestion(
            db_path=db_path,
            submitter_name="Smoke Test",
            submitter_email="smoke@example.com",
            organization_name="Test Religious Community",
            country="United States",
            type="Religious",
            subtype="Catholic learning community",
            ssubtype="Lay formation group",
            website="https://example.org",
            reason="Smoke test suggestion",
        )
        assert submit_result["weekly_count_after_submit"] == 1

        pending = store.list_pending_suggestions(db_path=db_path, limit=10)
        assert len(pending) == 1
        assert pending.iloc[0]["organization_name"] == "Test Religious Community"
        assert pending.iloc[0]["ssubtype"] == "Lay formation group"

        digest_email = store.get_setting("suggestion_digest_email", db_path=db_path)
        assert digest_email == store.DEFAULT_ADMIN_EMAIL

    print("Platform store smoke test passed.")


if __name__ == "__main__":
    main()
