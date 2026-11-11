"""Run from the repository root: python3 tests/publication.py."""
import base64
import hashlib
import importlib.util
import json
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
                  "vercel.json", ".git", ".env", "tests", "og", "README.md", "transitions.css", "decrypt.js"):
    assert not (dist / forbidden).exists(), forbidden
pages = list(dist.rglob("*.html"))
assert len(pages) == 120, "seven pages in each of 17 languages, and the 404, must remain"
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


def jpeg_size(data):
    """A JPEG's width and height, from its frame header."""
    at = 2
    while at < len(data):
        marker, length = data[at + 1], int.from_bytes(data[at + 2:at + 4], "big")
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return int.from_bytes(data[at + 7:at + 9], "big"), int.from_bytes(data[at + 5:at + 7], "big")
        at += 2 + length


# The link preview picture: every page names the one that is published, by
# its hash, and says the size it really is. It stays small: previews are
# fetched on mobile data, and some apps show none for a heavy picture.
preview = (dist / "og.jpg").read_bytes()
assert jpeg_size(preview) == (1200, 630), "og.jpg must be 1200 by 630"
assert len(preview) < 300_000, "og.jpg must stay under 300 KB"
named = f'{build.BASE_URL}/og.jpg?v={hashlib.sha256(preview).hexdigest()[:10]}'
for page in pages:
    html = page.read_text(encoding="utf-8")
    if page.name == "404.html" and page.parent == dist:
        continue
    assert re.findall(r'<meta property="og:image" content="([^"]+)"', html) == [named], page
    assert ('<meta property="og:image:width" content="1200" />' in html
            and '<meta property="og:image:height" content="630" />' in html), page


def served(path):
    """What Cloudflare Pages answers for an address: the file it serves, or
    None where it would redirect or miss. /nl is a redirect to /nl/, and
    /pro.html and /pro/ are redirects to /pro."""
    rel = path.lstrip("/")
    if path.endswith("/"):
        target = dist / rel / "index.html"
    elif path.endswith((".html", "/index")) or (dist / rel).is_dir():
        return None
    else:
        target = dist / (rel + ".html") if not (dist / rel).is_file() else dist / rel
    return target if target.is_file() else None


# Every address a page gives for itself or its translations is one that is
# served, not one that redirects: canonical, hreflang, og:url and the sitemap.
origin = build.BASE_URL
canonical_of = {}
for page in pages:
    html = page.read_text(encoding="utf-8")
    rel = str(page.relative_to(dist)).replace("\\", "/")
    assert "<!--" not in html, f"{rel}: template notes must not be published"
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        data = json.loads(block)
        assert data["@context"] == "https://schema.org", rel
        # No rating or review is claimed: the app has none to show yet.
        assert not re.search(r'"(aggregateRating|review|ratingValue)":', block), rel
    if rel == "404.html":
        assert 'name="robots" content="noindex"' in html
        continue
    canonical = re.findall(r'<link rel="canonical" href="([^"]+)"', html)
    assert len(canonical) == 1 and canonical[0].startswith(origin), rel
    target = served(canonical[0][len(origin):])
    assert target is not None, f"{rel}: canonical {canonical[0]} is not served directly"
    canonical_of[rel] = canonical[0]
    # A page is its own canonical, except an English-only page in another
    # language's frame, which names the English one.
    own = target == page
    assert own or rel.split("/")[-1] in build.ENGLISH_ONLY.values(), (rel, canonical[0])
    assert re.findall(r'<meta property="og:url" content="([^"]+)"', html) == canonical, rel
    alternates = dict(re.findall(r'<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"', html))
    if not own or rel in build.ENGLISH_ONLY.values():
        assert not alternates, f"{rel}: one text, so no language alternates"
        continue
    assert len(alternates) == 18 and alternates["x-default"] == alternates["en"], rel
    assert canonical[0] in alternates.values(), f"{rel}: a page must list itself among its alternates"
    for lang, href in alternates.items():
        other = served(href[len(origin):])
        assert other is not None, f"{rel}: hreflang {lang} {href} is not served directly"
        back = dict(re.findall(r'<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"', other.read_text(encoding="utf-8")))
        assert back == alternates, f"{rel} and {href} must list the same alternates"

sitemap = (dist / "sitemap.xml").read_text(encoding="utf-8")
locations = re.findall(r"<loc>([^<]+)</loc>", sitemap)
assert len(locations) == len(set(locations)) == 87, "five pages in 17 languages, the security overview and the demo"
for location in locations + re.findall(r'<xhtml:link rel="alternate" hreflang="[^"]+" href="([^"]+)"', sitemap):
    target = served(location[len(origin):])
    assert target is not None, f"sitemap: {location} is not served directly"
    assert canonical_of[str(target.relative_to(dist)).replace("\\", "/")] == location, f"sitemap lists a non-canonical address: {location}"

# The stylesheet and scripts go out without their notes, and say the same.
css = (dist / "styles.css").read_text(encoding="utf-8")
assert "/*" not in css and css.count("{") == css.count("}")
assert css.count("{") == build.strip_css((ROOT / "styles.css").read_text(encoding="utf-8")).count("{")
for name in ("presentation.js", "film.js", "privacy-vignette.js", "price.js", "encryption-demo.js"):
    assert not re.search(r"^\s*//", (dist / name).read_text(encoding="utf-8"), re.M), name

# The working demo ("Inside the encryption", /encryption) tells its visitor
# that nothing is sent or kept, that the site's policy lets no script call
# out, that it is a simplified demo, and how the photo is cut up. Each is
# checked here, so the page can't go on saying it after a change has made it
# untrue.
demo = (dist / "encryption-demo.js").read_text(encoding="utf-8")
for api in ("fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon", "RTCPeerConnection",
            "localStorage", "sessionStorage", "indexedDB", "document.cookie", "caches.", "postMessage",
            "serviceWorker", "import(", "new Image", ".src =", "location.", "window.open", "createObjectURL",
            "toDataURL", "toBlob", "http"):
    assert api not in demo, f"encryption-demo.js must not send or keep anything: {api}"
assert "default-src 'none'" in policy and "connect-src" not in policy, "the demo says scripts here can't call out"
exhibit = (dist / "encryption.html").read_text(encoding="utf-8")
assert 'class="exhibit"' in exhibit and "/encryption-demo.js?v=" in exhibit and 'id="simplified"' in exhibit
# The whole demo is on its own page. Every homepage has the way in to its
# own language's copy, and nothing of the demo itself; the Security overview
# links to it too.
for code, folder, _, _ in build.LANGS:
    home = (dist / folder / "index.html").read_text(encoding="utf-8")
    assert f'class="inside-door" href="{build.page_url("encryption", code)}"' in home, code
    assert "encryption-demo.js" not in home and 'class="exhibit"' not in home, code
    assert f'href="{build.page_url("encryption", code)}"' in (dist / folder / "security.html").read_text(encoding="utf-8"), code
words = {key: values["en"] for key, values in build.load_strings().items() if key.startswith("ex_")}
assert "simplified" in words["ex_intro_small"] and "simplified" in words["ex_about_h"].lower()
# It promises nothing about memory: a web page can't erase securely, and
# the one place the words appear is where it says so.
for key, text in words.items():
    assert not re.search(r"\bwip(e|es|ed|ing)\b|\beras(e|es|ed|ing)\b|\bshred", text, re.I), f"{key} overclaims: {text!r}"
assert "not secure erasure" in words["ex_about_7"] and "not secure erasure" in words["ex_vault_tech_copy"]
# The numbers in its words are the ones the script and the stylesheet use.
width, height, pieces = map(int, re.search(r"const W = (\d+), H = (\d+), PIECES = (\d+);", demo).groups())
assert height % pieces == 0
rows = height // pieces
assert f"{width} by {height}" in words["ex_photo_tech"] and f"{width * height * 3:,} bytes" in words["ex_photo_tech"]
assert f"{pieces} pieces of {rows * width * 3:,} bytes: {rows} rows" in words["ex_cut_tech_pieces"]
assert f"into {pieces} small" in words["ex_about_2"]
for key in ("ex_cut_fig", "ex_unlock_fig", "ex_wrong_fig"):
    assert words[key].endswith(f"of {pieces}"), key
assert words["ex_photo_k"].endswith("of 8") and exhibit.count("data-goto=") == 8
assert f"calc({pieces} * var(--slab))" in css

# In the header the other pages are listed once for each layout, in the
# order that layout shows them: before the name on wide screens, after the
# download on phones.
for page in pages:
    html = page.read_text(encoding="utf-8")
    head = html[html.index('<header class="site-head">'):html.index("</header>")]
    order = [head.index(mark) for mark in ("head-links-wide", 'class="brand"', "head-get", "head-links-phone")]
    assert order == sorted(order), page
    wide, phone = (re.findall(r'<a href="([^"]+)"', head[head.index(name):].split("</nav>")[0])
                   for name in ("head-links-wide", "head-links-phone"))
    assert wide == phone and len(wide) == 3, page

# Translations: every string in every language, in that language's script.
# (One label once had its seventeen values under the wrong languages.)
SCRIPTS = {"zh-Hans": "\u4e00-\u9fff", "zh-Hant": "\u4e00-\u9fff", "ja": "\u3040-\u30ff\u4e00-\u9fff",
           "ko": "\uac00-\ud7af", "ru": "\u0400-\u04ff", "hi": "\u0900-\u097f",
           "ar": "\u0600-\u06ff", "ur": "\u0600-\u06ff"}
OTHER = re.compile("[\u0400-\u04ff\u0600-\u06ff\u0900-\u097f\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]")
codes = [code for code, _, _, _ in build.LANGS]
for key, values in build.load_strings().items():
    if set(values) == {"en"}:
        continue
    assert set(values) == set(codes), f"{key}: every language"
    for code, text in values.items():
        words = re.sub(r"<[^>]+>|\{\{[^}]+\}\}", "", text)
        if code in SCRIPTS:
            # Names that stay as they are, and figures like "2.5GB", aside.
            latin = re.search(r"[a-z]{3,}", re.sub(r"Privaro|iPhone|iPad|iCloud|Face ID|Touch ID|App Store|Apple|AirPlay|Wi-Fi", "", words))
            assert not latin or re.search(f"[{SCRIPTS[code]}]", words), f"{key} [{code}] is not in its own script: {text!r}"
        else:
            assert not OTHER.search(words), f"{key} [{code}] is in another language's script: {text!r}"
        assert "'" not in words or code not in ("en", "fr", "it", "tr"), f"{key} [{code}]: a straight apostrophe"
        if code == "fr":
            assert not re.search(r"\S [?!;:»]|« ", words), f"{key} [fr]: an ordinary space where French sets a no-break one"

def snapshot():
    return {str(p.relative_to(dist)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in dist.rglob("*") if p.is_file()}

before = snapshot()
rebuild()
assert snapshot() == before, "repeated builds must be byte-for-byte deterministic"
print(f"Publication checks passed: {len(pages)} pages, {len(before)} files; assets, CSP, stale-file cleanup and repeatability")
