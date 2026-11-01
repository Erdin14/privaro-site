#!/usr/bin/env python3
"""Generate the localized static pages from templates + i18n JSON.

Run from the repo root:  python3 build.py
English is written to the repo root (/index.html, /pro.html); every other
language gets its own folder (/es/index.html, /es/pro.html, ...). Output is
committed for the existing Vercel setup. Each build also packages only the
intended public files into dist/, the Cloudflare Pages build output directory.

Shared pieces live in templates/partials/ and are pulled in with {{HEADER}}
and {{FOOTER}}. The build also writes 404.html, sitemap.xml and robots.txt,
and the security headers for both hosts: _headers for Cloudflare Pages
(privaroapp.nl) and the "headers" in vercel.json, from SECURITY_HEADERS below.
Pages in ENGLISH_ONLY (the security overview) are written once, to the root.

Prices: Pro's App Store price per country comes from the App Store Connect
CSV exports in i18n/prices/; i18n/prices.json says how to fall back. Each page
is written with the price for its language's country ({{PRICE}}), and
price.js swaps in the visitor's own country's price in their browser.
i18n/timezones.json maps time zones to countries; it was generated from the
IANA tz database (zone.tab plus its links) and only needs a refresh if that
changes.
"""
import base64
import csv
import glob
import hashlib
import json
import os
import re
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE_URL = "https://privaroapp.nl"
PUBLIC_DIR = os.path.join(ROOT, "dist")

# Security headers for every response, on both hosts. Nothing on the site needs
# more than this: every script and file is our own, there are no forms, frames,
# fonts or third-party requests, and no page needs the camera, location or the
# like. The Content Security Policy is built in content_security_policy().
SECURITY_HEADERS = [
    # Browsers that have been here once refuse plain HTTP for a year, on every
    # subdomain too. Not "preload": that's a separate, slow-to-undo opt-in.
    ("Strict-Transport-Security", "max-age=31536000; includeSubDomains"),
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    # Cross-site, only the origin is sent: App Store Connect still sees visits
    # came from privaroapp.nl, never which page.
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("Permissions-Policy", ", ".join(f"{feature}=()" for feature in (
        "accelerometer", "bluetooth", "browsing-topics", "camera", "display-capture", "geolocation",
        "gyroscope", "hid", "magnetometer", "microphone", "midi", "payment", "serial", "usb"))),
    # No other window gets a handle on ours, and no other site can embed our files.
    ("Cross-Origin-Opener-Policy", "same-origin"),
    ("Cross-Origin-Resource-Policy", "same-origin"),
    ("X-Permitted-Cross-Domain-Policies", "none"),
]
INLINE_SCRIPT = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S)
# Our own stylesheets and scripts, as the pages link them.
LOCAL_ASSET = re.compile(r'((?:href|src)=")(/[\w./-]+\.(?:css|js))(")')

# code, url-folder ("" = repo root), html lang attribute, autonym shown in the menu
LANGS = [
    ("en", "", "en", "English"),
    ("es", "es", "es", "Español"),
    ("fr", "fr", "fr", "Français"),
    ("de", "de", "de", "Deutsch"),
    ("it", "it", "it", "Italiano"),
    ("pt-BR", "pt-br", "pt-BR", "Português"),
    ("zh-Hans", "zh", "zh-Hans", "简体中文"),
    ("ko", "ko", "ko", "한국어"),
    ("nl", "nl", "nl", "Nederlands"),
    ("ja", "ja", "ja", "日本語"),
    ("zh-Hant", "zh-hant", "zh-Hant", "繁體中文"),
    ("ru", "ru", "ru", "Русский"),
    ("tr", "tr", "tr", "Türkçe"),
    ("id", "id", "id", "Bahasa Indonesia"),
    ("hi", "hi", "hi", "हिन्दी"),
    ("ar", "ar", "ar", "العربية"),
    ("ur", "ur", "ur", "اردو"),
]
FOLDER = {code: folder for code, folder, _, _ in LANGS}
# The homepage screenshots, taken in each language. English's sit at the top of
# the folder, every other language's in a subfolder named like its pages' folder.
SHOTS = "/shots/framed-18-pro-max/"
OG_LOCALE = {"en": "en_US", "es": "es_ES", "fr": "fr_FR", "de": "de_DE", "it": "it_IT",
             "pt-BR": "pt_BR", "zh-Hans": "zh_CN", "ko": "ko_KR", "nl": "nl_NL",
             "ja": "ja_JP", "zh-Hant": "zh_TW", "ru": "ru_RU", "tr": "tr_TR", "id": "id_ID",
             "hi": "hi_IN", "ar": "ar_AR", "ur": "ur_PK"}
AUTONYM = {code: name for code, _, _, name in LANGS}
# Written right to left: the page gets dir="rtl" and the CSS mirrors itself.
RTL = {"ar", "ur"}

PAGES = {"index": "index.html", "pro": "pro.html", "faq": "faq.html", "privacy": "privacy.html", "terms": "terms.html"}
# Written in English only, at the root; every language's footer links to them.
ENGLISH_ONLY = {"security": "security.html"}
# Which meta_title_* / meta_desc_* strings each page uses.
META = {"index": "home", "pro": "pro", "faq": "faq", "privacy": "privacy", "terms": "terms", "security": "security"}

GLOBE = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
         'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/>'
         '<path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20z"/></svg>')
# Points up, the way the menu opens; turned over while it's open.
CHEVRON = ('<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" '
           'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>')
CHECK = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" '
         'stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>')


# How each page language writes a price, matching the browser's
# Intl.NumberFormat with currencyDisplay "narrowSymbol", so the price written
# into the page is the same text price.js would write. Only the currencies a
# page's own country can have are needed here; price.js formats the rest.
RLM = "‏"
SYMBOL = {"USD": "$", "EUR": "€", "BRL": "R$", "CNY": "¥", "KRW": "₩", "JPY": "¥", "TWD": "$", "RUB": "₽",
          "TRY": "₺", "IDR": "Rp", "INR": "₹", "SAR": "ر.س." + RLM, "PKR": "Rs"}
# Where a language writes a currency's symbol its own way: Japanese uses the full-width yen sign.
LANG_SYMBOL = {("ja", "JPY"): "￥"}
DIGITS = {"KRW": 0, "JPY": 0, "IDR": 0, "PKR": 0}
NBSP, NNBSP = " ", " "
# language: (symbol first?, space between symbol and number, group sep, decimal sep, min digits before grouping)
NUMBER_STYLE = {
    "en": (True, "", ",", ".", 4), "zh-Hans": (True, "", ",", ".", 4), "ko": (True, "", ",", ".", 4),
    "es": (False, NBSP, ".", ",", 5), "de": (False, NBSP, ".", ",", 4), "it": (False, NBSP, ".", ",", 5),
    "fr": (False, NBSP, NNBSP, ",", 4), "pt-BR": (True, NBSP, ".", ",", 4), "nl": (True, NBSP, ".", ",", 4),
    "ja": (True, "", ",", ".", 4), "zh-Hant": (True, "", ",", ".", 4), "ru": (False, NBSP, NBSP, ",", 4),
    "tr": (True, "", ".", ",", 4), "id": (True, NBSP, ".", ",", 4), "hi": (True, "", ",", ".", 4),
    "ar": (False, NBSP, ",", ".", 4), "ur": (True, NBSP, ",", ".", 4),
}
# Hindi groups the digits above the thousands in pairs: 12,34,567.
INDIAN_GROUPING = {"hi"}
# Arabic starts a price with a right-to-left mark, so it sits right inside a sentence.
PREFIX = {"ar": RLM}


def group_digits(whole, sep, indian):
    if not indian:
        return f"{int(whole):,}".replace(",", sep)
    head, groups = whole[:-3], [whole[-3:]]
    while head:
        groups.insert(0, head[-2:])
        head = head[:-2]
    return sep.join(groups)


def format_price(amount, currency, lang):
    if currency not in SYMBOL:
        raise SystemExit(f"build.py can't write {currency} prices yet: add it to SYMBOL (and DIGITS if needed)")
    first, space, group, dec, min_group = NUMBER_STYLE[lang]
    digits = 0 if amount == int(amount) else DIGITS.get(currency, 2)
    whole, _, frac = f"{amount:.{digits}f}".partition(".")
    if len(whole) >= min_group:
        whole = group_digits(whole, group, lang in INDIAN_GROUPING)
    number = whole + (dec + frac if frac else "")
    sym = LANG_SYMBOL.get((lang, currency), SYMBOL[currency])
    price = f"{sym}{space}{number}" if first else f"{number}{space}{sym}"
    return PREFIX.get(lang, "") + price


def load_pricing():
    with open(os.path.join(ROOT, "i18n", "prices.json"), encoding="utf-8") as f:
        data = json.load(f)
    with open(os.path.join(ROOT, "i18n", "countries.json"), encoding="utf-8") as f:
        codes = json.load(f)
    prices = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "i18n", "prices", "*.csv"))):
        with open(path, encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                name = row["Countries or Regions"]
                if name not in codes:
                    raise SystemExit(f"{os.path.basename(path)}: no country code for {name!r}; add it to i18n/countries.json")
                price = (row["Currency Code"], float(row["Price"]))
                cc = codes[name]
                if prices.get(cc, price) != price:
                    raise SystemExit(f"Two different prices for {name}: {prices[cc]} and {price}")
                prices[cc] = price
    if data["base"] not in prices:
        raise SystemExit("prices.json: the base country needs a price")
    with open(os.path.join(ROOT, "i18n", "timezones.json"), encoding="utf-8") as f:
        zones = json.load(f)
    return {"base": data["base"], "lang": data["lang_country"], "prices": prices, "usd_local": data["usd_local"],
            # Only the time zones of countries with a price matter to price.js.
            "zones": {z: cc for z, cc in zones.items() if cc in prices}}


def price_tokens(pricing, code):
    """{{PRICE}} for one language, in its own country's currency."""
    cc = pricing["lang"].get(code)
    currency, amount = pricing["prices"][cc if cc in pricing["prices"] else pricing["base"]]
    return {"{{PRICE}}": f'<span class="price" data-price="pro">{format_price(amount, currency, code)}</span>'}


def load_strings():
    strings = {}
    for fname in ("i18n/strings.json", "i18n/strings-pro.json", "i18n/strings-faq.json",
                  "i18n/strings-privacy.json", "i18n/strings-terms.json", "i18n/strings-security.json"):
        with open(os.path.join(ROOT, fname), encoding="utf-8") as f:
            strings.update(json.load(f))
    return strings


def page_url(page, code):
    folder = FOLDER[code]
    if page == "index":
        return "/" if folder == "" else "/" + folder
    prefix = "/" if folder == "" else "/" + folder + "/"
    return prefix + page


def out_path(page, code):
    folder = FOLDER[code]
    name = PAGES[page]
    return name if folder == "" else os.path.join(folder, name)


def hreflang_block(page):
    lines = []
    for code, _, htmllang, _ in LANGS:
        lines.append(f'<link rel="alternate" hreflang="{htmllang}" href="{BASE_URL}{page_url(page, code)}" />')
    lines.append(f'<link rel="alternate" hreflang="x-default" href="{BASE_URL}{page_url(page, "en")}" />')
    return "\n".join(lines)


def seo_block(page, code, alternates=True):
    """Canonical URL, language alternates, and the tags that make link previews work."""
    url = BASE_URL + page_url(page, code)
    meta = META[page]
    return "\n".join([
        f'<link rel="canonical" href="{url}" />',
        *([hreflang_block(page)] if alternates else []),
        '<meta property="og:type" content="website" />',
        '<meta property="og:site_name" content="Privaro" />',
        f'<meta property="og:title" content="{{{{meta_title_{meta}}}}}" />',
        f'<meta property="og:description" content="{{{{meta_desc_{meta}}}}}" />',
        f'<meta property="og:url" content="{url}" />',
        f'<meta property="og:image" content="{BASE_URL}/og.jpg" />',
        '<meta property="og:image:width" content="1200" />',
        '<meta property="og:image:height" content="630" />',
        f'<meta property="og:locale" content="{OG_LOCALE[code]}" />',
        '<meta name="twitter:card" content="summary_large_image" />',
    ])


def switcher_block(page, cur, label):
    items = []
    for code, _, htmllang, name in LANGS:
        if code == cur:
            items.append(f'<a href="{page_url(page, code)}" lang="{htmllang}" hreflang="{htmllang}" class="active" '
                         f'aria-current="true"><span>{name}</span>{CHECK}</a>')
        else:
            items.append(f'<a href="{page_url(page, code)}" lang="{htmllang}" hreflang="{htmllang}">'
                         f'<span>{name}</span></a>')
    return (f'<details class="lang"><summary aria-label="{label}">{GLOBE}'
            f'<span>{AUTONYM[cur]}</span>{CHEVRON}</summary>'
            f'<div class="lang-menu"><p class="lang-head">{label}</p>'
            f'<div class="lang-list">{"".join(items)}</div></div></details>')


def read_template(name):
    with open(os.path.join(ROOT, "templates", name), encoding="utf-8") as f:
        html = f.read()
    for part in ("header", "footer", "vignette"):
        with open(os.path.join(ROOT, "templates", "partials", part + ".html"), encoding="utf-8") as f:
            html = html.replace("{{" + part.upper() + "}}", f.read().rstrip("\n"))
    return html


def public_pages():
    """Only generated visitor-facing pages; never templates, legacy or dist/."""
    return ([out_path(page, code) for page in PAGES for code, _, _, _ in LANGS]
            + list(ENGLISH_ONLY.values()) + ["404.html"])


def inline_script_hashes():
    """The SHA-256 of every inline <script> on every page we serve, for the
    Content Security Policy. Read from the written pages, so a script edited in
    a template is allowed as soon as the build runs, and nothing else is."""
    hashes = set()
    for rel in public_pages():
        with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
            for body in INLINE_SCRIPT.findall(f.read()):
                hashes.add(base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode())
    return sorted(hashes)


def content_security_policy():
    """Scripts run only from our own files and the inline ones in our pages,
    each pinned by its hash, so a script injected anywhere can't run. Inline
    styles stay allowed: the pages set values like --anim in style attributes,
    and CSS can't run code. Images and the film come from this site only;
    nothing else is fetched, nothing may frame a page, and no form can post."""
    scripts = " ".join(f"'sha256-{h}'" for h in inline_script_hashes())
    return "; ".join([
        "default-src 'none'",
        f"script-src 'self' {scripts}",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self'",
        "media-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
    ])


def write_security_headers():
    """_headers for Cloudflare Pages and the headers in vercel.json, the same
    on both. Cloudflare Pages also adds Access-Control-Allow-Origin: * to every
    response by default; the "!" line takes it off."""
    headers = [("Content-Security-Policy", content_security_policy())] + SECURITY_HEADERS
    lines = ["# Written by build.py from SECURITY_HEADERS: edit it there, and vercel.json",
             "# gets the same. Cloudflare Pages (privaroapp.nl) reads this file.",
             "/*", "  ! Access-Control-Allow-Origin"]
    lines += [f"  {name}: {value}" for name, value in headers]
    lines += ["", "/.well-known/apple-app-site-association", "  Content-Type: application/json"]
    write("_headers", "\n".join(lines) + "\n")

    path = os.path.join(ROOT, "vercel.json")
    with open(path, encoding="utf-8") as f:
        config = json.load(f)
    # vercel.app sends its own HSTS (and is preloaded), so it's left to Vercel there.
    config["headers"] = [
        {"source": "/(.*)", "headers": [{"key": name, "value": value} for name, value in headers
                                        if name != "Strict-Transport-Security"]},
        {"source": "/.well-known/apple-app-site-association",
         "headers": [{"key": "Content-Type", "value": "application/json"}]},
    ]
    write("vercel.json", json.dumps(config, indent=2, ensure_ascii=False) + "\n")


def film_version():
    """A short fingerprint of everything in film/. The page asks for the film by
    a URL that ends in it, so replacing the film changes its URLs and browsers
    fetch it again instead of replaying the copy they kept (privaroapp.nl lets
    them keep video for hours)."""
    digest = hashlib.sha256()
    for path in sorted(glob.glob(os.path.join(ROOT, "film", "*"))):
        digest.update(os.path.basename(path).encode())
        with open(path, "rb") as f:
            digest.update(f.read())
    return digest.hexdigest()[:10]


def film_block(code):
    """The homepage film. Its words are in the picture, in English, so only the
    English homepage shows it; every other language's page goes without."""
    if code != "en":
        return ""
    with open(os.path.join(ROOT, "templates", "partials", "film.html"), encoding="utf-8") as f:
        return "\n" + f.read().rstrip("\n").replace("{{FILM_VERSION}}", film_version()) + "\n"


def render(html, page, code, htmllang, head, strings, pricing):
    """Fill in a template for one language. `page` decides where the language links go."""
    html = html.replace("{{FILM}}", film_block(code))
    html = html.replace("{{LANG}}", htmllang)
    html = html.replace("{{DIR}}", "rtl" if code in RTL else "ltr")
    html = html.replace("{{SHOTS}}", SHOTS + (FOLDER[code] + "/" if FOLDER[code] else ""))
    html = html.replace("{{SEO}}", head)
    label = strings["lang_label"].get(code, strings["lang_label"]["en"])
    html = html.replace("{{SWITCHER}}", switcher_block(page, code, label))
    html = html.replace("{{HOME_URL}}", page_url("index", code))
    html = html.replace("{{PRO_URL}}", page_url("pro", code))
    html = html.replace("{{FAQ_URL}}", page_url("faq", code))
    html = html.replace("{{PRIVACY_URL}}", page_url("privacy", code))
    html = html.replace("{{TERMS_URL}}", page_url("terms", code))
    html = html.replace("{{SECURITY_URL}}", page_url("security", "en"))
    for key, vals in strings.items():
        html = html.replace("{{" + key + "}}", vals.get(code, vals["en"]))
    for token, value in price_tokens(pricing, code).items():
        html = html.replace(token, value)
    if "{{" in html:
        leftover = html[html.index("{{"):html.index("{{") + 40]
        raise SystemExit(f"Unreplaced token in {page}/{code}: {leftover!r}")
    return html


def fingerprint(rel):
    """A short hash of one of our files, for its URL."""
    with open(os.path.join(ROOT, rel.lstrip("/")), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:10]


def version_assets(html):
    """Every stylesheet and script a page links gets ?v= and a hash of its
    contents. privaroapp.nl lets browsers keep these for hours, so without it a
    returning visitor gets a new page with yesterday's CSS; with it, changing a
    file changes its URL and browsers fetch it again."""
    return LOCAL_ASSET.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={fingerprint(m.group(2))}{m.group(3)}", html)


def write(rel, text):
    if rel.endswith(".html"):
        text = version_assets(text)
    dest = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    with open(dest, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("wrote", rel)


def sitemap():
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
           'xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for page in PAGES:
        alternates = [f'    <xhtml:link rel="alternate" hreflang="{htmllang}" href="{BASE_URL}{page_url(page, c)}" />'
                      for c, _, htmllang, _ in LANGS]
        for code, _, _, _ in LANGS:
            out.append("  <url>")
            out.append(f"    <loc>{BASE_URL}{page_url(page, code)}</loc>")
            out.extend(alternates)
            out.append("  </url>")
    for page in ENGLISH_ONLY:
        out.extend(["  <url>", f"    <loc>{BASE_URL}{page_url(page, 'en')}</loc>", "  </url>"])
    out.append("</urlset>")
    return "\n".join(out) + "\n"


def package_public_site():
    """Recreate the publication artifact from an explicit public-file manifest."""
    files = public_pages() + [
        "_headers", "_redirects", "robots.txt", "sitemap.xml",
        ".well-known/apple-app-site-association", ".well-known/security.txt",
        "styles.css", "transitions.css", "decrypt.js", "film.js",
        "presentation.js", "price.js", "privacy-vignette.js",
        "appstore-badge.svg", "appstore-badge-white.svg", "logo.png", "og.jpg",
    ]
    # Only media belongs in these asset trees; hidden/build/config files do not.
    for directory in ("art", "shots", "film"):
        for current, dirs, names in os.walk(os.path.join(ROOT, directory)):
            if any(os.path.islink(os.path.join(current, name)) for name in dirs + names):
                raise SystemExit("Refusing symlinks in public asset trees")
            dirs[:] = sorted(name for name in dirs if not name.startswith("."))
            for name in sorted(names):
                if not name.startswith(".") and os.path.splitext(name)[1].lower() in {
                    ".png", ".jpg", ".jpeg", ".svg", ".webp", ".avif", ".mp4"
                }:
                    files.append(os.path.relpath(os.path.join(current, name), ROOT))

    # Resolve and check the exact fixed target before removing a stale artifact.
    # Never let a symlink/junction redirect cleanup outside this repository.
    if os.path.realpath(PUBLIC_DIR) != os.path.join(os.path.realpath(ROOT), "dist"):
        raise SystemExit("Refusing an output directory redirected outside ROOT/dist")
    if os.path.lexists(PUBLIC_DIR):
        if os.path.islink(PUBLIC_DIR) or not os.path.isdir(PUBLIC_DIR):
            raise SystemExit("dist must be a real directory")
        shutil.rmtree(PUBLIC_DIR)
    for rel in files:
        source = os.path.join(ROOT, rel)
        expected = os.path.normpath(os.path.join(os.path.realpath(ROOT), rel))
        if os.path.normcase(os.path.realpath(source)) != os.path.normcase(expected):
            raise SystemExit(f"Refusing redirected public source: {rel}")
        dest = os.path.join(PUBLIC_DIR, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(source, dest)
    print(f"packaged {len(files)} public files into dist/")


def main():
    strings = load_strings()
    pricing = load_pricing()
    # price.js first: the pages link it by a hash of its contents.
    with open(os.path.join(ROOT, "templates", "price.js"), encoding="utf-8") as f:
        script = f.read()
    data = {"base": pricing["base"], "lang": pricing["lang"], "zones": pricing["zones"], "usd": pricing["usd_local"],
            "prices": {cc: [cur, amt] for cc, (cur, amt) in sorted(pricing["prices"].items())}}
    write("price.js", script.replace("/*DATA*/null", json.dumps(data, ensure_ascii=False, separators=(",", ":"))))
    for page, _ in PAGES.items():
        template = read_template(PAGES[page])
        for code, _, htmllang, _ in LANGS:
            html = render(template, page, code, htmllang, seo_block(page, code), strings, pricing)
            write(out_path(page, code), html)

    # English only, with no language alternates; like the 404's, the language
    # menu leads to each homepage.
    for page, name in ENGLISH_ONLY.items():
        html = render(read_template(name), "index", "en", "en", seo_block(page, "en", alternates=False),
                      strings, pricing)
        write(name, html)

    # One English 404 for every path; its language menu leads to each homepage.
    html = render(read_template("404.html"), "index", "en", "en",
                  '<meta name="robots" content="noindex" />', strings, pricing)
    write("404.html", html)


    write("sitemap.xml", sitemap())
    write("robots.txt", f"User-agent: *\nDisallow: /screenshots\n\nSitemap: {BASE_URL}/sitemap.xml\n")

    # Last: the policy pins the inline scripts of the pages written above.
    write_security_headers()
    package_public_site()


if __name__ == "__main__":
    main()
