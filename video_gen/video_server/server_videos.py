import http.server
import socketserver
import os

PORT = 5556


class VideoHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        '': 'application/octet-stream',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'video/ogg',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.mkv': 'video/x-matroska',
    }

    def end_headers(self):
        # Add CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Expose-Headers', 'Content-Length, Content-Range')
        self.send_header('Access-Control-Allow-Credentials', 'true')
        http.server.SimpleHTTPRequestHandler.end_headers(self)

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def guess_type(self, path):
        base, ext = os.path.splitext(path)
        if ext in self.extensions_map:
            return self.extensions_map[ext]
        return self.extensions_map['']


print(f"Starting server on port {PORT}...")
print(f"CORS enabled for all origins")
print(f"Make sure your MP4 files are properly encoded for web playback")
print(f"Access your videos at: http://localhost:{PORT}/your_video.mp4")

with socketserver.TCPServer(("", PORT), VideoHTTPRequestHandler) as httpd:
    httpd.serve_forever()
