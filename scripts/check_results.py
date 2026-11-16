#!/usr/bin/env python3
"""Reject incomplete scoped checks, accepting only exact-head trusted licensed builds."""

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request


def github(path):
    request = urllib.request.Request(
        "https://api.github.com/" + path,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)


def trusted_status(statuses, head, repository, actor):
    """An explicitly trusted maintainer attests an exact-head image after local checks."""
    for status in statuses:
        if status.get("context") != "licensed-build" or (status.get("creator") or {}).get("login") != actor:
            continue
        # The API is newest first: a newer pending/failing attestation revokes an older success.
        description = status.get("description") or ""
        return (
            status.get("state") == "success"
            and re.fullmatch(r"Verified " + re.escape(head) + r" image [0-9a-f]{12}", description) is not None
            and status.get("target_url") == f"https://github.com/{repository}/commit/{head}"
        )
    return False


def trusted_builds(repository, head, actor):
    statuses = github(f"repos/{repository}/commits/{head}/statuses?per_page=100")
    if trusted_status(statuses, head, repository, actor):
        return {"frontend": "licensed-build attestation", "container": "licensed-build attestation"}

    query = urllib.parse.urlencode({"head_sha": head, "event": "push", "per_page": 100})
    runs = github(f"repos/{repository}/actions/workflows/checks.yml/runs?{query}")["workflow_runs"]
    verified = {}
    for run in runs:
        if run.get("head_sha") != head or run.get("event") != "push" or (run.get("head_repository") or {}).get("full_name") != repository:
            continue
        jobs = github(f"repos/{repository}/actions/runs/{run['id']}/jobs?per_page=100")["jobs"]
        for job in jobs:
            if job.get("name") in ("frontend", "container") and job.get("conclusion") == "success":
                verified[job["name"]] = f"trusted push run {run['id']}"
        if len(verified) == 2:
            break
    return verified


def summarize(environment, evidence):
    if environment["CHANGES"] != "success":
        raise ValueError("Change selection did not succeed")
    rows, errors = [], []
    for name in ("quiz", "frontend", "backend", "container"):
        selected = environment[name.upper() + "_SELECTED"] == "true"
        result = environment[name.upper() + "_RESULT"]
        if not selected:
            label = "Not affected"
            if result != "skipped":
                errors.append(name + ": unexpected " + result)
        elif result == "success":
            label = "success"
        elif name in ("frontend", "container") and result == "skipped" and environment["PRO_AVAILABLE"] != "true":
            label = evidence.get(name, "Not verified: exact-head licensed build evidence missing")
            if name not in evidence:
                errors.append(name + ": licensed build evidence missing")
        else:
            label = result
            errors.append(name + ": " + result)
        rows.append((name, label))
    return rows, errors


def main():
    environment = os.environ
    needs_evidence = any(
        environment[name.upper() + "_SELECTED"] == "true"
        and environment[name.upper() + "_RESULT"] == "skipped"
        for name in ("frontend", "container")
    )
    evidence = {}
    if needs_evidence:
        try:
            evidence = trusted_builds(environment["REPOSITORY"], environment["HEAD_SHA"], environment["TRUSTED_BUILD_ACTOR"])
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, KeyError) as error:
            raise SystemExit(f"Cannot inspect licensed build evidence: {error}") from error
    try:
        rows, errors = summarize(environment, evidence)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    with open(environment["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        summary.write("| Component | Result |\n|---|---|\n")
        for name, result in rows:
            summary.write(f"| {name} | {result} |\n")
    if errors:
        raise SystemExit("Required checks incomplete: " + "; ".join(errors))


if __name__ == "__main__":
    main()
