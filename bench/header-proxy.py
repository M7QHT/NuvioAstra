"""Local header-checking proxy for player tests (127.0.0.1 only).

Forwards GET requests to a fixed public test media URL and streams the bytes back, but answers
403 unless the request carries the expected headers. Logs, per request, the header NAMES received
and whether each expected value matched (values are never printed). Used to prove that addon
headers (Referer, Cookie, User-Agent, custom tokens) reach the server through mpv.

Usage: python -I header-proxy.py <port> <upstream_url> <log_file>
"""
import http.server
import json
import sys
import urllib.request

PORT = int(sys.argv[1])
UPSTREAM = sys.argv[2]
LOG = sys.argv[3]
EXPECTED = {
    "Referer": "https://nuvio.test/referer",
    "Cookie": "session=abc123; region=br",
    "User-Agent": "NuvioNextGen-HeaderTest/1.0",
    "X-Nuvio-Token": "token,with\\specials",
}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        received = {name: self.headers.get_all(name) or [] for name in EXPECTED}
        result = {
            "path": self.path.split("?")[0],
            "header_names": sorted(set(self.headers.keys())),
            "matches": {name: (EXPECTED[name] in values) for name, values in received.items()},
            "user_agent_count": len(self.headers.get_all("User-Agent") or []),
        # Test-only value (not a secret): shows how the custom header arrived.
        "x_nuvio_token_received": self.headers.get_all("X-Nuvio-Token"),
        }
        ok = all(result["matches"].values())
        result["status"] = 200 if ok else 403
        with open(LOG, "a", encoding="utf-8") as log:
            log.write(json.dumps(result) + "\n")
        if not ok:
            self.send_response(403)
            self.end_headers()
            return
        upstream = urllib.request.Request(UPSTREAM, headers={"User-Agent": "nuvio-header-proxy"})
        if self.headers.get("Range"):
            upstream.add_header("Range", self.headers["Range"])
        with urllib.request.urlopen(upstream, timeout=30) as response:
            self.send_response(response.status)
            for key in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
                if response.headers.get(key):
                    self.send_header(key, response.headers[key])
            self.end_headers()
            try:
                while True:
                    chunk = response.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
