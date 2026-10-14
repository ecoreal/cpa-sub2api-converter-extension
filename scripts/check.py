#!/usr/bin/env python3
"""Dependency-free static checks for the unpacked browser extension."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_FILES = (
    "manifest.json",
    "popup.html",
    "popup.js",
    "dashboard.html",
    "dashboard.js",
    "converter-core.js",
    "remote-request.js",
    "privacy-policy.md",
)


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


HTML_REF_RE = re.compile(r'(?:src|href)="([^"#]+)"')


def referenced_files() -> set[str]:
    """Every local file reachable from manifest.json and the popup/dashboard HTML."""
    manifest = json.loads(read("manifest.json"))
    files: set[str] = {"manifest.json"}
    files.update(manifest.get("icons", {}).values())
    default_icon = (manifest.get("action", {}).get("default_icon") or {}).values()
    files.update(default_icon)
    popup = manifest.get("action", {}).get("default_popup")
    if popup:
        files.add(popup)

    expanded: set[str] = set()
    queue = {popup} if popup else set()
    while queue:
        current = queue.pop()
        if current in expanded or not current.endswith(".html"):
            files.add(current)
            continue
        expanded.add(current)
        files.add(current)
        if not (ROOT / current).is_file():
            continue
        for match in HTML_REF_RE.finditer(read(current)):
            ref = match.group(1)
            if ref.startswith(("http://", "https://", "data:", "mailto:")):
                continue
            ref = ref.lstrip("./")
            files.add(ref)
            queue.add(ref)

    for path in [f for f in files if f.endswith(".js")]:
        if not (ROOT / path).is_file():
            continue
        for match in re.finditer(r'(?:from|import)\s+"(\./[^"]+)"', read(path)):
            files.add(match.group(1).lstrip("./"))
    return files


def main() -> int:
    missing = [relative for relative in REQUIRED_FILES if not (ROOT / relative).is_file()]
    if missing:
        raise SystemExit("missing files: " + ", ".join(missing))

    manifest = json.loads(read("manifest.json"))
    if manifest.get("manifest_version") != 3:
        raise SystemExit("manifest_version must be 3")
    if "storage" not in manifest.get("permissions", []):
        raise SystemExit("manifest must request storage permission")

    dashboard = read("dashboard.js")
    converter = read("converter-core.js")
    remote_request = read("remote-request.js")

    # The packager ships exactly this reference graph; a dangling reference
    # would produce a broken store zip, so fail here instead.
    dangling = sorted(
        path for path in referenced_files() if not (ROOT / path).is_file()
    )
    if dangling:
        raise SystemExit("dangling manifest/HTML/JS references: " + ", ".join(dangling))

    checks = {
        "remote URL validation": 'parsed.protocol !== "https:"' in dashboard
        and 'parsed.hostname.toLowerCase()' in dashboard
        and 'parsed.username || parsed.password' in dashboard,
        "secret storage is session-only": 'chrome.storage.session' in dashboard
        and 'var transientKeys' in dashboard
        and 'volatileStorage' in dashboard,
        "HTML escaping": "function escapeHtml" in dashboard
        and "escapeHtml(item.fileName)" in dashboard,
        "converter core present": "convertBatch" in converter
        and "reverseConvertBatch" in converter,
        "response-body timeout helper present": "requestWithTimeout" in remote_request
        and "parseResponse(response)" in dashboard
        and ".finally" in remote_request,
        "no obvious hard-coded API key": not re.search(
            r"(?:api[_-]?key|management[_-]?key)\s*[:=]\s*['\"][^'\"]{12,}['\"]",
            dashboard + converter,
            re.IGNORECASE,
        ),
    }
    failures = [label for label, passed in checks.items() if not passed]
    if failures:
        raise SystemExit("failed checks: " + ", ".join(failures))

    print("cpa-sub2api-converter-extension check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
