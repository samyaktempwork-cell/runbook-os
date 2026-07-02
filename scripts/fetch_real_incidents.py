"""
Fetch real closed bug issues from OSS infrastructure repos on GitHub.
Writes data/seed_incidents.json — replaces synthetic seed data.

Usage:
  # With GitHub token (recommended — 5000 req/hr):
  GITHUB_TOKEN=ghp_xxxx python scripts/fetch_real_incidents.py

  # Without token (60 req/hr — hits limit with large repos):
  python scripts/fetch_real_incidents.py

GitHub token: Settings → Developer settings → Personal access tokens → Tokens (classic)
Required scopes: none (public repos only, just helps with rate limits)
"""

import json
import os
import re
import time
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path
from collections import Counter

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

# (owner, repo, labels, count)
REPOS = [
    ("redis",          "redis",       ["class:bug"],        14),
    ("prometheus",     "prometheus",  ["kind/bug"],         12),
    ("etcd-io",        "etcd",        ["type/bug"],         12),
    ("hashicorp",      "vault",       ["bug"],              12),
    ("grafana",        "grafana",     ["type/bug"],         12),
    ("kubernetes",     "kubernetes",  ["kind/bug"],         14),
    ("grafana",        "loki",        ["type/bug"],         10),
    ("containerd",     "containerd",  ["kind/bug"],         10),
    ("cilium",         "cilium",      ["kind/bug"],         10),
    ("jaegertracing",  "jaeger",      ["bug"],               8),
    ("nats-io",        "nats-server", ["bug"],               8),
    ("cockroachdb",    "cockroach",   ["C-bug"],             8),
    ("vitessio",       "vitess",      ["type: bug"],         7),
    ("longhorn",       "longhorn",    ["kind/bug"],          7),
    ("argoproj",       "argo-cd",     ["bug"],               6),
    ("open-telemetry", "opentelemetry-collector", ["bug"],   6),
]

OUTPUT  = Path(__file__).parent.parent / "data" / "seed_incidents.json"


def gh_headers() -> dict:
    h = {"User-Agent": "RunbookOS-HackathonProject/1.0"}
    if GITHUB_TOKEN:
        h["Authorization"] = f"token {GITHUB_TOKEN}"
    return h


def gh_get(url: str):
    req = urllib.request.Request(url, headers=gh_headers())
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 403 or e.code == 429:
            reset = e.headers.get("X-RateLimit-Reset", "")
            wait = max(int(reset) - int(time.time()) + 5, 65) if reset else 65
            print(f"  Rate limited — sleeping {wait}s")
            time.sleep(wait)
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read())
        raise


def extract_body(raw: str, max_chars: int = 600) -> str:
    if not raw:
        return ""

    sections = {
        "describe": re.search(
            r"(?i)(?:describe the bug|what happened|what did you do)[^\n]*\n+([\s\S]+?)(?:\n##|\Z)", raw
        ),
        "reproduce": re.search(
            r"(?i)(?:steps to reproduce|to reproduce)[^\n]*\n+([\s\S]+?)(?:\n##|\Z)", raw
        ),
        "actual": re.search(
            r"(?i)(?:actual behavior|actual result|what actually happened)[^\n]*\n+([\s\S]+?)(?:\n##|\Z)", raw
        ),
    }

    useful = []
    for key in ("describe", "reproduce", "actual"):
        m = sections[key]
        if m:
            chunk = m.group(1).strip()
            if len(chunk) > 20:
                useful.append(chunk[:280])

    text = "\n".join(useful) if useful else raw

    text = re.sub(r"!\[.*?\]\(.*?\)", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"```[\s\S]*?```", "[snippet]", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip()

    if len(text) > max_chars:
        text = text[:max_chars].rsplit(".", 1)[0] + "."

    return text


def categorise(title: str, repo: str) -> str:
    t = title.lower()
    if any(w in t for w in ["memory", "oom", "leak", "heap"]):
        return f"{repo} / Memory"
    if any(w in t for w in ["crash", "panic", "segfault", "sigkill"]):
        return f"{repo} / Crash"
    if any(w in t for w in ["replica", "replication", "sync", "follower"]):
        return f"{repo} / Replication"
    if any(w in t for w in ["slow", "latency", "timeout", "performance", "throughput"]):
        return f"{repo} / Performance"
    if any(w in t for w in ["data loss", "corrupt", "inconsistent", "lost"]):
        return f"{repo} / Data Integrity"
    if any(w in t for w in ["auth", "token", "permission", "unauthori"]):
        return f"{repo} / Auth"
    if any(w in t for w in ["cluster", "leader", "election", "split"]):
        return f"{repo} / Clustering"
    if any(w in t for w in ["network", "connection", "socket", "tls", "cert"]):
        return f"{repo} / Networking"
    if any(w in t for w in ["disk", "storage", "wal", "raft", "snapshot"]):
        return f"{repo} / Storage"
    return repo


def format_incident(issue: dict, repo_label: str) -> dict:
    title  = issue.get("title", "").strip()
    body   = extract_body(issue.get("body") or "")
    number = issue.get("number")
    url    = issue.get("html_url", "")
    short  = repo_label.split("/")[1].title()

    text_parts = [f"[{repo_label} #{number}] {title}"]
    if body:
        text_parts.append(body)
    text_parts.append(f"Source: {url}")

    return {
        "id":          f"oss-{repo_label.replace('/', '-')}-{number}",
        "category":    categorise(title, short),
        "source_url":  url,
        "source_repo": repo_label,
        "text":        "\n\n".join(text_parts),
    }


def fetch_repo(owner: str, repo: str, labels: list, count: int) -> list:
    repo_label = f"{owner}/{repo}"
    print(f"  {repo_label} (want={count})")

    results, seen = [], set()

    for label in labels:
        if len(results) >= count:
            break
        url = (
            f"https://api.github.com/repos/{owner}/{repo}/issues"
            f"?state=closed&labels={urllib.parse.quote(label)}"
            f"&per_page={min(count * 4, 100)}&sort=updated&direction=desc"
        )
        try:
            issues = gh_get(url)
        except Exception as e:
            print(f"    Warning: {e}")
            continue

        for issue in issues:
            if len(results) >= count:
                break
            if issue.get("pull_request"):
                continue
            n = issue.get("number")
            if n in seen:
                continue
            if len((issue.get("body") or "").strip()) < 80:
                continue
            seen.add(n)
            results.append(format_incident(issue, repo_label))

        time.sleep(1)

    print(f"    → {len(results)}")
    return results


def main():
    if GITHUB_TOKEN:
        print(f"GitHub token: set (authenticated — 5000 req/hr)\n")
    else:
        print("GitHub token: NOT set (60 req/hr — may rate-limit on large repos)\n")
        print("Tip: GITHUB_TOKEN=ghp_xxx python scripts/fetch_real_incidents.py\n")

    print("Fetching real OSS incident data...\n")
    all_incidents = []

    for owner, repo, labels, count in REPOS:
        try:
            incidents = fetch_repo(owner, repo, labels, count)
            all_incidents.extend(incidents)
        except Exception as e:
            print(f"  Skipped {owner}/{repo}: {e}")
        time.sleep(2 if GITHUB_TOKEN else 4)

    print(f"\nTotal: {len(all_incidents)} real incidents\n")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(all_incidents, f, indent=2, ensure_ascii=False)

    print(f"Written → {OUTPUT}\n")
    print("Breakdown:")
    for repo, cnt in Counter(i["source_repo"] for i in all_incidents).items():
        print(f"  {repo:<35} {cnt}")

    print("\nCategories:")
    for cat, cnt in Counter(i["category"] for i in all_incidents).most_common(10):
        print(f"  {cat:<40} {cnt}")

    print("\nSample:")
    if all_incidents:
        s = all_incidents[0]
        print(f"  {s['id']}")
        print(f"  {s['source_url']}")
        print(f"  {s['text'][:200]}")


if __name__ == "__main__":
    main()
