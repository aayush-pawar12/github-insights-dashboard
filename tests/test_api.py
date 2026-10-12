"""Tests for the dashboard: the DB layer, the GitHub transform, and the HTTP API.

The GitHub network call is monkeypatched so tests are fast and offline. CRUD
tests run against a throwaway SQLite file per test session.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db
import app as flask_app


# ----------------------------- fixtures -----------------------------

@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    path = str(tmp_path / "test.db")
    monkeypatch.setattr(db, "DB_PATH", path)
    db.init_db(path)
    return path


@pytest.fixture
def client(temp_db):
    flask_app.app.config.update(TESTING=True)
    return flask_app.app.test_client()


FAKE_REPOS = [
    {"name": "alpha", "full_name": "acme/alpha", "html_url": "u/alpha",
     "stargazers_count": 100, "forks_count": 10, "open_issues_count": 2,
     "language": "Python", "pushed_at": "2026-02-01T00:00:00Z",
     "updated_at": "2026-02-01T00:00:00Z", "description": "first", "fork": False},
    {"name": "beta", "full_name": "acme/beta", "html_url": "u/beta",
     "stargazers_count": 300, "forks_count": 40, "open_issues_count": 5,
     "language": "JavaScript", "pushed_at": "2026-03-01T00:00:00Z",
     "updated_at": "2026-03-01T00:00:00Z", "description": "", "fork": False},
    {"name": "aforked", "full_name": "acme/aforked", "html_url": "u/f",
     "stargazers_count": 999, "forks_count": 1, "open_issues_count": 0,
     "language": "C", "pushed_at": "2026-01-01T00:00:00Z",
     "updated_at": "2026-01-01T00:00:00Z", "description": "", "fork": True},
]


# ----------------------------- DB layer -----------------------------

def test_create_and_get(temp_db):
    item = db.create_insight("acme/alpha", "watch stars", "High", "u/alpha")
    assert item["id"] > 0
    assert item["priority"] == "High"
    assert db.get_insight(item["id"])["note"] == "watch stars"


def test_validation_rejects_bad_priority(temp_db):
    with pytest.raises(db.ValidationError):
        db.create_insight("x", "note", "Urgent")


def test_validation_rejects_empty_note(temp_db):
    with pytest.raises(db.ValidationError):
        db.create_insight("x", "   ", "Low")


def test_update_and_delete(temp_db):
    item = db.create_insight("acme/alpha", "old", "Low")
    upd = db.update_insight(item["id"], "new note", "High")
    assert upd["note"] == "new note" and upd["priority"] == "High"
    assert upd["updated_at"] is not None
    assert db.delete_insight(item["id"]) is True
    assert db.get_insight(item["id"]) is None


def test_filter_and_search(temp_db):
    db.create_insight("acme/alpha", "stars climbing", "High")
    db.create_insight("acme/beta", "quiet repo", "Low")
    assert len(db.list_insights(priority="High")) == 1
    assert len(db.list_insights(query="quiet")) == 1
    assert len(db.list_insights()) == 2


# --------------------------- GitHub transform ---------------------------

def test_transform_skips_forks_and_aggregates():
    out = flask_app._transform("acme", FAKE_REPOS)
    assert out["metrics"]["repos"] == 2            # fork excluded
    assert out["metrics"]["stars"] == 400
    assert out["metrics"]["forks"] == 50
    assert out["insights"]["top_repo"] == "acme/beta"   # sorted by stars
    assert out["insights"]["top_language"] in ("Python", "JavaScript")
    assert out["metrics"]["avg_stars"] == 200.0


# ----------------------------- HTTP API -----------------------------

def test_github_route_success(client, monkeypatch):
    class FakeResp:
        status_code = 200
        text = ""
        def json(self): return FAKE_REPOS
    monkeypatch.setattr(flask_app.requests, "get", lambda *a, **k: FakeResp())
    r = client.get("/api/github/acme")
    assert r.status_code == 200
    assert r.get_json()["metrics"]["repos"] == 2


def test_github_route_404(client, monkeypatch):
    class FakeResp:
        status_code = 404
        text = "Not Found"
        def json(self): return {}
    monkeypatch.setattr(flask_app.requests, "get", lambda *a, **k: FakeResp())
    r = client.get("/api/github/nobody")
    assert r.status_code == 404
    assert "No GitHub account" in r.get_json()["error"]


def test_crud_via_http(client):
    # Create
    r = client.post("/api/insights", json={
        "item_name": "acme/alpha", "note": "track this", "priority": "Medium"})
    assert r.status_code == 201
    iid = r.get_json()["id"]
    # Read
    r = client.get("/api/insights")
    assert r.get_json()["stats"]["total"] == 1
    # Update
    r = client.put(f"/api/insights/{iid}", json={"note": "changed", "priority": "High"})
    assert r.status_code == 200 and r.get_json()["priority"] == "High"
    # Delete
    assert client.delete(f"/api/insights/{iid}").status_code == 200
    assert client.get("/api/insights").get_json()["stats"]["total"] == 0


def test_create_rejects_invalid(client):
    r = client.post("/api/insights", json={"item_name": "x", "note": "", "priority": "High"})
    assert r.status_code == 400
