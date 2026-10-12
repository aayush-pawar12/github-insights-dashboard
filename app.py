"""API Insights Dashboard -- Flask backend.

Responsibilities:
  * Proxy + transform the GitHub REST API into dashboard-ready metrics
    (so the browser never deals with raw, paginated API noise).
  * Expose a small CRUD API over saved insights backed by SQLite.
  * Serve the static single-page dashboard.

Why proxy GitHub server-side instead of calling it from the browser?
  - One place to shape the data and compute derived metrics.
  - Graceful, uniform error handling (rate limits, unknown users, outages).
  - Keeps an optional GITHUB_TOKEN secret on the server, never in the page.
"""

from __future__ import annotations

import os

import requests
from flask import Flask, jsonify, request, send_from_directory

import db

app = Flask(__name__, static_folder="static", static_url_path="")

GITHUB_API = "https://api.github.com"
# Optional: set GITHUB_TOKEN to raise the rate limit from 60 to 5000 req/hr.
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
HTTP_TIMEOUT = 10


# ---------------------------------------------------------------------------
# GitHub fetching + transformation
# ---------------------------------------------------------------------------

def _gh_headers() -> dict:
    headers = {"Accept": "application/vnd.github+json",
               "User-Agent": "api-insights-dashboard"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return headers


def fetch_github(account: str) -> tuple[dict | None, str | None, int]:
    """Return (payload, error_message, status_code).

    Exactly one of payload / error_message is set. The status code is what the
    dashboard route should return to the browser.
    """
    account = account.strip().lstrip("@/")
    if not account:
        return None, "Please enter a GitHub username or organisation.", 400

    try:
        resp = requests.get(
            f"{GITHUB_API}/users/{account}/repos",
            params={"per_page": 100, "sort": "updated", "type": "owner"},
            headers=_gh_headers(), timeout=HTTP_TIMEOUT)
    except requests.exceptions.Timeout:
        return None, "GitHub took too long to respond. Try again.", 504
    except requests.exceptions.RequestException:
        return None, "Could not reach GitHub. Check your connection.", 502

    if resp.status_code == 404:
        return None, f"No GitHub account found named '{account}'.", 404
    if resp.status_code == 403 and "rate limit" in resp.text.lower():
        return None, ("GitHub rate limit reached. Set a GITHUB_TOKEN or wait "
                      "a few minutes before refreshing."), 429
    if resp.status_code != 200:
        return None, f"GitHub returned an unexpected error ({resp.status_code}).", 502

    return _transform(account, resp.json()), None, 200


def _transform(account: str, repos: list[dict]) -> dict:
    """Turn raw repo JSON into the metrics + rows the dashboard shows."""
    rows = []
    languages: dict[str, int] = {}
    total_stars = total_forks = total_issues = 0

    for r in repos:
        if r.get("fork"):
            continue                     # skip forks: they're not this account's work
        stars = r.get("stargazers_count", 0)
        forks = r.get("forks_count", 0)
        issues = r.get("open_issues_count", 0)
        lang = r.get("language") or "Other"
        total_stars += stars
        total_forks += forks
        total_issues += issues
        languages[lang] = languages.get(lang, 0) + 1
        rows.append({
            "name": r["name"],
            "full_name": r["full_name"],
            "url": r["html_url"],
            "stars": stars,
            "forks": forks,
            "issues": issues,
            "language": lang,
            "updated_at": r.get("pushed_at") or r.get("updated_at"),
            "description": (r.get("description") or "").strip(),
        })

    rows.sort(key=lambda x: x["stars"], reverse=True)
    repo_count = len(rows)

    # Derived insights -- the "don't just dump raw fields" part.
    top_repo = rows[0] if rows else None
    most_recent = max(rows, key=lambda x: x["updated_at"] or "") if rows else None
    avg_stars = round(total_stars / repo_count, 1) if repo_count else 0
    top_language = max(languages, key=languages.get) if languages else None

    return {
        "account": account,
        "metrics": {
            "repos": repo_count,
            "stars": total_stars,
            "forks": total_forks,
            "open_issues": total_issues,
            "avg_stars": avg_stars,
        },
        "insights": {
            "top_repo": top_repo["full_name"] if top_repo else None,
            "top_repo_stars": top_repo["stars"] if top_repo else 0,
            "most_recent": most_recent["name"] if most_recent else None,
            "most_recent_at": most_recent["updated_at"] if most_recent else None,
            "top_language": top_language,
            "language_count": len(languages),
        },
        "languages": dict(sorted(languages.items(),
                                 key=lambda kv: kv[1], reverse=True)),
        "top_repos": rows[:8],           # for the bar chart
        "repos": rows,                   # full table
    }


# ---------------------------------------------------------------------------
# Routes: dashboard data
# ---------------------------------------------------------------------------

@app.get("/api/github/<account>")
def github(account: str):
    payload, error, status = fetch_github(account)
    if error:
        return jsonify({"error": error}), status
    return jsonify(payload), 200


# ---------------------------------------------------------------------------
# Routes: saved insights (CRUD)
# ---------------------------------------------------------------------------

@app.get("/api/insights")
def list_insights():
    items = db.list_insights(
        priority=request.args.get("priority"),
        query=request.args.get("q"),
        order=request.args.get("order", "newest"))
    return jsonify({"insights": items, "stats": db.stats()})


@app.post("/api/insights")
def create_insight():
    data = request.get_json(silent=True) or {}
    try:
        item = db.create_insight(
            item_name=data.get("item_name", ""),
            note=data.get("note", ""),
            priority=data.get("priority", ""),
            item_url=data.get("item_url", ""))
    except db.ValidationError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(item), 201


@app.put("/api/insights/<int:insight_id>")
def update_insight(insight_id: int):
    data = request.get_json(silent=True) or {}
    try:
        item = db.update_insight(insight_id, note=data.get("note", ""),
                                 priority=data.get("priority", ""))
    except db.ValidationError as e:
        return jsonify({"error": str(e)}), 400
    if item is None:
        return jsonify({"error": "Insight not found."}), 404
    return jsonify(item), 200


@app.delete("/api/insights/<int:insight_id>")
def delete_insight(insight_id: int):
    if db.delete_insight(insight_id):
        return jsonify({"ok": True}), 200
    return jsonify({"error": "Insight not found."}), 404


# ---------------------------------------------------------------------------
# Static dashboard
# ---------------------------------------------------------------------------

@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


def create_app():
    db.init_db()
    return app


if __name__ == "__main__":
    db.init_db()
    app.run(host="127.0.0.1", port=5000, debug=True)
