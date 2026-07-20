import http.server
import socketserver

PORT = 8002
Handler = http.server.SimpleHTTPRequestHandler

if __name__ == '__main__':
    with socketserver.TCPServer(('0.0.0.0', PORT), Handler) as httpd:
        print(f'Serving web preview at http://127.0.0.1:{PORT}/web_preview.html')
        print('Press Ctrl+C to stop the server.')
        httpd.serve_forever()
import http.server
import socketserver
import socket

PORT = 8002
Handler = http.server.SimpleHTTPRequestHandler


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == '__main__':
    local_ip = get_local_ip()
    with socketserver.TCPServer(('0.0.0.0', PORT), Handler) as httpd:
        print(f'Serving web preview locally at http://127.0.0.1:{PORT}/web_preview.html')
        print(f'Serving web preview on phone at http://{local_ip}:{PORT}/web_preview.html')
        print('Press Ctrl+C to stop the server.')
        httpd.serve_forever()
