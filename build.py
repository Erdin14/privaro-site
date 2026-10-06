#!/usr/bin/env python3
"""Generate the localized static pages from templates + i18n JSON.

Run from the repo root:  python3 build.py
English is written to the repo root (/index.html, /pro.html); every other
language gets its own folder (/es/index.html, /es/pro.html, ...). Output is
committed, so Vercel just serves static files (no build step on their end).

Shared pieces live in templates/partials/ and are pulled in with {{HEADER}}
and {{FOOTER}}. The build also writes 404.html, sitemap.xml and robots.txt.

Prices: Pro's App Store price per country comes from the App Store Connect
CSV exports in i18n/prices/; i18n/prices.json says how to fall back. Each page
is written with the price for its language's country ({{PRICE}},
{{PRICE_FREE}}), and price.js swaps in the visitor's own country's price in
their browser.
i18n/timezones.json maps time zones to countries; it was generated from the
IANA tz database (zone.tab plus its links) and only needs a refresh if that
changes.
"""
import csv
import glob
import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE_URL = "https://privaro-site.vercel.app"

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
]
FOLDER = {code: folder for code, folder, _, _ in LANGS}
OG_LOCALE = {"en": "en_US", "es": "es_ES", "fr": "fr_FR", "de": "de_DE", "it": "it_IT",
             "pt-BR": "pt_BR", "zh-Hans": "zh_CN", "ko": "ko_KR", "nl": "nl_NL"}
AUTONYM = {code: name for code, _, _, name in LANGS}

PAGES = {"index": "index.html", "pro": "pro.html", "privacy": "privacy.html", "terms": "terms.html"}
# Which meta_title_* / meta_desc_* strings each page uses.
META = {"index": "home", "pro": "pro", "privacy": "privacy", "terms": "terms"}

GLOBE = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
         'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/>'
         '<path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20z"/></svg>')


# How each page language writes a price, matching the browser's
# Intl.NumberFormat with currencyDisplay "narrowSymbol", so the price written
# into the page is the same text price.js would write. Only the currencies a
# page's own country can have are needed here; price.js formats the rest.
SYMBOL = {"USD": "$", "EUR": "€", "BRL": "R$", "CNY": "¥", "KRW": "₩"}
DIGITS = {"KRW": 0}
NBSP, NNBSP = "\u00a0", "\u202f"
# language: (symbol first?, space between symbol and number, group sep, decimal sep, min digits before grouping)
NUMBER_STYLE = {
    "en": (True, "", ",", ".", 4), "zh-Hans": (True, "", ",", ".", 4), "ko": (True, "", ",", ".", 4),
    "es": (False, NBSP, ".", ",", 5), "de": (False, NBSP, ".", ",", 4), "it": (False, NBSP, ".", ",", 5),
    "fr": (False, NBSP, NNBSP, ",", 4), "pt-BR": (True, NBSP, ".", ",", 4), "nl": (True, NBSP, ".", ",", 4),
}


def format_price(amount, currency, lang):
    if currency not in SYMBOL:
        raise SystemExit(f"build.py can't write {currency} prices yet: add it to SYMBOL (and DIGITS if needed)")
    first, space, group, dec, min_group = NUMBER_STYLE[lang]
    digits = 0 if amount == int(amount) else DIGITS.get(currency, 2)
    whole, _, frac = f"{amount:.{digits}f}".partition(".")
    if len(whole) >= min_group:
        whole = f"{int(whole):,}".replace(",", group)
    number = whole + (dec + frac if frac else "")
    sym = SYMBOL[currency]
    return f"{sym}{space}{number}" if first else f"{number}{space}{sym}"


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
    """{{PRICE}} and {{PRICE_FREE}} for one language, in its own country's currency."""
    cc = pricing["lang"].get(code)
    currency, amount = pricing["prices"][cc if cc in pricing["prices"] else pricing["base"]]
    span = '<span class="price" data-price="{}">{}</span>'
    return {"{{PRICE}}": span.format("pro", format_price(amount, currency, code)),
            "{{PRICE_FREE}}": span.format("free", format_price(0, currency, code))}


def load_strings():
    strings = {}
    for fname in ("i18n/strings.json", "i18n/strings-pro.json",
                  "i18n/strings-privacy.json", "i18n/strings-terms.json"):
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


def seo_block(page, code):
    """Canonical URL, language alternates, and the tags that make link previews work."""
    url = BASE_URL + page_url(page, code)
    meta = META[page]
    return "\n".join([
        f'<link rel="canonical" href="{url}" />',
        hreflang_block(page),
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
    for code, _, _, name in LANGS:
        active = ' class="active"' if code == cur else ""
        items.append(f'<a href="{page_url(page, code)}"{active}>{name}</a>')
    return (f'<details class="lang"><summary aria-label="{label}">{GLOBE}'
            f'<span>{AUTONYM[cur]}</span></summary>'
            f'<div class="lang-menu">{"".join(items)}</div></details>')


def read_template(name):
    with open(os.path.join(ROOT, "templates", name), encoding="utf-8") as f:
        html = f.read()
    for part in ("header", "footer"):
        with open(os.path.join(ROOT, "templates", "partials", part + ".html"), encoding="utf-8") as f:
            html = html.replace("{{" + part.upper() + "}}", f.read().rstrip("\n"))
    return html


def render(html, page, code, htmllang, head, strings, pricing):
    """Fill in a template for one language. `page` decides where the language links go."""
    html = html.replace("{{LANG}}", htmllang)
    html = html.replace("{{SEO}}", head)
    label = strings["lang_label"].get(code, strings["lang_label"]["en"])
    html = html.replace("{{SWITCHER}}", switcher_block(page, code, label))
    html = html.replace("{{HOME_URL}}", page_url("index", code))
    html = html.replace("{{PRO_URL}}", page_url("pro", code))
    html = html.replace("{{PRIVACY_URL}}", page_url("privacy", code))
    html = html.replace("{{TERMS_URL}}", page_url("terms", code))
    for nav in ("pro", "privacy"):
        html = html.replace("{{CUR_" + nav + "}}", ' aria-current="page"' if nav == page else "")
    for key, vals in strings.items():
        html = html.replace("{{" + key + "}}", vals.get(code, vals["en"]))
    for token, value in price_tokens(pricing, code).items():
        html = html.replace(token, value)
    if "{{" in html:
        leftover = html[html.index("{{"):html.index("{{") + 40]
        raise SystemExit(f"Unreplaced token in {page}/{code}: {leftover!r}")
    return html


def write(rel, text):
    dest = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
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
    out.append("</urlset>")
    return "\n".join(out) + "\n"


def main():
    strings = load_strings()
    pricing = load_pricing()
    for page, _ in PAGES.items():
        template = read_template(PAGES[page])
        for code, _, htmllang, _ in LANGS:
            html = render(template, page, code, htmllang, seo_block(page, code), strings, pricing)
            write(out_path(page, code), html)

    # One English 404 for every path; its language menu leads to each homepage.
    html = render(read_template("404.html"), "index", "en", "en",
                  '<meta name="robots" content="noindex" />', strings, pricing)
    write("404.html", html)

    with open(os.path.join(ROOT, "templates", "price.js"), encoding="utf-8") as f:
        script = f.read()
    data = {"base": pricing["base"], "lang": pricing["lang"], "zones": pricing["zones"], "usd": pricing["usd_local"],
            "prices": {cc: [cur, amt] for cc, (cur, amt) in sorted(pricing["prices"].items())}}
    write("price.js", script.replace("/*DATA*/null", json.dumps(data, ensure_ascii=False, separators=(",", ":"))))

    write("sitemap.xml", sitemap())
    write("robots.txt", f"User-agent: *\nDisallow: /screenshots\n\nSitemap: {BASE_URL}/sitemap.xml\n")


if __name__ == "__main__":
    main()
