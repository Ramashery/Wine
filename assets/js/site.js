// assets/js/site.js
// Shared "chrome" behaviour for every public page: mobile menu, search,
// login modal, auth state, cart/wishlist counters and the add-to-cart /
// wishlist-toggle button handlers that work on any product card already
// present in the page (server-rendered by generate_site.py, or injected
// later by catalog/category page scripts).
//
// Pages that need product-specific rendering (product detail page,
// catalog filters) import this for the shared bits and add their own
// module on top — see tpl_product.html / tpl_catalog.html.

// ---------------------------------------------------------------------
// Product doc flattening — mirrors generate_site.py's extract_product().
// Used by pages that fetch a *raw* product doc client-side (cart, profile)
// instead of getting it already-flattened from the server-rendered page
// (catalog/product pages get real data baked in at build time and never
// need this).
// ---------------------------------------------------------------------
export function flattenProduct(id, raw, lang) {
  const g = raw.globalFields || {};
  const translations = raw.translations || {};
  const t = translations[lang] || translations.en || {};
  return {
    id,
    slug: g.slug || id,
    categoryId: g.categoryId || '',
    categorySlug: g.categorySlug || g.categoryId || '',
    name: t.name || '',
    description: t.description || '',
    metaDescription: t.metaDescription || '',
    sweetness: t.sweetness || '',
    region: t.region || '',
    country: t.country || '',
    appellation: t.appellation || '',
    price: g.price || 0,
    oldPrice: g.oldPrice ?? null,
    imageUrl: g.imageUrl || (g.imageUrls && g.imageUrls[0]) || '',
    imageUrls: g.imageUrls || (g.imageUrl ? [g.imageUrl] : []),
    badge: g.badge || '',
    stock: g.stock ?? 0,
    volume: g.volume || '',
  };
}

export function makeCategoryLabel(CATEGORY_LABELS, LANG) {
  return function categoryLabel(categoryId) {
    return (CATEGORY_LABELS[categoryId] && CATEGORY_LABELS[categoryId][LANG]) || categoryId;
  };
}

export function initSharedUI(ctx) {
  const {
    db, auth, LANG, I18N, BASE_PATH = '',
    onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
    signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
    doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove, collection, getDocs, query, where,
  } = ctx;

  let currentUser = null;
  let cartItems = {};      // productId -> quantity
  let wishlistIds = [];    // productId[]

  // ---------------------------------------------------------------------
  // Mobile menu
  // ---------------------------------------------------------------------
  const menuBtn = document.querySelector('.mobile-menu-btn');
  const nav = document.getElementById('main-nav');
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', () => {
      nav.classList.toggle('active');
      menuBtn.classList.toggle('active');
    });
  }

  // ---------------------------------------------------------------------
  // Search (desktop modal + mobile inline box) -> redirect to catalog
  // ---------------------------------------------------------------------
  function wireSearchForm(form) {
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="text"]');
      const query_ = (input?.value || '').trim();
      if (query_) window.location.href = `${BASE_PATH}/${LANG}/catalog.html?search=${encodeURIComponent(query_)}`;
    });
  }
  document.querySelectorAll('.search-box, #desktop-search-form').forEach(wireSearchForm);

  const searchBtn = document.querySelector('.search-btn');
  const searchModal = document.getElementById('search-modal');
  if (searchBtn && searchModal) {
    searchBtn.addEventListener('click', () => searchModal.classList.add('active'));
    searchModal.querySelector('.close-search-modal-btn')?.addEventListener('click', () => searchModal.classList.remove('active'));
  }

  // ---------------------------------------------------------------------
  // Login modal
  // ---------------------------------------------------------------------
  const loginModal = document.getElementById('login-modal');
  function openLoginModal() { loginModal?.classList.add('active'); }
  function closeLoginModal() { loginModal?.classList.remove('active'); }

  document.querySelectorAll('#auth-button, #mobile-auth-button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (currentUser) { window.location.href = `${BASE_PATH}/${LANG}/profile.html`; return; }
      e.preventDefault();
      openLoginModal();
    });
  });
  loginModal?.querySelector('.close-modal-btn')?.addEventListener('click', closeLoginModal);

  document.getElementById('google-signin-btn')?.addEventListener('click', async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); closeLoginModal(); }
    catch (err) { showToast(err.message, 'error'); }
  });

  document.getElementById('auth-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    try {
      try { await signInWithEmailAndPassword(auth, email, password); }
      catch { await createUserWithEmailAndPassword(auth, email, password); }
      closeLoginModal();
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message;
    }
  });

  document.getElementById('forgot-password-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    if (!email) { showToast(I18N.auth_email_placeholder, 'error'); return; }
    try { await sendPasswordResetEmail(auth, email); showToast('Email sent', 'success'); }
    catch (err) { showToast(err.message, 'error'); }
  });

  // ---------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2500);
  }

  // ---------------------------------------------------------------------
  // Header counters
  // ---------------------------------------------------------------------
  function updateHeaderCounters() {
    const cartCount = Object.values(cartItems).reduce((sum, qty) => sum + qty, 0);
    document.querySelectorAll('.cart-count-badge, .cart-count').forEach(el => {
      el.textContent = cartCount;
      el.style.display = cartCount > 0 ? '' : 'none';
    });
    document.querySelectorAll('.wishlist-count-badge, .wishlist-count').forEach(el => {
      el.textContent = wishlistIds.length;
      el.style.display = wishlistIds.length > 0 ? '' : 'none';
    });
    updateWishlistButtonStates();
    updateCartButtonStates();
  }

  function updateWishlistButtonStates() {
    document.querySelectorAll('.wishlist-toggle-btn').forEach(btn => {
      const id = btn.dataset.productId;
      const active = wishlistIds.includes(id);
      btn.classList.toggle('active', active);
      const icon = btn.querySelector('i');
      if (icon) icon.className = active ? 'fas fa-heart' : 'far fa-heart';
    });
  }

  function updateCartButtonStates() {
    document.querySelectorAll('.add-to-cart-btn').forEach(btn => {
      const id = btn.dataset.productId;
      const qty = cartItems[id] || 0;
      const badge = btn.querySelector('.cart-quantity-badge');
      if (badge) { badge.textContent = qty > 0 ? qty : ''; badge.style.display = qty > 0 ? '' : 'none'; }
    });
  }

  // ---------------------------------------------------------------------
  // Cart / wishlist actions (Firestore: users/{uid}/cart/{productId}, users/{uid}.wishlist[])
  // ---------------------------------------------------------------------
  async function loadUserData(uid) {
    const userSnap = await getDoc(doc(db, "users", uid));
    wishlistIds = (userSnap.exists() && userSnap.data().wishlist) || [];

    const cartSnap = await getDocs(collection(db, "users", uid, "cart"));
    cartItems = {};
    cartSnap.forEach(d => { cartItems[d.id] = d.data().quantity || 1; });

    updateHeaderCounters();
  }

  async function addToCart(productId) {
    if (!currentUser) { openLoginModal(); return; }
    const newQty = (cartItems[productId] || 0) + 1;
    cartItems[productId] = newQty;
    updateHeaderCounters();
    try {
      await setDoc(doc(db, "users", currentUser.uid, "cart", productId), { quantity: newQty, addedAt: new Date() }, { merge: true });
      showToast(I18N.add_to_cart + ' ✓', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function toggleWishlist(productId) {
    if (!currentUser) { openLoginModal(); return; }
    const isIn = wishlistIds.includes(productId);
    wishlistIds = isIn ? wishlistIds.filter(id => id !== productId) : [...wishlistIds, productId];
    updateHeaderCounters();
    try {
      await updateDoc(doc(db, "users", currentUser.uid), { wishlist: isIn ? arrayRemove(productId) : arrayUnion(productId) });
    } catch (err) { showToast(err.message, 'error'); }
  }

  // Event delegation: works for cards rendered at build time AND cards
  // injected later by client JS (e.g. catalog "load more" / re-filter).
  document.addEventListener('click', (e) => {
    const cartBtn = e.target.closest('.add-to-cart-btn');
    if (cartBtn) { addToCart(cartBtn.dataset.productId); return; }
    const wishBtn = e.target.closest('.wishlist-toggle-btn');
    if (wishBtn) { e.preventDefault(); toggleWishlist(wishBtn.dataset.productId); return; }
  });

  // ---------------------------------------------------------------------
  // Auth state
  // ---------------------------------------------------------------------
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    document.querySelectorAll('#auth-button .auth-text, #mobile-auth-button span').forEach(el => {
      el.textContent = user ? (user.displayName || user.email || I18N.nav_signin) : I18N.nav_signin;
    });
    if (user) {
      await setDoc(doc(db, "users", user.uid), {
        displayName: user.displayName || '', email: user.email || '', lastActivity: new Date(),
      }, { merge: true });
      await loadUserData(user.uid);
    } else {
      cartItems = {}; wishlistIds = [];
      updateHeaderCounters();
    }
  });

  return { showToast, addToCart, toggleWishlist, updateHeaderCounters };
}
