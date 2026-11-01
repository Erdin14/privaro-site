"""Run from the repository root: python3 tests/publication.py."""
import base64
import hashlib
import importlib.util
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("site_build", ROOT / "build.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


def rebuild():
    subprocess.run([sys.executable, str(ROOT / "build.py")], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL)


rebuild()
dist = ROOT / "dist"
# A stale artifact must not survive the next build.
(dist / "build.py").write_text("stale test fixture", encoding="utf-8")
rebuild()
for forbidden in ("build.py", "templates", "i18n", "index.legacy.html", "screenshots.html",
                  "vercel.json", ".git", ".env", "tests", "README.md"):
    assert not (dist / forbidden).exists(), forbidden
pages = list(dist.rglob("*.html"))
assert len(pages) == 87, "all 17 languages, security page and 404 must remain"
assert {str(p.relative_to(dist)).replace('\\', '/') for p in pages} == {
    p.replace('\\', '/') for p in build.public_pages()
}
for rel in ("_headers", "_redirects", ".well-known/apple-app-site-association",
            ".well-known/security.txt", "robots.txt", "sitemap.xml"):
    assert (dist / rel).read_bytes() == (ROOT / rel).read_bytes(), rel

policy = (dist / "_headers").read_text(encoding="utf-8")
legacy = (ROOT / "index.legacy.html").read_text(encoding="utf-8")
for script in build.INLINE_SCRIPT.findall(legacy):
    digest = base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
    assert f"'sha256-{digest}'" not in policy, "legacy scripts must not be authorized"

for page in pages:
    html = page.read_text(encoding="utf-8")
    assert "{{" not in html, page
    for script in build.INLINE_SCRIPT.findall(html):
        digest = base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
        assert f"'sha256-{digest}'" in policy, page
    for reference in re.findall(r'(?:href|src)="(/[^"<>]*)"', html):
        url = urlsplit(reference)
        rel = unquote(url.path).lstrip("/")
        candidates = [dist / rel, dist / (rel + ".html"), dist / rel / "index.html"]
        assert any(p.is_file() for p in candidates), (page, reference)
        version = re.search(r'(?:^|&)v=([0-9a-f]+)', url.query)
        if version and url.path.endswith((".css", ".js")):
            digest = hashlib.sha256((dist / rel).read_bytes()).hexdigest()[:10]
            assert version[1] == digest, (page, reference)

def snapshot():
    return {str(p.relative_to(dist)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in dist.rglob("*") if p.is_file()}

before = snapshot()
rebuild()
assert snapshot() == before, "repeated builds must be byte-for-byte deterministic"
print(f"Publication checks passed: {len(pages)} pages, {len(before)} files; assets, CSP, stale-file cleanup and repeatability")
