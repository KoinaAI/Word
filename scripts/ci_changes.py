#!/usr/bin/env python3
"""Select owning build checks from the event's real Git diff; fail on invalid baselines."""

import os
import subprocess


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


event = os.environ["EVENT_NAME"]
head = os.environ["HEAD_SHA"]
if event == "pull_request":
    base = git("merge-base", os.environ["PR_BASE_SHA"], head)
elif event == "merge_group":
    base = os.environ["GROUP_BASE_SHA"]
elif event == "push":
    base = os.environ["PUSH_BEFORE"]
    if not base.strip("0"):
        # A new branch has no previous SHA; compare its fork point to the default branch.
        base = git("merge-base", "origin/" + os.environ["DEFAULT_BRANCH"], head)
        if base == head:
            base = subprocess.check_output(["git", "hash-object", "-t", "tree", "--stdin"], input=b"").decode().strip()
else:
    raise SystemExit("Unsupported CI event: " + event)

# Treat renames as deletion/addition so moving a file out of a component still
# checks its former owner, rather than seeing only the destination pathname.
files = git("diff", "--no-renames", "--name-only", "--diff-filter=ACDMRTUXB", base, head).splitlines()
config = any(path.startswith(".github/") or path == "scripts/ci_changes.py" for path in files)
checks = {
    "frontend": config or any(path.startswith("web/") for path in files),
    "backend": config or any(path.startswith("backend/") for path in files),
    "container": config or any(path in {"Dockerfile", "compose.yaml", ".dockerignore", ".env.example"} or path == "scripts/smoke_container.py" for path in files),
}
with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
    for check, selected in checks.items():
        output.write(f"{check}={str(selected).lower()}\n")
print("Selected checks:", ", ".join(name for name, selected in checks.items() if selected) or "documentation only")
