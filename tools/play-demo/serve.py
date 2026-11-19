"""Serves the demo page and its files on port 8000. The large download is sent slowly so the
download keeps running in the background while the video shows it."""
import http.server
import os
import sys
import time

ROOT = sys.argv[1]
SLOW = "/files/large-download.bin"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):
        if path.endswith(".apk"):
            return "application/vnd.android.package-archive"
        return super().guess_type(path)

    def do_GET(self):
        if self.path != SLOW:
            return super().do_GET()
        size = 80 * 1024 * 1024
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(size))
        self.send_header("Content-Disposition", 'attachment; filename="large-download.bin"')
        self.end_headers()
        chunk = os.urandom(256 * 1024)
        sent = 0
        try:
            while sent < size:
                self.wfile.write(chunk)
                sent += len(chunk)
                time.sleep(0.25)
        except (BrokenPipeError, ConnectionResetError):
            pass


http.server.ThreadingHTTPServer(("127.0.0.1", 8000), Handler).serve_forever()
