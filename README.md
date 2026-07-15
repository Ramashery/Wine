# Wine

# VinoElite — v2: пререндер из Firestore + категории + новая схема данных

Это следующий шаг после первого рефакторинга — структура сайта переведена на подход из
референсного проекта, с поправкой на ваши решения:
- **Корзина и аккаунты остаются** (это не каталог-визитка).
- **Хостинг остаётся GitHub Pages** (URL с `.html`, без серверных rewrite-правил).
- **Данные переведены на `globalFields` / `translations`.**

## Что изменилось по существу

**1. Пререндеринг из Firestore на этапе сборки.** `generate_site.py` теперь использует
`firebase-admin` (серверный SDK) и на этапе `python3 generate_site.py` сам ходит в Firestore и
подставляет реальные товары/категории в HTML. `index.html`, `catalog.html`, страницы категорий и
**каждая страница товара** — теперь настоящий статический HTML с уже готовым текстом. Ни одна из
этих страниц не делает Firestore-запрос в браузере — весь контент виден сразу, включая
поисковым роботам и превью в мессенджерах.

`cart.html` и `profile.html` — по-прежнему рендерятся на клиенте (их содержимое зависит от того,
какой пользователь залогинен, это нельзя знать на этапе сборки).

**2. Появились страницы категорий.** Раньше категория была только фильтром на `catalog.html`.
Теперь `/{lang}/products/{category}.html` — отдельная SEO-страница со своим `<title>`,
описанием и Schema.org, плюс тот же грид товаров с фильтрами (без фильтра по категории — она уже
не нужна).

**3. Товары теперь физически лежат по одному файлу на товар:**
`/{lang}/products/{категория}/{slug}.html`. Раньше был один `product.html`, который на клиенте
парсил slug из URL и делал запрос в Firestore.

**4. Каталог и категории фильтруются без единого Firestore-запроса.** Все карточки уже
отрисованы сервером с `data-category`, `data-country`, `data-region` и т.д.
(`templates/partials/product_card.html`), а `assets/js/catalog-filters.js` просто
показывает/скрывает уже существующие DOM-узлы. Раньше фильтрация требовала полной выгрузки
каталога в браузер через `getDocs`.

**5. Schema.org генерируется в Python** (`generate_site.py`: `schema_product`,
`schema_itemlist`, `schema_breadcrumbs`, `schema_website`) — Product с ценой и рейтингом на
странице товара, ItemList на каталоге/категории, BreadcrumbList везде, Organization/WebSite на
главной.

**6. `sitemap.xml`** теперь с `<xhtml:link rel="alternate" hreflang="...">` на каждый URL —
раньше hreflang был только внутри `<head>` каждой страницы, не в самом sitemap.

**7. Общий JS вынесен в `assets/js/site.js`.** Раньше логика авторизации/корзины/wishlist
частично дублировалась в каждом шаблоне. Теперь `initSharedUI()` — одна функция, страницы её
просто вызывают (кроме `cart.html`/`profile.html`, у которых своя, более полная логика работы с
корзиной/wishlist — но они переиспользуют `flattenProduct()`/`makeCategoryLabel()` оттуда же).

**8. `--fixture` режим сборки.** `python3 generate_site.py --fixture tools/fixture.sample.json`
собирает сайт из локального JSON-файла вместо живого Firestore — удобно проверять шаблоны без
ключа доступа. Именно так я тестировал всё, что здесь прислал.

## Новая модель данных Firestore

```
products/{id}:
  globalFields: { slug, categoryId, categorySlug, price, oldPrice, imageUrl, imageUrls,
                  badge, rating, reviewCount, stock, status, grapeVarieties, volume,
                  alcohol, year, brand }
  translations: {
    en: { name, description, metaDescription, sweetness, region, country,
          appellation, tastingNotes, foodPairing },
    ru: { ...то же самое на русском... },
    ka: { ...то же самое на грузинском... }
  }

categories/{id}:
  globalFields: { slug, sortOrder, status, image }
  translations: { en: {name, description, seoTitle, metaDescription}, ru: {...}, ka: {...} }

siteContent/hero:
  globalFields: { heroBgImage }
  translations: { en: {heroSubtitle, heroTitle, heroDescription}, ru: {...}, ka: {...} }
```

`status: "draft"` в `globalFields` — товар/категория не попадёт в сборку (замена `isArchived`).

`tools/seed_firestore.html` пересобран под эту схему — откройте его в браузере, чтобы засеять
тестовые данные.

## ⚠️ Важно: admin.html ещё не обновлён

Это единственный файл, который я сознательно не трогал (вы просили не трогать админку в первом
заходе, и в этот раз тоже явно не просили). Но теперь это критично: **текущая админка пишет
товары в старую плоскую схему** (`name`, `category`, `price`, ...), а не в
`globalFields`/`translations`. Если сейчас добавить товар через существующую админку, сайт его
либо не покажет, либо покажет с пустыми полями.

Из семенных (`seed_firestore.html`) товаров сайт соберётся правильно — но реальное управление
каталогом через админку работать не будет, пока её не переделать под новую схему (нужны вкладки
EN/RU/KA на каждое переводимое поле — это отдельная, вполне посильная задача). Рекомендую сделать
это следующим шагом, до того как начнёте наполнять каталог по-настоящему.

## Автосборка (GitHub Actions)

Добавил `.github/workflows/build-and-deploy.yml` — раз сборка теперь требует доступ к Firestore
(ключ сервисного аккаунта), гонять `generate_site.py` руками при каждой правке в админке
неудобно. Workflow:
- пересобирает сайт при пуше в `templates/`, `locales/`, `assets/`, `generate_site.py`;
- **пересобирает раз в сутки по расписанию** — чтобы товары, добавленные через админку, сами
  появлялись на статическом сайте без вашего участия;
- деплоит результат через `actions/deploy-pages`.

Настройка (once): секрет `FIREBASE_SERVICE_ACCOUNT` (JSON ключ сервисного аккаунта) и переменная
`SITE_URL` в Settings → Secrets and variables → Actions, плюс Settings → Pages → Source: "GitHub
Actions". Подробности — комментарием в самом файле workflow.

## Быстрый старт локально

```bash
pip install -r requirements.txt

# без реального Firestore — на тестовых данных:
python3 generate_site.py --fixture tools/fixture.sample.json --out docs

# с реальным Firestore:
python3 generate_site.py --service-account ./serviceAccountKey.json --out docs --site-url https://vinoelite.com
```
