#!/usr/bin/env python3
"""Behavioral checks for missing licensed evidence and exact-head attestations."""

import unittest

from check_results import summarize, trusted_status


class ScopedResultsTest(unittest.TestCase):
    def environment(self):
        result = {"CHANGES": "success", "PRO_AVAILABLE": "false"}
        for name in ("QUIZ", "FRONTEND", "BACKEND", "CONTAINER"):
            result[name + "_SELECTED"] = "true"
            result[name + "_RESULT"] = "success" if name in ("QUIZ", "BACKEND") else "skipped"
        return result

    def test_missing_licensed_build_fails(self):
        _, errors = summarize(self.environment(), {})
        self.assertEqual(errors, ["frontend: licensed build evidence missing", "container: licensed build evidence missing"])

    def test_exact_head_evidence_covers_only_skipped_builds(self):
        evidence = {"frontend": "trusted push", "container": "trusted push"}
        environment = self.environment()
        _, errors = summarize(environment, evidence)
        self.assertEqual(errors, [])
        environment["FRONTEND_RESULT"] = "failure"
        _, errors = summarize(environment, evidence)
        self.assertEqual(errors, ["frontend: failure"])

    def test_skipped_backend_is_never_licensed(self):
        environment = self.environment()
        environment["BACKEND_RESULT"] = "skipped"
        _, errors = summarize(environment, {"frontend": "local", "container": "local"})
        self.assertIn("backend: skipped", errors)

    def test_attestation_checks_identity_head_and_latest_result(self):
        head = "a" * 40
        good = {"context": "licensed-build", "state": "success", "creator": {"login": "MournInk"},
                "description": "Verified " + head + " image " + "b" * 12,
                "target_url": "https://github.com/KoinaAI/Word/commit/" + head}
        self.assertTrue(trusted_status([good], head, "KoinaAI/Word", "MournInk"))
        self.assertFalse(trusted_status([good], "c" * 40, "KoinaAI/Word", "MournInk"))
        self.assertFalse(trusted_status([good], head, "KoinaAI/Word", "someone-else"))
        pending = {**good, "state": "pending"}
        self.assertFalse(trusted_status([pending, good], head, "KoinaAI/Word", "MournInk"))
        self.assertFalse(trusted_status([{**good, "description": "tested locally"}], head, "KoinaAI/Word", "MournInk"))


if __name__ == "__main__":
    unittest.main()
