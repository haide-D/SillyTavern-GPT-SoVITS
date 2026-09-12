"""Revalidate UI assets and version the entire module graph after an update."""
import hashlib
import re
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response


class UIStaticFiles(StaticFiles):
    def asset_version(self):
        root = Path(self.directory)
        manifest = []
        for path in sorted(root.rglob('*')):
            if path.is_file() and path.suffix in {'.js', '.css', '.html'}:
                stat = path.stat()
                manifest.append(f'{path.relative_to(root)}:{stat.st_mtime_ns}:{stat.st_size}')
        return hashlib.sha256('\n'.join(manifest).encode()).hexdigest()[:16]

    @staticmethod
    def version_url(url, version):
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc or url.startswith(('#', '/')):
            return url
        query = [(k, v) for k, v in parse_qsl(parsed.query) if k != 'v']
        query.append(('v', version))
        return urlunsplit(parsed._replace(query=urlencode(query)))

    async def get_response(self, path, scope):
        # Let StaticFiles validate and resolve the path before opening it.
        response = await super().get_response(path, scope)
        file_path = getattr(response, 'path', None)
        if response.status_code == 200 and file_path and Path(file_path).suffix in {'.html', '.js', '.css'}:
            text = Path(file_path).read_text(encoding='utf-8')
            version = self.asset_version()
            suffix = Path(file_path).suffix
            if suffix == '.html':
                pattern = r'''((?:src|href)=["'])([^"']+\.(?:js|css)(?:\?[^"']*)?)(["'])'''
            elif suffix == '.js':
                pattern = r'''((?:\bfrom\s*|\bimport\s*\(?\s*)["'])(\.[^"']+)(["'])'''
            else:
                pattern = r'''(url\(["']?)([^\s)"']+)(["']?\))'''
            text = re.sub(pattern, lambda m: m[1] + self.version_url(m[2], version) + m[3], text)
            response = Response(text, media_type={'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}[suffix])
        response.headers['Cache-Control'] = 'no-cache, max-age=0, must-revalidate'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

    def is_not_modified(self, response_headers, request_headers):
        # A dependency can change even if the entry file has not changed.
        return False
