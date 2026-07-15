// assets/js/catalog-filters.js
// Filters/sorts the server-rendered product grid entirely in the DOM —
// no Firestore call, no network round trip. Each .product-card already
// carries data-category/data-country/data-region/... attributes (see
// templates/partials/product_card.html), so filtering is just show/hide.
//
// Used by tpl_catalog.html (all filters incl. category) and
// tpl_category.html (same code, minus the category filter — the page is
// already scoped to one category).

export function initCatalogFilters({ LANG, I18N, CATEGORY_LABELS, hasCategoryFilter = true }) {
  const grid = document.getElementById('products-grid');
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll('.product-card'));
  const countEl = document.getElementById('products-count');
  const noResultsEl = document.getElementById('no-results');
  const PAGE_SIZE = 12;

  const state = {
    filters: { category: [], country: [], region: [], appellation: [], grape: [], sweetness: [], volume: [], year: [] },
    price: null,         // [min, max] or null
    search: '',
    sort: 'name-asc',
    visibleCount: PAGE_SIZE,
  };

  // ---- read ?search= from URL on load ----
  const params = new URLSearchParams(window.location.search);
  if (params.get('search')) state.search = params.get('search').toLowerCase();
  const searchInput = document.getElementById('catalog-search-input');
  if (searchInput && state.search) searchInput.value = params.get('search');

  function matches(card) {
    const d = card.dataset;
    if (state.search && !d.name.includes(state.search)) return false;
    for (const key of ['category', 'country', 'region', 'appellation', 'sweetness', 'volume', 'year']) {
      const active = state.filters[key];
      if (active.length && !active.includes(d[key])) return false;
    }
    if (state.filters.grape.length) {
      const cardGrapes = (d.grape || '').split(',');
      if (!state.filters.grape.some(g => cardGrapes.includes(g))) return false;
    }
    if (state.price) {
      const price = parseFloat(d.price || '0');
      if (price < state.price[0] || price > state.price[1]) return false;
    }
    return true;
  }

  function sortCards(matched) {
    const key = state.sort;
    matched.sort((a, b) => {
      if (key === 'price-asc') return parseFloat(a.dataset.price) - parseFloat(b.dataset.price);
      if (key === 'price-desc') return parseFloat(b.dataset.price) - parseFloat(a.dataset.price);
      if (key === 'name-asc') return a.dataset.name.localeCompare(b.dataset.name);
      return 0; // 'popularity' -> keep server order (already sorted by name; badge/rating could be added later)
    });
    return matched;
  }

  function render() {
    const matched = sortCards(cards.filter(matches));
    cards.forEach(c => { c.style.display = 'none'; });
    matched.slice(0, state.visibleCount).forEach((c, i) => {
      c.style.display = '';
      grid.appendChild(c); // reorders into the sorted/paginated order
    });

    if (countEl) countEl.textContent = I18N.showing_of_wines
      .replace('{shown}', Math.min(state.visibleCount, matched.length))
      .replace('{total}', matched.length);
    if (noResultsEl) noResultsEl.style.display = matched.length === 0 ? '' : 'none';

    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) loadMoreBtn.style.display = state.visibleCount < matched.length ? '' : 'none';

    renderActiveFilterPills();
  }

  const FILTER_KEY_LABELS = {
    category: I18N.filter_category, country: I18N.filter_country, region: I18N.filter_region,
    appellation: I18N.filter_appellation, grape: I18N.filter_grape, sweetness: I18N.filter_sweetness,
    volume: I18N.filter_volume, year: I18N.filter_year,
  };

  function categoryLabel(id) { return (CATEGORY_LABELS[id] && CATEGORY_LABELS[id][LANG]) || id; }

  function renderActiveFilterPills() {
    const container = document.getElementById('active-filters');
    if (!container) return;
    container.innerHTML = '';
    Object.entries(state.filters).forEach(([key, values]) => {
      values.forEach(value => {
        const pill = document.createElement('div');
        pill.className = 'filter-pill';
        const label = key === 'category' ? categoryLabel(value) : value;
        pill.innerHTML = `<span>${FILTER_KEY_LABELS[key]}: ${label}</span><button data-key="${key}" data-value="${value}" aria-label="Remove filter">&times;</button>`;
        container.appendChild(pill);
      });
    });
  }

  // ---- wire up checkboxes (rendered server-side in the filter sidebar) ----
  document.querySelectorAll('.filter-option input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.key;
      const value = cb.value;
      if (!hasCategoryFilter && key === 'category') return;
      const list = state.filters[key];
      const idx = list.indexOf(value);
      if (cb.checked && idx === -1) list.push(value);
      if (!cb.checked && idx !== -1) list.splice(idx, 1);
      state.visibleCount = PAGE_SIZE;
      render();
    });
  });

  document.getElementById('active-filters')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-key]');
    if (!btn) return;
    const { key, value } = btn.dataset;
    state.filters[key] = state.filters[key].filter(v => v !== value);
    document.querySelector(`.filter-option input[data-key="${key}"][value="${CSS.escape(value)}"]`)?.click();
  });

  document.getElementById('reset-filters-btn')?.addEventListener('click', () => {
    Object.keys(state.filters).forEach(k => state.filters[k] = []);
    state.price = null;
    document.querySelectorAll('.filter-option input[type="checkbox"]').forEach(cb => cb.checked = false);
    state.visibleCount = PAGE_SIZE;
    render();
  });

  const sortSelect = document.getElementById('sort-select');
  sortSelect?.addEventListener('change', () => { state.sort = sortSelect.value; render(); });

  searchInput?.addEventListener('input', () => {
    state.search = searchInput.value.toLowerCase();
    state.visibleCount = PAGE_SIZE;
    render();
  });

  document.getElementById('load-more-btn')?.addEventListener('click', () => {
    state.visibleCount += PAGE_SIZE;
    render();
  });

  const priceMinInput = document.getElementById('price-slider-min');
  const priceMaxInput = document.getElementById('price-slider-max');
  function applyPriceFilter() {
    if (!priceMinInput || !priceMaxInput) return;
    state.price = [parseFloat(priceMinInput.value), parseFloat(priceMaxInput.value)];
    document.getElementById('price-min-label').textContent = `$${priceMinInput.value}`;
    document.getElementById('price-max-label').textContent = `$${priceMaxInput.value}`;
    state.visibleCount = PAGE_SIZE;
    render();
  }
  priceMinInput?.addEventListener('change', applyPriceFilter);
  priceMaxInput?.addEventListener('change', applyPriceFilter);

  document.getElementById('toggle-filters-btn')?.addEventListener('click', () => {
    document.querySelector('.filters-sidebar')?.classList.toggle('open');
  });

  render();
}
