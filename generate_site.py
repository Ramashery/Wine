#!/usr/bin/env python3
"""
generate_site.py (v2)
======================
Static site generator for VinoElite — GitHub Pages edition.

Unlike v1, this version reads product/category/hero data directly from
Firestore AT BUILD TIME (via the Firebase Admin SDK) and bakes it into the
HTML. index.html, catalog.html, category pages and product pages are fully
server-rendered: a search engine or link-preview bot sees real content
immediately, no JavaScript required. cart.html and profile.html stay
client-hydrated (their content depends on which user is signed in, which
can't be known at build time).

Firestore data model (see /tools/seed_firestore.html):
    products/{id}:
        globalFields: { slug, categoryId, price, oldPrice, imageUrl, imageUrls,
                         badge, rating, reviewCount, stock, status,
                         grapeVarieties, volume, alcohol, year }
        translations: { en: {name, description, metaDescription, sweetness,
                              region, country, tastingNotes, foodPairing}, ru: {...}, ka: {...} }
    categories/{id}:
        globalFields: { slug, sortOrder, status, image }
        translations: { en: {name, description, seoTitle, metaDescription}, ru: {...}, ka: {...} }
    siteContent/hero:
        globalFields: { heroBgImage }
        translations: { en: {heroSubtitle, heroTitle, heroDescription}, ru: {...}, ka: {...} }

Auth:
    Set GOOGLE_APPLICATION_CREDENTIALS to the path of a Firebase service
    account JSON, or pass --service-account path/to/key.json.
    In CI, the key is written from a GitHub Actions secret (see
    .github/workflows/build-and-deploy.yml).

Usage:
    pip install -r requirements.txt
    python3 generate_site.py --service-account ./serviceAccountKey.json --out docs --site-url https://vinoelite.com
"""
import argparse
import json
import re
import shutil
import unicodedata
from pathlib import Path
from datetime import datetime, timezone

from jinja2 import Environment, FileSystemLoader

ROOT = Path(__file__).parent.resolve()
TEMPLATES_DIR = ROOT / "templates"
LOCALES_DIR = ROOT / "locales"
ASSETS_DIR = ROOT / "assets"
ADMIN_FILE = ROOT / "admin.html"

LANGUAGES = {"en": "EN", "ru": "RU", "ka": "KA"}
DEFAULT_LANG = "en"
OG_LOCALES = {"en": "en_US", "ru": "ru_RU", "ka": "ka_GE"}

PRODUCTS_PAGE = "products"  # URL segment: /{lang}/products/{category}/{slug}.html

# page key -> template file
PAGES = {
    "index": "tpl_index.html",
    "catalog": "tpl_catalog.html",
}


# ---------------------------------------------------------------------------
# Firestore access
# ---------------------------------------------------------------------------

def get_firestore_client(service_account_path: str | None):
    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        if service_account_path:
            cred = credentials.Certificate(service_account_path)
        else:
            cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred)
    return firestore.client()


# ---------------------------------------------------------------------------
# Data model helpers: globalFields / translations -> flat dict per language
# ---------------------------------------------------------------------------

CYRILLIC_MAP = str.maketrans({
    "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z","и":"i",
    "й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t",
    "у":"u","ф":"f","х":"h","ц":"ts","ч":"ch","ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"",
    "э":"e","ю":"yu","я":"ya",
})


def slugify(value: str) -> str:
    if not value:
        return ""
    value = value.lower().translate(CYRILLIC_MAP)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value


def gf(doc: dict) -> dict:
    return doc.get("globalFields") or {}


def tr(doc: dict, lang: str) -> dict:
    translations = doc.get("translations") or {}
    return translations.get(lang) or translations.get(DEFAULT_LANG) or {}


def extract_product(doc_id: str, doc: dict, lang: str, categories_by_id: dict) -> dict:
    """Flatten a Firestore product document into the shape the templates use."""
    g = gf(doc)
    t = tr(doc, lang)
    category_id = g.get("categoryId", "")
    category = categories_by_id.get(category_id, {})
    category_label = tr(category, lang).get("name") or category_id

    return {
        "id": doc_id,
        "slug": g.get("slug", slugify(t.get("name", doc_id))),
        "categoryId": category_id,
        "categorySlug": g.get("categorySlug") or gf(category).get("slug", slugify(category_id)),
        "categoryLabel": category_label,
        "name": t.get("name", ""),
        "description": t.get("description", ""),
        "metaDescription": t.get("metaDescription", ""),
        "tastingNotes": t.get("tastingNotes", ""),
        "foodPairing": t.get("foodPairing", ""),
        "sweetness": t.get("sweetness", ""),
        "region": t.get("region", ""),
        "country": t.get("country", ""),
        "appellation": t.get("appellation", ""),
        "price": g.get("price", 0),
        "oldPrice": g.get("oldPrice"),
        "imageUrl": g.get("imageUrl", ""),
        "imageUrls": g.get("imageUrls") or ([g["imageUrl"]] if g.get("imageUrl") else []),
        "badge": g.get("badge", ""),
        "rating": g.get("rating", 0),
        "reviewCount": g.get("reviewCount", 0),
        "stock": g.get("stock", 0),
        "status": g.get("status", "published"),
        "grapeVarieties": g.get("grapeVarieties") or [],
        "volume": g.get("volume", ""),
        "alcohol": g.get("alcohol", ""),
        "year": g.get("year", ""),
        "brand": g.get("brand", ""),
    }


def extract_category(doc_id: str, doc: dict, lang: str) -> dict:
    g = gf(doc)
    t = tr(doc, lang)
    return {
        "id": doc_id,
        "slug": g.get("slug", slugify(doc_id)),
        "name": t.get("name", doc_id),
        "description": t.get("description", ""),
        "seoTitle": t.get("seoTitle", ""),
        "metaDescription": t.get("metaDescription", ""),
        "image": g.get("image", ""),
        "sortOrder": g.get("sortOrder", 0),
        "status": g.get("status", "published"),
    }


def extract_hero(doc: dict, lang: str) -> dict:
    g = gf(doc)
    t = tr(doc, lang)
    return {
        "heroSubtitle": t.get("heroSubtitle", ""),
        "heroTitle": t.get("heroTitle", ""),
        "heroDescription": t.get("heroDescription", ""),
        "heroBgImage": g.get("heroBgImage", ""),
    }


def load_data(db):
    """Pull all published products/categories/hero once (raw docs), to be
    re-flattened per-language during rendering."""
    products_raw = {}
    for snap in db.collection("products").stream():
        doc = snap.to_dict() or {}
        if gf(doc).get("status") == "draft":
            continue
        products_raw[snap.id] = doc

    categories_raw = {}
    for snap in db.collection("categories").stream():
        doc = snap.to_dict() or {}
        if gf(doc).get("status") == "draft":
            continue
        categories_raw[snap.id] = doc

    hero_snap = db.collection("siteContent").document("hero").get()
    hero_raw = hero_snap.to_dict() if hero_snap.exists else {}

    return products_raw, categories_raw, hero_raw


def load_data_from_fixture(fixture_path: str):
    """Load a local JSON file shaped like {"products": {...}, "categories": {...}, "hero": {...}}
    instead of hitting Firestore. Handy for previewing template changes without credentials —
    see tools/fixture.sample.json."""
    data = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    return data.get("products", {}), data.get("categories", {}), data.get("hero", {})


# ---------------------------------------------------------------------------
# URL helpers (GitHub Pages: .html extensions kept, no server rewrites)
# ---------------------------------------------------------------------------

def url_for(page: str, lang: str) -> str:
    filename = "index.html" if page == "index" else f"{page}.html"
    return f"/{lang}/{filename}"


def url_for_category_slug(category_slug: str, lang: str) -> str:
    return f"/{lang}/{PRODUCTS_PAGE}/{category_slug}.html"


def url_for_product_dict(p: dict, lang: str) -> str:
    return f"/{lang}/{PRODUCTS_PAGE}/{p['categorySlug']}/{p['slug']}.html"


# ---------------------------------------------------------------------------
# Schema.org JSON-LD builders (kept simple on purpose — covers what actually
# helps rich results for a wine shop: Product, ItemList, BreadcrumbList,
# Organization/WebSite. Built in Python and passed to templates as a
# ready-made JSON string, since plain Jinja2 has no reliable `tojson`.)
# ---------------------------------------------------------------------------

def schema_breadcrumbs(items: list[tuple[str, str]], site_url: str) -> dict:
    """items: list of (name, url_path)"""
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": name, "item": f"{site_url}{path}"}
            for i, (name, path) in enumerate(items)
        ],
    }


def schema_product(p: dict, lang: str, site_url: str, page_url: str) -> dict:
    data = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": p["name"],
        "description": p.get("metaDescription") or p.get("description") or "",
        "image": p.get("imageUrls") or ([p["imageUrl"]] if p.get("imageUrl") else []),
        "sku": p["id"],
        "url": f"{site_url}{page_url}",
        "category": p.get("categoryLabel", ""),
        "offers": {
            "@type": "Offer",
            "priceCurrency": "USD",
            "price": p.get("price", 0),
            "availability": "https://schema.org/InStock" if p.get("stock", 0) > 0 else "https://schema.org/OutOfStock",
            "url": f"{site_url}{page_url}",
        },
    }
    if p.get("rating"):
        data["aggregateRating"] = {
            "@type": "AggregateRating",
            "ratingValue": p["rating"],
            "reviewCount": max(p.get("reviewCount", 0), 1),
        }
    if p.get("brand"):
        data["brand"] = {"@type": "Brand", "name": p["brand"]}
    return data


def schema_itemlist(products: list[dict], lang: str, site_url: str) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "url": f"{site_url}{url_for_product_dict(p, lang)}", "name": p["name"]}
            for i, p in enumerate(products)
        ],
    }


def schema_website(site_url: str) -> dict:
    return {
        "@context": "https://schema.org",
        "@type": ["Organization", "WebSite"],
        "name": "VinoElite",
        "url": site_url,
        "logo": f"{site_url}/assets/images/logo.png",
    }


def sj(data: dict) -> str:
    """Serialize a schema dict to a JSON string safe to inline in <script>."""
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def build_filter_options(products: list[dict]) -> dict:
    def uniq_sorted(values):
        return sorted({v for v in values if v})

    grapes = set()
    for p in products:
        for g in (p.get("grapeVarieties") or []):
            if g:
                grapes.add(g)

    return {
        "country": uniq_sorted(p["country"] for p in products),
        "region": uniq_sorted(p["region"] for p in products),
        "appellation": uniq_sorted(p["appellation"] for p in products),
        "sweetness": uniq_sorted(p["sweetness"] for p in products),
        "volume": uniq_sorted(p["volume"] for p in products),
        "year": uniq_sorted(str(p["year"]) for p in products),
        "grape": sorted(grapes),
        "price_min": min((p["price"] for p in products), default=0),
        "price_max": max((p["price"] for p in products), default=0),
    }


# ---------------------------------------------------------------------------
# Site generation
# ---------------------------------------------------------------------------

def build(out_dir: Path, site_url: str, service_account: str | None, skip_firestore: bool, fixture: str | None = None):
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    locales = {lang: json.loads((LOCALES_DIR / f"{lang}.json").read_text(encoding="utf-8")) for lang in LANGUAGES}

    if fixture:
        print(f"  loading data from fixture: {fixture}")
        products_raw, categories_raw, hero_raw = load_data_from_fixture(fixture)
    elif skip_firestore:
        print("  --skip-firestore: building with an empty catalog (chrome-only smoke test)")
        products_raw, categories_raw, hero_raw = {}, {}, {}
    else:
        db = get_firestore_client(service_account)
        products_raw, categories_raw, hero_raw = load_data(db)
        print(f"  loaded {len(products_raw)} product(s), {len(categories_raw)} categor{'y' if len(categories_raw)==1 else 'ies'} from Firestore")

    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=False, trim_blocks=False, lstrip_blocks=False)
    env.globals["url_for"] = url_for
    env.globals["url_for_category"] = url_for_category_slug
    env.globals["url_for_product"] = url_for_product_dict

    year = datetime.now(timezone.utc).year
    sitemap_entries = []  # (url, alt_urls dict, lastmod)

    # category display names in every language, keyed by category id — used by
    # the client-side JS (categoryLabel()) wherever a category name needs to
    # switch language without a full page reload (e.g. active-filter pills).
    category_labels_by_id = {
        cid: {l: extract_category(cid, doc, l)["name"] for l in LANGUAGES}
        for cid, doc in categories_raw.items()
    }

    for lang in LANGUAGES:
        t = locales[lang]
        categories = {cid: extract_category(cid, doc, lang) for cid, doc in categories_raw.items()}
        products = [extract_product(pid, doc, lang, categories_raw) for pid, doc in products_raw.items()]
        products = [p for p in products if p["status"] != "draft"]
        products.sort(key=lambda p: p["name"])
        hero = extract_hero(hero_raw, lang)

        common_ctx = dict(
            lang=lang, languages=LANGUAGES, t=t,
            i18n_js=json.dumps(t, ensure_ascii=False),
            category_labels_js=json.dumps(category_labels_by_id, ensure_ascii=False),
            site_url=site_url.rstrip("/"), og_locale=OG_LOCALES.get(lang, "en_US"),
            asset_path="/assets/", year=year,
        )

        # ---- index ----
        featured = [p for p in products if p.get("badge")][:8] or products[:8]
        categories_sorted = sorted(categories.values(), key=lambda c: c["sortOrder"])
        page_url = url_for("index", lang)
        html = env.get_template("tpl_index.html").render(
            **common_ctx, page_url=page_url,
            alt_urls={c: url_for("index", c) for c in LANGUAGES},
            hero=hero, featured_products=featured, categories=categories_sorted,
            schema_json=sj(schema_website(site_url.rstrip("/"))),
        )
        write(out_dir, page_url, html)
        sitemap_entries.append((page_url, {c: url_for("index", c) for c in LANGUAGES}, None))

        # ---- catalog ----
        page_url = url_for("catalog", lang)
        breadcrumbs = sj(schema_breadcrumbs([(t["nav_home"], url_for("index", lang)), (t["nav_catalog"], page_url)], site_url.rstrip("/")))
        html = env.get_template("tpl_catalog.html").render(
            **common_ctx, page_url=page_url,
            alt_urls={c: url_for("catalog", c) for c in LANGUAGES},
            products=products, categories=categories_sorted,
            filter_options=build_filter_options(products),
            schema_json=sj(schema_itemlist(products, lang, site_url.rstrip("/"))),
            breadcrumb_json=breadcrumbs,
        )
        write(out_dir, page_url, html)
        sitemap_entries.append((page_url, {c: url_for("catalog", c) for c in LANGUAGES}, None))

        # ---- category pages ----
        for cat in categories_sorted:
            cat_products = [p for p in products if p["categoryId"] == cat["id"]]
            if not cat_products:
                continue
            page_url = url_for_category_slug(cat["slug"], lang)
            breadcrumbs = sj(schema_breadcrumbs([
                (t["nav_home"], url_for("index", lang)),
                (t["nav_catalog"], url_for("catalog", lang)),
                (cat["name"], page_url),
            ], site_url.rstrip("/")))
            html = env.get_template("tpl_category.html").render(
                **common_ctx, page_url=page_url,
                alt_urls={c: url_for_category_slug(extract_category(cat["id"], categories_raw[cat["id"]], c)["slug"], c) for c in LANGUAGES},
                category=cat, products=cat_products, categories=categories_sorted,
                filter_options=build_filter_options(cat_products),
                schema_json=sj(schema_itemlist(cat_products, lang, site_url.rstrip("/"))),
                breadcrumb_json=breadcrumbs,
            )
            write(out_dir, page_url, html)
            sitemap_entries.append((page_url, {c: url_for_category_slug(extract_category(cat["id"], categories_raw[cat["id"]], c)["slug"], c) for c in LANGUAGES}, None))

        # ---- product pages (one static file per product per language) ----
        for p in products:
            related = [rp for rp in products if rp["categoryId"] == p["categoryId"] and rp["id"] != p["id"]][:4]
            page_url = url_for_product_dict(p, lang)
            alt_urls = {}
            for c in LANGUAGES:
                p_c = extract_product(p["id"], products_raw[p["id"]], c, categories_raw)
                alt_urls[c] = url_for_product_dict(p_c, c)
            breadcrumbs = sj(schema_breadcrumbs([
                (t["nav_home"], url_for("index", lang)),
                (t["nav_catalog"], url_for("catalog", lang)),
                (p["categoryLabel"], url_for_category_slug(p["categorySlug"], lang)),
                (p["name"], page_url),
            ], site_url.rstrip("/")))
            html = env.get_template("tpl_product.html").render(
                **common_ctx, page_url=page_url, alt_urls=alt_urls,
                product=p, related_products=related, category=categories.get(p["categoryId"], {}),
                schema_json=sj(schema_product(p, lang, site_url.rstrip("/"), page_url)),
                breadcrumb_json=breadcrumbs,
            )
            write(out_dir, page_url, html)
            sitemap_entries.append((page_url, alt_urls, None))

        # ---- cart / profile (client-hydrated; chrome + i18n only) ----
        for page_key, template_name in (("cart", "tpl_cart.html"), ("profile", "tpl_profile.html")):
            page_url = url_for(page_key, lang)
            html = env.get_template(template_name).render(
                **common_ctx, page_url=page_url,
                alt_urls={c: url_for(page_key, c) for c in LANGUAGES},
            )
            write(out_dir, page_url, html)
            sitemap_entries.append((page_url, {c: url_for(page_key, c) for c in LANGUAGES}, None))

    # ---- 404 page (site-wide, GitHub Pages serves /404.html automatically) ----
    html = env.get_template("tpl_404.html").render(
        lang=DEFAULT_LANG, languages=LANGUAGES, t=locales[DEFAULT_LANG],
        i18n_js=json.dumps(locales[DEFAULT_LANG], ensure_ascii=False),
        site_url=site_url.rstrip("/"), asset_path="/assets/", year=year,
        page_url="/404.html", alt_urls={c: "/404.html" for c in LANGUAGES}, og_locale="en_US",
    )
    (out_dir / "404.html").write_text(html, encoding="utf-8")
    print("  wrote 404.html")

    # ---- static assets, admin, root redirect, sitemap ----
    shutil.copytree(ASSETS_DIR, out_dir / "assets")
    print("  copied assets/")
    if ADMIN_FILE.exists():
        shutil.copy(ADMIN_FILE, out_dir / "admin.html")
        print("  copied admin.html")

    write_root_redirect(out_dir)
    write_sitemap(out_dir, sitemap_entries, site_url)


def write(out_dir: Path, url_path: str, html: str):
    out_path = out_dir / url_path.lstrip("/")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")


def write_root_redirect(out_dir: Path):
    content = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0; url=/en/index.html">
<title>VinoElite</title>
<script>
(function() {{
  var supported = {json.dumps(list(LANGUAGES.keys()))};
  var browserLang = (navigator.language || "en").slice(0, 2).toLowerCase();
  var lang = supported.indexOf(browserLang) !== -1 ? browserLang : "en";
  window.location.replace("/" + lang + "/index.html");
}})();
</script>
</head>
<body><p>Redirecting to <a href="/en/index.html">VinoElite</a>...</p></body>
</html>
"""
    (out_dir / "index.html").write_text(content, encoding="utf-8")
    print("  wrote root index.html (language redirect)")


def write_sitemap(out_dir: Path, entries, site_url: str):
    site_url = site_url.rstrip("/")
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
             'xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    seen = set()
    for url_path, alt_urls, _ in entries:
        if url_path in seen:
            continue
        seen.add(url_path)
        lines.append(f"  <url>")
        lines.append(f"    <loc>{site_url}{url_path}</loc>")
        for code, alt_path in alt_urls.items():
            lines.append(f'    <xhtml:link rel="alternate" hreflang="{code}" href="{site_url}{alt_path}"/>')
        lines.append(f"  </url>")
    lines.append("</urlset>")
    (out_dir / "sitemap.xml").write_text("\n".join(lines), encoding="utf-8")
    print(f"  wrote sitemap.xml ({len(seen)} URLs)")


def main():
    parser = argparse.ArgumentParser(description="Build the static VinoElite site from Firestore.")
    parser.add_argument("--out", default="docs", help="Output directory (default: docs, for GitHub Pages '/docs' mode)")
    parser.add_argument("--site-url", default="https://vinoelite.com", help="Absolute site URL")
    parser.add_argument("--service-account", default=None, help="Path to Firebase service account JSON. If omitted, uses GOOGLE_APPLICATION_CREDENTIALS / ADC.")
    parser.add_argument("--skip-firestore", action="store_true", help="Build chrome-only (no products) — useful to sanity-check templates without credentials.")
    parser.add_argument("--fixture", default=None, help="Path to a local JSON fixture (see tools/fixture.sample.json) to build from instead of live Firestore — no credentials needed.")
    args = parser.parse_args()

    out_dir = (ROOT / args.out).resolve()
    print(f"Building site into {out_dir} ...")
    build(out_dir, args.site_url, args.service_account, args.skip_firestore, args.fixture)
    print("Done.")


if __name__ == "__main__":
    main()
