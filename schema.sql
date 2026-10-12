-- Database schema for the API Insights Dashboard.
--
-- One table is all the application needs today, but it is shaped so new
-- features slot in without a rebuild:
--   * `source` lets a second API (weather, movies, ...) reuse the same table.
--   * `item_name` / `item_url` identify the observed item generically, not as
--     "repo_id", so the schema is not GitHub-specific.
--   * `created_at` / `updated_at` support an activity log and edit history.

CREATE TABLE IF NOT EXISTS insights (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source     TEXT    NOT NULL DEFAULT 'github',      -- which API the item came from
    item_name  TEXT    NOT NULL,                       -- e.g. "facebook/react"
    item_url   TEXT,                                   -- link back to the item
    note       TEXT    NOT NULL,                       -- the user's observation
    priority   TEXT    NOT NULL                         -- High / Medium / Low
               CHECK (priority IN ('High', 'Medium', 'Low')),
    created_at TEXT    NOT NULL,                        -- ISO-8601 UTC
    updated_at TEXT                                     -- set on edit, else NULL
);

-- Saved insights are most often browsed newest-first and filtered by priority,
-- so an index on those two columns keeps the list view fast as it grows.
CREATE INDEX IF NOT EXISTS idx_insights_created  ON insights (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_priority ON insights (priority);
