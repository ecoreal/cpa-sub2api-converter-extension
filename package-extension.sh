#!/usr/bin/env sh
# Package the unpacked extension into a Chrome Web Store ready zip.
#
# The file set is derived from manifest.json and the popup/dashboard HTML +
# JS module graph, so a new asset that is referenced somewhere is included
# automatically and a missing reference fails the build instead of shipping
# a broken package.
#
# Usage: sh package-extension.sh
# Output: dist/cpa-to-sub2api-extension.zip (version taken from manifest.json)
set -eu

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

DIST_DIR="dist"
VERSION="$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')"
OUT="$DIST_DIR/cpa-to-sub2api-extension-$VERSION.zip"

FILES="$(python3 - <<'PY'
import json
import re
from pathlib import Path

manifest = json.loads(Path("manifest.json").read_text(encoding="utf-8"))
files = {"manifest.json"}
files.update(manifest.get("icons", {}).values())
files.update((manifest.get("action", {}).get("default_icon") or {}).values())
popup = manifest.get("action", {}).get("default_popup")
if popup:
    files.add(popup)


def html_refs(path: str) -> set[str]:
    text = Path(path).read_text(encoding="utf-8")
    return {
        value
        for match in re.finditer(r'(?:src|href)="([^"#]+)"', text)
        if not (value := match.group(1)).startswith(("http://", "https://", "data:", "mailto:"))
    }


def module_refs(path: str) -> set[str]:
    text = Path(path).read_text(encoding="utf-8")
    return {
        value.lstrip("./")
        for match in re.finditer(r'(?:from|import)\s+"(\./[^"]+)"', text)
        if (value := match.group(1))
    }


expanded = set()
queue = {popup} if popup else set()
while queue:
    current = queue.pop()
    if current in expanded or not current.endswith(".html"):
        files.add(current)
        continue
    expanded.add(current)
    files.add(current)
    if not Path(current).is_file():
        continue
    for ref in html_refs(current):
        ref = ref.lstrip("./")
        files.add(ref)
        queue.add(ref)

for path in list(files):
    if path.endswith(".js"):
        files.update(module_refs(path))

missing = sorted(path for path in files if not Path(path).is_file())
if missing:
    raise SystemExit(f"manifest/reference graph points at missing files: {missing}")
print("\n".join(sorted(files)))
PY
)"

mkdir -p "$DIST_DIR"
rm -f "$OUT"
# zip the derived file list only; nothing else from the working tree leaks in.
printf '%s\n' "$FILES" | xargs zip -q "$OUT"
echo "packaged $(printf '%s\n' "$FILES" | wc -l | tr -d ' ') files -> $OUT"
unzip -l "$OUT"
