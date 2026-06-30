#!/usr/bin/env python3
"""Generate the localized static pages from templates + i18n JSON.

Run from the repo root:  python3 build.py
English is written to the repo root (/index.html, /pro.html); every other
language gets its own folder (/es/index.html, /es/pro.html, ...). Output is
committed, so Vercel just serves static files (no build step on their end).
"""
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
AUTONYM = {code: name for code, _, _, name in LANGS}

PAGES = {"index": "index.html", "pro": "pro.html"}

GLOBE = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
         'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/>'
         '<path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20z"/></svg>')


def load_strings():
    strings = {}
    for fname in ("i18n/strings.json", "i18n/strings-pro.json"):
        with open(os.path.join(ROOT, fname), encoding="utf-8") as f:
            strings.update(json.load(f))
    return strings


def page_url(page, code):
    folder = FOLDER[code]
    if page == "index":
        return "/" if folder == "" else "/" + folder
    prefix = "/" if folder == "" else "/" + folder + "/"
    return prefix + "pro"


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


def switcher_block(page, cur, label):
    items = []
    for code, _, _, name in LANGS:
        active = ' class="active"' if code == cur else ""
        items.append(f'<a href="{page_url(page, code)}"{active}>{name}</a>')
    return (f'<details class="lang"><summary aria-label="{label}">{GLOBE}'
            f'<span>{AUTONYM[cur]}</span></summary>'
            f'<div class="lang-menu">{"".join(items)}</div></details>')


def main():
    strings = load_strings()
    for page, _ in PAGES.items():
        with open(os.path.join(ROOT, "templates", PAGES[page]), encoding="utf-8") as f:
            template = f.read()
        for code, _, htmllang, _ in LANGS:
            html = template
            html = html.replace("{{LANG}}", htmllang)
            html = html.replace("{{HREFLANG}}", hreflang_block(page))
            label = strings["lang_label"].get(code, strings["lang_label"]["en"])
            html = html.replace("{{SWITCHER}}", switcher_block(page, code, label))
            html = html.replace("{{HOME_URL}}", page_url("index", code))
            html = html.replace("{{PRO_URL}}", page_url("pro", code))
            for key, vals in strings.items():
                html = html.replace("{{" + key + "}}", vals.get(code, vals["en"]))
            if "{{" in html:
                leftover = html[html.index("{{"):html.index("{{") + 40]
                raise SystemExit(f"Unreplaced token in {page}/{code}: {leftover!r}")
            dest = os.path.join(ROOT, out_path(page, code))
            os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
            with open(dest, "w", encoding="utf-8") as f:
                f.write(html)
            print("wrote", out_path(page, code))


if __name__ == "__main__":
    main()
