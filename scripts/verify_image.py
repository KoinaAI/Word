#!/usr/bin/env python3
"""Verify OCI labels on a release candidate before tagging or publishing it."""

import json
import subprocess
import sys


if len(sys.argv) != 3:
    raise SystemExit("Usage: verify_image.py IMAGE EXPECTED_REVISION")
image, revision = sys.argv[1:]
raw = subprocess.check_output(["docker", "image", "inspect", image], text=True)
metadata = json.loads(raw)[0]
labels = metadata.get("Config", {}).get("Labels") or {}
if metadata.get("Os") != "linux" or metadata.get("Architecture") != "amd64":
    raise SystemExit("The release candidate must be built for linux/amd64")
if labels.get("org.opencontainers.image.revision") != revision:
    raise SystemExit("OCI revision does not match the tagged commit")
if labels.get("org.opencontainers.image.source") != "https://github.com/KoinaAI/Word":
    raise SystemExit("OCI source label does not identify KoinaAI/Word")
print(f"Verified {image}: revision={revision}, source={labels['org.opencontainers.image.source']}")
