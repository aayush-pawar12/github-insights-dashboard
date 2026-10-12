"""SQLite data-access layer for saved insights.

Kept deliberately small and framework-free so it can be unit-tested on its own
and reused from any caller. Every query is parameterised (no string formatting
into SQL) to avoid injection.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("INSIGHTS_DB", os.path.join(HERE, "insights.db"))
SCHEMA_PATH = os.path.join(HERE, "schema.sql")

VALID_PRIORITIES = ("High", "Medium", "Low")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_conn(path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or DB_PATH)
    conn.row_factory = sqlite3.Row          # rows behave like dicts
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(path: str | None = None) -> None:
    """Create the schema if it does not exist yet."""
    with open(SCHEMA_PATH, encoding="utf-8") as fh:
        schema = fh.read()
    conn = get_conn(path)
    try:
        conn.executescript(schema)
        conn.commit()
    finally:
        conn.close()


class ValidationError(ValueError):
    """Raised when an insight payload is malformed."""


def _validate(note: str, priority: str) -> None:
    if not note or not note.strip():
        raise ValidationError("note is required")
    if priority not in VALID_PRIORITIES:
        raise ValidationError(
            f"priority must be one of {', '.join(VALID_PRIORITIES)}")


def create_insight(item_name: str, note: str, priority: str,
                   item_url: str = "", source: str = "github",
                   path: str | None = None) -> dict:
    if not item_name or not item_name.strip():
        raise ValidationError("item_name is required")
    _validate(note, priority)
    conn = get_conn(path)
    try:
        cur = conn.execute(
            """INSERT INTO insights
                   (source, item_name, item_url, note, priority, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (source, item_name.strip(), item_url.strip(), note.strip(),
             priority, _now()))
        conn.commit()
        return get_insight(cur.lastrowid, path)
    finally:
        conn.close()


def get_insight(insight_id: int, path: str | None = None) -> dict | None:
    conn = get_conn(path)
    try:
        row = conn.execute("SELECT * FROM insights WHERE id = ?",
                           (insight_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def list_insights(priority: str | None = None, query: str | None = None,
                  order: str = "newest", path: str | None = None) -> list[dict]:
    """Read insights, optionally filtered by priority and/or a search term."""
    sql = "SELECT * FROM insights"
    clauses, params = [], []
    if priority in VALID_PRIORITIES:
        clauses.append("priority = ?")
        params.append(priority)
    if query and query.strip():
        clauses.append("(item_name LIKE ? OR note LIKE ?)")
        like = f"%{query.strip()}%"
        params.extend([like, like])
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    # Whitelisted ordering only -- never interpolate user input into ORDER BY.
    orderings = {
        "newest": "created_at DESC",
        "oldest": "created_at ASC",
        "priority": "CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 "
                    "ELSE 2 END, created_at DESC",
    }
    sql += " ORDER BY " + orderings.get(order, orderings["newest"])
    conn = get_conn(path)
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def update_insight(insight_id: int, note: str, priority: str,
                   path: str | None = None) -> dict | None:
    _validate(note, priority)
    conn = get_conn(path)
    try:
        cur = conn.execute(
            """UPDATE insights
                  SET note = ?, priority = ?, updated_at = ?
                WHERE id = ?""",
            (note.strip(), priority, _now(), insight_id))
        conn.commit()
        if cur.rowcount == 0:
            return None
        return get_insight(insight_id, path)
    finally:
        conn.close()


def delete_insight(insight_id: int, path: str | None = None) -> bool:
    conn = get_conn(path)
    try:
        cur = conn.execute("DELETE FROM insights WHERE id = ?", (insight_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def stats(path: str | None = None) -> dict:
    """Small summary used by the saved-insights header."""
    conn = get_conn(path)
    try:
        total = conn.execute("SELECT COUNT(*) FROM insights").fetchone()[0]
        by_pri = {p: 0 for p in VALID_PRIORITIES}
        for row in conn.execute(
                "SELECT priority, COUNT(*) c FROM insights GROUP BY priority"):
            by_pri[row["priority"]] = row["c"]
        return {"total": total, "by_priority": by_pri}
    finally:
        conn.close()
