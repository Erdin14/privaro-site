# Privaro static website

Run `python3 build.py` from this directory. It regenerates the committed pages
and creates a fresh `dist/` containing only public pages, assets, `.well-known`
files, `_headers` and `_redirects`. Build inputs, legacy/concept pages and host
configuration are excluded. Only published pages contribute CSP script hashes.

The original Vercel setup still uses committed generated files and its existing
configuration. `.vercelignore` additionally excludes the concept page and new
development-only files. Cloudflare must publish **dist/**, not this repository
root. `.vercelignore` does not configure Cloudflare publication.

## Validate locally

Requires Python 3; no packages need installing:

```sh
python3 tests/publication.py
```

The publication check verifies 120 pages (seven in each of 17 languages, and the
404), local links/assets and their versions, CSP hashes, required special
files, excluded paths, stale-output cleanup and repeatable builds. It also
checks what a search engine reads: every canonical, `hreflang`, `og:url` and
sitemap address is one Cloudflare serves directly, never one it redirects
(`/nl/`, not `/nl`); language alternates are reciprocal; structured data is
valid JSON and claims no rating; the link preview picture is the file, and the
size, every page says it is. And it checks the translations: every string
exists in every language, in that language's own script, with typographic
apostrophes and, in French, no-break spaces before `? ! ; :`. (The reading
pages no longer hide anything until it is scrolled to, so there is no longer a
fragment check: an anchor can't land on hidden text.)

## The link preview picture

`og.jpg` (1200 by 630) is what a link to the site is shown with in Messages,
WhatsApp, Discord, X and the rest. It is drawn by `og/og.html`, a page that
uses the site's own screenshots, badge and graphite, and photographed by
`og/render.js`. The notes in `og/og.html` say what lines up with what.

To change it, edit `og/og.html`, then:

```sh
node og/render.js preview.jpg   # look first
node og/render.js               # writes og.jpg
python3 build.py                # every page names og.jpg by its hash
python3 tests/publication.py
```

`render.js` needs Node, Playwright with its Chromium
(`npm install --no-save playwright && npx playwright install chromium`) and
the [Inter](https://rsms.me/inter/) typeface installed; it stops, and writes
nothing, if the words were drawn in any other face. None of this is needed to
build or publish the site: the picture is committed, and `og/` is published by
neither host. Rendering twice gives the same file, byte for byte, on one
machine; another machine's Chromium may differ in a few bytes, so the hash in
the pages changes only when the picture is rendered again.

Apps keep a link's preview for days, so one shared before a change may show
the old picture for a while. The new address (`og.jpg?v=…`) is what a fresh
share fetches.

## The working demo: "Inside the encryption"

`/encryption` is a page of its own: a small exhibit in eight steps, taken at
the visitor's pace (nothing moves on until they press). Their own browser
makes a 256-bit key, encrypts a photo with AES-256-GCM through the Web
Crypto API (a key for the file derived by HKDF-SHA256; twelve pieces, each
under its own random nonce and each authenticating the file's header and
its own position), stores the result, really tries a wrong key, the right
key with one bit flipped, and a changed bit in the file, and decrypts it
again, checked against a SHA-256 of the original. The noise on screen is the ciphertext itself, drawn as pixels. It
can run on a photo the visitor picks, which never leaves the tab.

- `templates/encryption.html` is the page, `encryption-demo.js` the script,
  `i18n/strings-encryption.json` every word of it, and the "Inside" part of
  `styles.css` how it looks. The notes at the top of each say how it works
  and why.
- Ways in: a row under the homepage's security facts, in every language
  (`home_inside_t`, `home_inside_d`), and a sentence in the Security
  overview's "Photos and videos".
- English only, like the Security overview, and framed the same way: every
  language has a copy under its own header and footer, with a line saying
  it's in English, and only the root one is indexed (`ENGLISH_ONLY` in
  `build.py`). Its words make security claims, so they should be translated
  by someone who can check them, not in bulk.
- It is a small model of what the Security overview describes, not the
  app's code or its file format, and the page says so twice: in its
  opening, and in "A simplified demo" under the exhibit, which lists each
  difference. Keep that true when the demo or the app changes.
- It claims nothing about erasing memory. The script stops using its copy
  of the photo once it's encrypted, and tidies up after itself, but a web
  page can't promise what a browser keeps, and the words say "stops using",
  never "wipes" or "erases".
- `tests/publication.py` holds it to its claims: the script uses nothing
  that could send or keep data; the Content Security Policy still has no
  `connect-src`; the numbers in the words are the ones the script and
  stylesheet use; no string promises erasure; every homepage links to its
  own language's copy and carries none of the demo itself.
- It needs a secure context (HTTPS, or `localhost`) for Web Crypto. Without
  it, or without JavaScript, the page is the photo and the steps to read.
- The scene's poses are set in pixels, per layout, in `styles.css`; next to
  them, `--reach-x` and `--reach-y` say how far from the middle of the view
  they go. Where the view is smaller (a short window, a narrow column, a
  small phone) the script draws the whole scene smaller to fit, so nothing
  is cut off. Change a pose, and measure and change its reach with it.

## What is published, and what stays in the source

The templates, `styles.css` and the scripts are written with long notes.
`build.py` publishes them without: pages lose their HTML comments and the
comment lines of their inline scripts, and `dist/` gets the stylesheet and
scripts with comments, indentation and blank lines removed (nothing is
renamed or rewritten, so the published files are the same rules and the same
programs). The `?v=` on each asset's address is a hash of the published file.
Keep writing notes: they cost visitors nothing.

Two limits of the stripping, both checked by the build or the test:
a `//` note must be on a line of its own to be removed (one after code stays),
and a template literal that spans lines is published exactly as written.

## Cloudflare publication settings — apply only during an approved release

In **Workers & Pages → the existing Pages project → Settings → Builds &
deployments → Build configuration**, set framework preset **None**, root
directory to this repository's root, build command **`python3 build.py`**, and
build output directory **`dist`**. These are the command/output fields described
in [Cloudflare's build documentation](https://developers.cloudflare.com/pages/configuration/build-configuration/).
Do not change the production branch or trigger a release until the change has
been reviewed and deployment approved. Pushing any branch may trigger a preview
deployment; the local remediation branch has not been pushed.

After an approved deployment, recheck root and localized pages, gallery, film,
`/open`, sitemap, SEO links, security headers and Apple association JSON. Verify
`/build.py`, `/templates/`, `/i18n/prices.json`, `/vercel.json`, `/index.legacy`,
`/index.legacy.html`, `/screenshots` and `/screenshots.html` return real 404s.
Review any existing custom cache rules for these paths and purge specifically
cached obsolete URLs if necessary. Keep old public previews/aliases in the
account review; a new production artifact does not remove old deployments.

## Cloudflare features that rewrite the pages — manual dashboard steps

Two zone features change the HTML this repository builds after it leaves the
build. Neither can be switched off from the repository; both are dashboard
settings. Checked against the live site on 10 November 2026:

```sh
curl -s https://privaroapp.nl/ | grep -c cloudflareinsights   # 1 today, should be 0
curl -s https://privaroapp.nl/ | grep -c email-decode         # 1 today
```

### 1. Web Analytics beacon (conflicts with the site's promise and its policy)

Cloudflare adds this before `</body>` on every page:

```html
<!-- Cloudflare Pages Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "…"}'></script>
```

The site's Content Security Policy (`script-src 'self'` plus pinned hashes, no
`connect-src`) refuses it, so **it does not run and collects nothing**: the
footer's "no cookies and no trackers" is true today. What it costs is a
refused request and a red Content-Security-Policy error in the console on
every page view, which is exactly what a careful visitor to a privacy product
opens the console to look for, and a dashboard that shows no visits.

The two ways out, and the recommendation:

- **Recommended: switch it off.** The promise stays literally true and the
  console is clean.
  1. Cloudflare dashboard → **Workers & Pages** → the Pages project →
     **Metrics**. This is where Web Analytics was enabled ("Enable" under Web
     Analytics); switch it off there if the card offers it.
  2. Account home → **Web Analytics** → find `privaroapp.nl` → **Manage
     site** → choose **Disable** ("The JS Snippet will not be injected and has
     been disabled"), or delete the site from the list.
  3. Trigger a new deployment: Pages adds or removes the snippet when it
     deploys, not before.
  4. Run the first `curl` above: it should print `0`.

  Cloudflare documents the enabling step and the "Disable" option
  ([Pages](https://developers.cloudflare.com/pages/how-to/web-analytics/),
  [Web Analytics](https://developers.cloudflare.com/web-analytics/get-started/)),
  but not a turn-off step for Pages specifically, and the labels could not be
  checked from here: if a control is named differently, the goal is that the
  site no longer appears with automatic setup on the Web Analytics page.
- **Not recommended: let it run.** That needs `https://static.cloudflareinsights.com/beacon.min.js`
  in `script-src` and `connect-src 'self'` in `content_security_policy()`, and
  then the footer note, the Privacy Policy and the comment at the top of
  `styles.css` ("a site that promises no trackers") would all have to change
  in 17 languages, because a third party's script measuring visits is what
  those words rule out, however little it collects.

Visits can still be counted without anything in the page: the zone's own
traffic analytics (**Analytics & Logs**) are measured at Cloudflare's edge,
from the requests themselves, and App Store Connect → **Analytics** →
**Sources** shows `privaroapp.nl` as a web referrer for product page views and
downloads (the site's `Referrer-Policy` sends the origin for exactly this).

### 2. Email Address Obfuscation (optional; a trade-off)

Cloudflare rewrites every `mailto:` link to `/cdn-cgi/l/email-protection#…`
and adds a script (`/cdn-cgi/scripts/…/email-decode.min.js`) to every page to
turn it back. It works (the script is same-origin, so the policy allows it),
but: it is one more blocking request on every page, including the ones with
no address on them but the footer's; without JavaScript, "Contact" opens a
Cloudflare page instead of a mail draft; and the same address is published in
plain text in `/.well-known/security.txt`, which Cloudflare does not rewrite,
so little is hidden.

To switch it off: zone `privaroapp.nl` → **Security** → **Settings** → filter
by **Client-side abuse** → **Email Address Obfuscation** → **Off**
([documentation](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/)).
The cost is that address harvesters can read the address in the pages. If that
matters, the better fix is an address on the domain (Cloudflare **Email** →
**Email Routing**, free, forwarding to the current inbox) used on the site in
place of the personal one: it can be changed or dropped if it attracts spam,
and it reads better on a security product.

## Secure www redirect — manual Cloudflare steps

This uses an edge-only redirect: `www` does not need a Pages application route.
The existing apex Pages custom domain must remain active. No dashboard/DNS
changes are performed by this repository.

1. Select the **privaroapp.nl** zone. Open **SSL/TLS → Edge Certificates**.
   Confirm an **Active** edge certificate covers `www.privaroapp.nl` explicitly
   or through `*.privaroapp.nl`. Universal SSL normally covers first-level
   subdomains in a full Cloudflare zone; the apex-only certificate observed in
   the audit is not sufficient evidence for `www`. Wait for valid coverage;
   never bypass certificate errors. See [Universal SSL coverage](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/).
   Also confirm the Edge Certificates controls keep Minimum TLS Version at
   **TLS 1.2 or higher** and TLS 1.3 enabled, consistent with the audited apex.
2. Open account-level **Bulk redirects** (also accessible through zone
   **Rules → Settings → Bulk Redirects**). Create a list named
   `privaro_www_to_apex` with this entry:

   | Field | Value |
   |---|---|
   | Source URL | `www.privaroapp.nl/` — omit the scheme |
   | Target URL | `https://privaroapp.nl/` |
   | Status | `301` |
   | Preserve query string | On |
   | Subpath matching | On |
   | Preserve path suffix | On |
   | Include subdomains | Off |

   Omitting the source scheme matches both HTTP and HTTPS. Include subdomains
   is deliberately off to limit the rule to the requested `www` host.
   [Cloudflare matching rules](https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/how-it-works/)
   describe this behavior.
3. Create a **Bulk Redirect Rule** using that list, name it
   `Privaro www to HTTPS apex`, and leave the generated list expression/key
   unchanged. **Save and Deploy** enables it; a saved list alone does not.
   Review conflicting redirects first. The [dashboard guide](https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/create-dashboard/)
   documents list/rule creation.
4. In **DNS → Records**, add **A**, name **www**, address **192.0.2.1**,
   **Proxied** (orange cloud), TTL **Auto**. Do not change the apex record.
   This is Cloudflare's documented placeholder for a redirect-only host, not
   an origin server. Keep it proxied so the edge rule handles traffic. Do not
   add a competing `www` CNAME or disable proxying.
   [Official Pages www redirect recipe](https://developers.cloudflare.com/pages/how-to/www-redirect/)
5. Verify the results below after propagation. A valid TLS handshake must occur
   before HTTPS can redirect. The redirect is handled before any origin request,
   so this setup does not require weakening the zone's origin SSL/TLS mode.

```sh
curl -I "http://www.privaroapp.nl/ar/?check=www"
curl -I "https://www.privaroapp.nl/ar/?check=www"
curl -I -L --max-redirs 5 "https://www.privaroapp.nl/ar/?check=www"
curl -I "https://privaroapp.nl/ar/?check=www"
```

Expected: both `www` requests redirect to
`https://privaroapp.nl/ar/?check=www` with 301, certificate validation succeeds
without `-k`, following redirects ends at the apex with 200, and the apex never
redirects back to `www`. Also test `/`, `/nl/privacy` and a missing path. Existing
higher-priority rules may add an HTTPS hop; diagnose conflicts instead of
accepting loops or path/query loss. In DNS tools the proxied A record resolves
to Cloudflare edge addresses, not the placeholder address.
