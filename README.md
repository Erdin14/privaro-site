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

The publication check verifies 87 pages, local links/assets and their versions,
CSP hashes, required special files, excluded paths, stale-output cleanup and
repeatable builds. (The reading pages no longer hide anything until it is
scrolled to, so there is no longer a fragment check: an anchor can't land on
hidden text.)

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
