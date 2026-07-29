"""
VinoElite — Static Site Generator
==================================
Reads products / categories / hero content from Firestore and turns the
Jinja2 templates (tpl_index.html, tpl_catalog.html, tpl_product.html) into
the physical HTML files GitHub Pages needs to serve pretty URLs such as

    /red-wine/                       (a category page)
    /red-wine/chateau-something/     (a product page)

The actual page CONTENT (prices, images, reviews, cart/wishlist state...)
is still fetched live from Firestore in the browser by main.js, exactly as
before — this script only pre-renders the page shell plus the <title>,
<meta description>, Open Graph tags, canonical URL and Product/Collection
JSON-LD, so that:

  1. GitHub Pages has a real file to serve at every pretty URL
     (GH Pages does not support server-side rewrites), and
  2. search engines / social-media crawlers see correct per-page SEO
     metadata even though they may not execute the JavaScript that
     hydrates the rest of the page.

Usage
-----
    pip install -r requirements.txt

    # Locally:
    python3 generate_site.py --service-account serviceAccountKey.json \
        --out public --site-url https://vinoelite.com

    # In GitHub Actions (see .github/workflows/build-and-deploy.yml):
    python3 generate_site.py --service-account /tmp/service-account.json \
        --out docs --site-url "$SITE_URL"

--service-account accepts a path to the service account JSON file. If
omitted, the script falls back to the FIREBASE_SERVICE_ACCOUNT env var
(JSON contents, not a path) and then to a serviceAccountKey.json file next
to this script — handy for local runs without passing any flags.

--out sets the output folder (the workflow uses "docs" so GitHub Pages can
serve straight from main/docs; run it locally with --out public if you
prefer).

--site-url sets the canonical base URL baked into every page's meta tags,
sitemap.xml and JSON-LD. Falls back to the BASE_URL env var, then to
https://vinoelite.com.

Output
------
Everything is written to the `public/` folder, which is what you point
GitHub Pages at (Settings → Pages → Build and deployment → Folder: /public
or /docs — rename as needed — or configure a workflow that publishes the
`public/` folder as a Pages artifact).
"""
import os
import re
import sys
import json
import shutil
import hashlib
import argparse

import firebase_admin
from firebase_admin import credentials, firestore
from jinja2 import Environment, FileSystemLoader

# ── CLI arguments (matches build-and-deploy.yml) ───────────────────────────
parser = argparse.ArgumentParser(description="VinoElite static site generator")
parser.add_argument("--service-account", dest="service_account", default=None,
                     help="Path to the Firebase service account JSON file")
parser.add_argument("--out", dest="out_dir", default="public",
                     help="Output directory for the generated site (default: public)")
parser.add_argument("--site-url", dest="site_url", default=None,
                     help="Public base URL of the site, e.g. https://vinoelite.com")
args = parser.parse_args()

# ── Configuration ─────────────────────────────────────────────────────────

BASE_URL = (args.site_url or os.environ.get("BASE_URL") or "https://vinoelite.com").rstrip("/")

# The URL path the site is served under, e.g. "/Wine" for a GitHub Pages
# project site at https://user.github.io/Wine/, or "" for a domain root
# (custom domain, or a user/org page repo named exactly user.github.io).
# Every internal link in the templates and in main.js is prefixed with
# this so the exact same build works at a domain root or under a subpath
# — just pass the right --site-url and nothing else needs to change.
from urllib.parse import urlparse
BASE_PATH = urlparse(BASE_URL).path.rstrip("/")
OUTPUT_DIR = args.out_dir
DEFAULT_OG_IMAGE = f"{BASE_URL}/images/default-og-image.jpg"
SITE_NAME = "VinoElite"

# Same mapping that lives in main.js (CATEGORY_SLUG_MAP). Keep the two in
# sync: this is what decides the physical folder name generated for each
# category / product, and main.js uses the identical map to know which
# category a visitor is looking at when it reads window.location.pathname.
CATEGORY_SLUG_MAP = {
    'red-wine': 'Red Wine',
    'white-wine': 'White Wine',
    'sparkling-wine': 'Sparkling Wine',
    'rose-wine': 'Rosé Wine',
    'fortified-wine': 'Fortified Wine',
    'dessert-wine': 'Dessert Wine',
    'vermouth-aromatized-wine': 'Vermouth & Aromatized Wine',
    'natural-wine': 'Natural Wine',
    'orange-wine': 'Orange Wine',
    'spirits': 'Spirits',
}
SLUG_BY_CATEGORY_NAME = {v: k for k, v in CATEGORY_SLUG_MAP.items()}

# Files/folders in the project root that must NOT be copied verbatim into
# the generated output (either because they are templates consumed by this
# script, or because this script itself/generation-only tooling).
COPY_IGNORE = {
    OUTPUT_DIR, ".git", ".github", "__pycache__", "node_modules",
    "generate_site.py", "requirements.txt", "README.md",
    "serviceAccountKey.json", "seed_database.html",
    "tpl_index.html", "tpl_catalog.html", "tpl_product.html",
    # replaced by generated files further down:
    "index.html", "catalog.html", "product.html",
}

print("=" * 60)
print("  VinoElite — Static Site Generator")
print("=" * 60)

# ── Firebase ────────────────────────────────────────────────────────────

try:
    if not firebase_admin._apps:
        if args.service_account:
            if not os.path.exists(args.service_account):
                print(f"ERROR: --service-account file not found: {args.service_account}")
                sys.exit(1)
            cred = credentials.Certificate(args.service_account)
        else:
            sa_env = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
            if sa_env:
                cred = credentials.Certificate(json.loads(sa_env))
            elif os.path.exists("serviceAccountKey.json"):
                cred = credentials.Certificate("serviceAccountKey.json")
            else:
                print("ERROR: no credentials found. Pass --service-account <path>, "
                      "set FIREBASE_SERVICE_ACCOUNT, or place a serviceAccountKey.json "
                      "file next to this script.")
                sys.exit(1)
        firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("Firebase: connected")
    print(f"Site URL: {BASE_URL}  (base path: '{BASE_PATH or '/'}')")
except Exception as e:
    print(f"Firebase error: {e}")
    sys.exit(1)

# ── Jinja2 ──────────────────────────────────────────────────────────────

jinja = Environment(
    loader=FileSystemLoader("."),
    autoescape=True,
    trim_blocks=True,
    lstrip_blocks=True,
)

# ── Cache-busting for styles.css / main.js ────────────────────────────
# GitHub Pages (and mobile browsers especially) cache static assets
# aggressively. Without a version fingerprint, a deploy that only changes
# styles.css / main.js can silently keep serving the old cached copy on
# repeat visits, which looks like "the new design/cards aren't showing".
# We hash the two files' contents so the query string changes automatically
# whenever either file changes, forcing browsers to fetch the fresh copy.
def _asset_version():
    h = hashlib.sha256()
    for fname in ("styles.css", "main.js"):
        if os.path.exists(fname):
            with open(fname, "rb") as f:
                h.update(f.read())
    return h.hexdigest()[:10]

ASSET_VERSION = _asset_version()
print(f"Asset version (cache-busting): {ASSET_VERSION}")

jinja.globals.update(BASE_URL=BASE_URL, SITE_NAME=SITE_NAME, base_path=BASE_PATH, asset_version=ASSET_VERSION)

tpl_index = jinja.get_template("tpl_index.html")
tpl_catalog = jinja.get_template("tpl_catalog.html")
tpl_product = jinja.get_template("tpl_product.html")
print("Templates: loaded")


# ── Helpers ─────────────────────────────────────────────────────────────

def clean_text(value, fallback=""):
    if not value:
        return fallback
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text


def truncate(text, length=160):
    text = text or ""
    if len(text) <= length:
        return text
    return text[:length].rsplit(" ", 1)[0].rstrip(",.;: ") + "…"


def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def first_image(product):
    urls = product.get("imageUrls")
    if isinstance(urls, list) and urls:
        return urls[0]
    return product.get("imageUrl") or DEFAULT_OG_IMAGE


def product_url_path(product):
    """/{category-slug}/{product-slug}/ — falls back to /product/{slug}/ if
    the product's category isn't one of the known ones yet (e.g. a brand
    new category added in the admin panel that hasn't been mapped here)."""
    cat_slug = SLUG_BY_CATEGORY_NAME.get(product.get("category"))
    slug = product.get("slug")
    if not slug:
        return None
    if cat_slug:
        return f"/{cat_slug}/{slug}/"
    return f"/product/{slug}/"


# ── Fetch data ──────────────────────────────────────────────────────────

print("\nFetching data from Firestore...")

products = []
for doc in db.collection("products").stream():
    p = doc.to_dict()
    p["id"] = doc.id
    products.append(p)
print(f"  products: {len(products)}")

hero_doc = db.collection("siteContent").document("hero").get()
hero = hero_doc.to_dict() if hero_doc.exists else {}
print(f"  hero content: {'found' if hero_doc.exists else 'missing (using defaults)'}")

# Categories actually present among (non-archived) products
categories_present = sorted({
    p.get("category") for p in products
    if p.get("category") and not p.get("isArchived")
})
print(f"  active categories: {len(categories_present)}")


# ── Reset output dir ───────────────────────────────────────────────────

if os.path.exists(OUTPUT_DIR):
    shutil.rmtree(OUTPUT_DIR)
os.makedirs(OUTPUT_DIR)

sitemap_urls = []


def add_sitemap(path, priority="0.7"):
    sitemap_urls.append((f"{BASE_URL}{path}", priority))


# ── 1. Homepage ─────────────────────────────────────────────────────────

print("\nGenerating homepage...")
home_title = clean_text(hero.get("metaTitle"), "VinoElite - Exclusive Wines From Around The World")
home_description = clean_text(
    hero.get("metaDescription"),
    "Discover a curated selection of exclusive wines from renowned wineries "
    "across the globe. Red, white, sparkling - find your perfect bottle at VinoElite."
)
write_file(
    os.path.join(OUTPUT_DIR, "index.html"),
    tpl_index.render(
        title=home_title,
        description=truncate(home_description),
        canonical_url=f"{BASE_URL}/",
        og_image=hero.get("heroBgImage") or DEFAULT_OG_IMAGE,
    ),
)
add_sitemap("/", "1.0")

# ── 2. Generic catalog page (no category filter) ───────────────────────

print("Generating catalog.html...")


def catalog_schema(name, description, url):
    return {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": name,
        "description": description,
        "url": url,
        "mainEntity": {"@type": "ItemList", "itemListElement": []},
    }


write_file(
    os.path.join(OUTPUT_DIR, "catalog.html"),
    tpl_catalog.render(
        title="Wine Catalog | VinoElite",
        description="Explore the exclusive collection of wines at VinoElite.",
        page_heading="Wine Catalog",
        canonical_url=f"{BASE_URL}/catalog.html",
        og_image=DEFAULT_OG_IMAGE,
        catalog_schema=catalog_schema("Wine Catalog", "Explore the exclusive collection of wines at VinoElite.", f"{BASE_URL}/catalog.html"),
    ),
)
add_sitemap("/catalog.html", "0.9")

# ── 3. One physical page per category (pretty URL: /red-wine/) ────────

print(f"Generating {len(categories_present)} category page(s)...")
for category_name in categories_present:
    slug = SLUG_BY_CATEGORY_NAME.get(category_name)
    if not slug:
        print(f"  ! skipping '{category_name}' — not in CATEGORY_SLUG_MAP, add it there first")
        continue
    cat_description = f"Shop our exclusive {category_name.lower()} collection at VinoElite."
    cat_canonical = f"{BASE_URL}/{slug}"
    write_file(
        os.path.join(OUTPUT_DIR, slug, "index.html"),
        tpl_catalog.render(
            title=f"{category_name} | VinoElite",
            description=cat_description,
            page_heading=category_name,
            canonical_url=cat_canonical,
            og_image=DEFAULT_OG_IMAGE,
            catalog_schema=catalog_schema(category_name, cat_description, cat_canonical),
        ),
    )
    add_sitemap(f"/{slug}", "0.8")
    print(f"  /{slug}/")

# ── 4. One physical page per product (pretty URL: /red-wine/slug/) ────

print(f"\nGenerating {len(products)} product page(s)...")
generated, skipped = 0, 0
for product in products:
    if product.get("isArchived"):
        skipped += 1
        continue
    url_path = product_url_path(product)
    if not url_path:
        print(f"  ! skipping product {product.get('id')} — missing 'slug' field")
        skipped += 1
        continue

    name = clean_text(product.get("name"), "Wine")
    description = truncate(clean_text(
        product.get("metaDescription") or product.get("description"),
        f"{name} — available now at VinoElite."
    ))
    price = product.get("price")
    availability = "InStock" if (product.get("stockStatus") or "In Stock") == "In Stock" else "OutOfStock"
    canonical = f"{BASE_URL}{url_path}"
    image = first_image(product)

    schema = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": name,
        "image": image,
        "description": description,
        "sku": product.get("id", ""),
        "offers": {
            "@type": "Offer",
            "url": canonical,
            "priceCurrency": "USD",
            "price": str(price) if price is not None else "",
            "availability": f"https://schema.org/{availability}",
        },
    }
    if product.get("ratingValue"):
        schema["aggregateRating"] = {
            "@type": "AggregateRating",
            "ratingValue": str(product.get("ratingValue")),
            "reviewCount": str(product.get("reviewCount") or 0),
        }

    write_file(
        os.path.join(OUTPUT_DIR, url_path.strip("/"), "index.html"),
        tpl_product.render(
            title=clean_text(product.get("metaTitle"), f"{name} | VinoElite"),
            description=description,
            canonical_url=canonical,
            og_image=image,
            product_schema=schema,
        ),
    )
    add_sitemap(url_path, "0.6")
    generated += 1

print(f"  generated: {generated}, skipped (archived / no slug): {skipped}")

# ── 5. Copy every other static file/folder as-is ───────────────────────

print("\nCopying static files (admin.html, cart.html, profile.html, styles.css, main.js, images/, ...)...")
copied = 0
for name in os.listdir("."):
    if name in COPY_IGNORE or name.startswith("."):
        continue
    src = os.path.join(".", name)
    dst = os.path.join(OUTPUT_DIR, name)
    if os.path.isdir(src):
        shutil.copytree(src, dst)
    else:
        shutil.copy2(src, dst)
    copied += 1
print(f"  copied {copied} top-level file(s)/folder(s)")

# ── 6. sitemap.xml ──────────────────────────────────────────────────────

print("\nGenerating sitemap.xml...")
sitemap_xml = ['<?xml version="1.0" encoding="UTF-8"?>',
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for url, priority in sitemap_urls:
    sitemap_xml.append(f"  <url><loc>{url}</loc><priority>{priority}</priority></url>")
sitemap_xml.append("</urlset>")
write_file(os.path.join(OUTPUT_DIR, "sitemap.xml"), "\n".join(sitemap_xml))

# ── 7. robots.txt (only if the project doesn't already ship one) ──────

robots_path = os.path.join(OUTPUT_DIR, "robots.txt")
if not os.path.exists(robots_path):
    write_file(robots_path, f"User-agent: *\nAllow: /\nDisallow: /admin.html\n\nSitemap: {BASE_URL}/sitemap.xml\n")

print("\n" + "=" * 60)
print(f"  Done. Site generated in ./{OUTPUT_DIR}/")
print(f"  {1 + 1 + len(categories_present) + generated} HTML pages, "
      f"{len(sitemap_urls)} URLs in sitemap.xml")
print("=" * 60)
