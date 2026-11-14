#!/usr/bin/env python3
"""Package an already licensed HeroUI Pro installation for a local Docker build."""

import json
import os
from pathlib import Path
import sys
import tarfile


if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 scripts/prepare_pro_archive.py /path/to/licensed/@heroui-pro/react")
root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1]).expanduser().resolve()
package = json.loads((source / "package.json").read_text())
lock = json.loads((root / "web/package-lock.json").read_text())
expected = lock["packages"]["node_modules/@heroui-pro/react"]["version"]
if package.get("name") != "@heroui-pro/react" or package.get("version") != expected:
    raise SystemExit(f"Expected genuine @heroui-pro/react {expected}")
if not (source / "dist/index.js").is_file():
    raise SystemExit("This is the public placeholder package. Install Pro with an authorized HeroUI account first.")
destination = root / ".secrets/heroui-pro.tgz"
destination.parent.mkdir(mode=0o700, exist_ok=True)
with tarfile.open(destination, "w:gz") as archive:
    for entry in ("package.json", "dist", "LICENSE", "LICENSE.md"):
        path = source / entry
        if path.exists():
            archive.add(path, arcname=entry, recursive=True)
os.chmod(destination, 0o600)
print(f"Prepared {destination}; keep this licensed archive private.")
