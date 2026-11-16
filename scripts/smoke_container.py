#!/usr/bin/env python3
"""Verify a release image's serving, SQLite persistence, and clean shutdown."""

import http.cookiejar
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request


def docker(*args, **kwargs):
    return subprocess.run(["docker", *args], check=True, text=True, capture_output=True, **kwargs).stdout.strip()


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/smoke_container.py IMAGE")
    image = sys.argv[1]
    name = "word-check-" + secrets.token_hex(4)
    volume = name + "-data"
    container_created = False
    admin_password = secrets.token_urlsafe(24)
    env = dict(os.environ, ADMIN_PASSWORD=admin_password)
    try:
        docker("volume", "create", volume)
        docker("run", "-d", "--name", name, "--read-only", "--cap-drop=ALL",
               "--security-opt=no-new-privileges:true", "--tmpfs", "/tmp:size=16m,mode=1777",
               "-e", "ADMIN_PASSWORD", "-e", "ADMIN_EMAIL=admin@word.local",
               "-e", "COOKIE_SECURE=false", "-p", "127.0.0.1::8080",
               "-v", volume + ":/data", image, env=env)
        container_created = True
        if docker("inspect", "--format", "{{.Config.User}}", name) in ("", "0", "root", "0:0"):
            raise AssertionError("Release image must run as a non-root user")
        port = docker("port", name, "8080/tcp").split(":")[-1]
        base = "http://127.0.0.1:" + port
        cookies = http.cookiejar.CookieJar()
        client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))

        def request(path, payload=None, method=None):
            body = None if payload is None else json.dumps(payload).encode()
            req = urllib.request.Request(base + path, data=body, method=method, headers={"Content-Type": "application/json"})
            with client.open(req, timeout=3) as response:
                return json.load(response)

        def wait_ready():
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                try:
                    if request("/api/health").get("status") == "ok":
                        return
                except (OSError, ValueError):
                    pass
                time.sleep(0.25)
            raise AssertionError("Container did not become ready within 30 seconds")

        wait_ready()
        with client.open(base + "/admin/books", timeout=3) as response:
            assert "text/html" in response.headers.get("Content-Type", ""), "SPA deep links must serve HTML"
            assert "<html" in response.read().decode().lower(), "SPA entry page is missing"
        guest = request("/api/auth/guest", {})
        assert guest["guest"] is True
        books = request("/api/books")
        assert books, "Seed wordbooks are missing"
        word = request("/api/books/" + str(books[0]["id"]))["words"][0]
        request("/api/favorites/" + str(word["id"]), {"favorite": True})

        docker("stop", "--time", "10", name)
        assert docker("inspect", "--format", "{{.State.ExitCode}}", name) == "0", "Server did not shut down cleanly"
        docker("start", name)
        port = docker("port", name, "8080/tcp").split(":")[-1]
        base = "http://127.0.0.1:" + port
        wait_ready()
        assert request("/api/me")["id"] == guest["id"], "Session was not persisted"
        assert any(item["id"] == word["id"] for item in request("/api/favorites")), "SQLite write was not persisted"
        admin = request("/api/auth/login", {"email": "admin@word.local", "password": admin_password})
        assert admin["role"] == "admin"
        navigation = request("/api/admin/navigation?versioned=1")
        assert navigation["items"], "Admin navigation is missing"
        saved = request("/api/admin/navigation", {"items": navigation["items"], "version": navigation["version"]}, method="PUT")
        assert saved["items"] == navigation["items"], "Versioned navigation was not preserved"
        docker("stop", "--time", "10", name)
        assert docker("inspect", "--format", "{{.State.ExitCode}}", name) == "0"
        print("Container check passed: non-root, health, SPA deep link, guest, SQLite persistence, admin, clean shutdown.")
    except Exception:
        if container_created:
            logs = subprocess.run(["docker", "logs", name], text=True, capture_output=True)
            print(logs.stdout + logs.stderr, file=sys.stderr)
        raise
    finally:
        if container_created:
            docker("rm", "-f", name)
        docker("volume", "rm", volume)


if __name__ == "__main__":
    main()
