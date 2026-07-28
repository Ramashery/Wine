/* ==========================================================================
   VinoElite — main.js
   Shared front-end logic for the public site (index, catalog, product pages).
   The admin panel (admin.html) is a separate self-contained app and does
   NOT use this file.

   This file is organised in two halves:
     1. CORE  — Firebase init, auth, cart/wishlist, toast, small helpers.
                Identical code used to live copy-pasted in every page;
                it now lives here once.
     2. PAGES — one init function per page (initIndexPage / initCatalogPage /
                initProductPage). Only the function matching
                document.body.dataset.page runs, decided by the small
                router at the bottom of this file.
   ========================================================================== */

/* ---------------------------------------------------------------------- */
/* 1. CORE                                                                 */
/* ---------------------------------------------------------------------- */

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import {
    getFirestore, collection, getDocs, doc, getDoc, setDoc, query, updateDoc,
    runTransaction, arrayUnion, arrayRemove, writeBatch, where, limit,
    startAfter, orderBy, serverTimestamp, addDoc
} from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// --- Firebase project config (public client keys, safe to expose) ---
const firebaseConfig = { apiKey: "AIzaSyBflzOWVf3HgDpdUhha3qvyeUJf7i6dOuk", authDomain: "wine-91d0e.firebaseapp.com", projectId: "wine-91d0e", storageBucket: "wine-91d0e.firebasestorage.app", messagingSenderId: "1021620433427", appId: "1:1021620433427:web:5439252fb350c4455a85e6", measurementId: "G-TRWHY3KXK1" };
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- Category slug <-> name map, used for pretty URLs everywhere ---
const CATEGORY_SLUG_MAP = {
    'red-wine': 'Red Wine',
    'white-wine': 'White Wine',
    'sparkling-wine': 'Sparkling Wine',
    'rose-wine': 'Rosé Wine',
    'fortified-wine': 'Fortified Wine',
    'dessert-wine': 'Dessert Wine',
    'vermouth-aromatized-wine': 'Vermouth & Aromatized Wine',
    'natural-wine': 'Natural Wine',
    'orange-wine': 'Orange Wine',
    'spirits': 'Spirits'
};

const CART_STORAGE_KEY = 'vinoelite_cart';
const WISHLIST_STORAGE_KEY = 'vinoelite_wishlist';
let wishlistProductIds = new Set();

/* ---- toast notifications ---- */


function showToast(message, type = 'info') { const container = document.getElementById('toast-container'); const toast = document.createElement('div'); toast.className = `toast ${type}`; toast.textContent = message; container.appendChild(toast); setTimeout(() => toast.classList.add('show'), 10); setTimeout(() => { toast.classList.remove('show'); toast.addEventListener('transitionend', () => toast.remove()); }, 3000); }


/* ---- helpers ---- */

function generateSlug(text) { 
            if (!text) return ''; 
            return text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, ''); 
        }

function generateStars(rating) { let starsHTML = ''; const fullStars = Math.floor(rating); const halfStar = rating % 1 >= 0.5; const emptyStars = 5 - fullStars - (halfStar ? 1 : 0); for (let i = 0; i < fullStars; i++) starsHTML += '<i class="fas fa-star"></i>'; if (halfStar) starsHTML += '<i class="fas fa-star-half-alt"></i>'; for (let i = 0; i < emptyStars; i++) starsHTML += '<i class="far fa-star"></i>'; return starsHTML; }

function setupSlideshow(container) {
            if (!container) return;
            const slides = Array.from(container.querySelectorAll('.slideshow-item'));
            if (slides.length <= 1) { if (slides.length === 1) slides[0].classList.add('active'); return; }
            if (container.querySelector('.slideshow-overlay')) return;
            const overlay = document.createElement('div'); overlay.className = 'slideshow-overlay'; container.appendChild(overlay);
            let currentIndex = 0; let intervalId = setInterval(() => showSlide(currentIndex + 1), 4000);
            function showSlide(index) { const oldSlide = slides[currentIndex]; if (oldSlide) oldSlide.classList.remove('active'); currentIndex = (index + slides.length) % slides.length; const newSlide = slides[currentIndex]; if (newSlide) setTimeout(() => newSlide.classList.add('active'), 50); }
            function manualSlide(direction) { clearInterval(intervalId); showSlide(currentIndex + direction); intervalId = setInterval(() => showSlide(currentIndex + 1), 5000); }
            let touchStartX = 0;
            overlay.addEventListener('mousedown', e => { touchStartX = e.clientX; overlay.style.cursor = 'grabbing'; clearInterval(intervalId); });
            overlay.addEventListener('mouseup', e => { overlay.style.cursor = 'grab'; if (e.clientX < touchStartX - 50) { manualSlide(1); } else if (e.clientX > touchStartX + 50) { manualSlide(-1); } else { intervalId = setInterval(() => showSlide(currentIndex + 1), 5000); } });
            overlay.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; clearInterval(intervalId); }, { passive: true });
            overlay.addEventListener('touchend', e => { let touchEndX = e.changedTouches[0].clientX; if (touchEndX < touchStartX - 50) { manualSlide(1); } else if (touchEndX > touchStartX + 50) { manualSlide(-1); } else { intervalId = setInterval(() => showSlide(currentIndex + 1), 5000); } });
            showSlide(0);
        }


/* ---- shared product card markup (used on the homepage and in category
   carousels; catalog.html and product.html's "related products" grid
   render their own richer card variants) ---- */


function createProductCardHTML(prod) { 
            if (!prod.slug || !prod.category) return ''; 
            const categorySlug = prod.category.toLowerCase().replace(/\s+/g, '-'); 
            const productUrl = `/${categorySlug}/${prod.slug}`; 
            let subtitle = [prod.category, prod.sweetness].filter(Boolean).join(' ') + (prod.region ? ` from ${[prod.region, prod.country].filter(Boolean).join(', ')}` : ''); 
            const description = prod.metaDescription || prod.description || ''; 
            const imageUrls = (prod.imageUrls && Array.isArray(prod.imageUrls) && prod.imageUrls.length > 0) ? prod.imageUrls : [prod.imageUrl]; 
            const slidesHTML = imageUrls.map((url, index) => `<div class="slideshow-item"><img src="${url}" alt="${prod.name} view ${index + 1}" loading="lazy"></div>`).join(''); 
            
            return `<div class="product-card animate-on-scroll" data-url="${productUrl}">
                        <div class="slideshow-container">
                            ${slidesHTML}
                            ${prod.badge ? `<div class="product-badge">${prod.badge}</div>` : ''}
                            <button class="wishlist-toggle-btn" data-product-id="${prod.id}"><i class="far fa-heart"></i></button>
                        </div>
                        <div class="product-info-card">
                            <div>
                                <div class="product-subtitle">${subtitle}</div>
                                <h3 class="product-name">${prod.name}</h3>
                                <p class="product-description">${description}</p>
                            </div>
                            <div>
                                <div class="product-price">
                                    <div class="price">$${prod.price.toFixed(2)}</div>
                                    ${prod.oldPrice ? `<div class="old-price">$${prod.oldPrice.toFixed(2)}</div>` : ''}
                                </div>
                                <button class="add-to-cart-btn" data-product-id="${prod.id}">
                                    <i class="fas fa-shopping-cart"></i> Add to Cart
                                    <span class="cart-quantity-badge"></span>
                                </button>
                            </div>
                        </div>
                    </div>`; 
        }


/* ---- user profile document (created on first sign in) ---- */

async function createUserProfileDocument(userAuth) {
        if (!userAuth) return;

        const userRef = doc(db, "users", userAuth.uid);
        const userSnapshot = await getDoc(userRef);

        if (!userSnapshot.exists()) {
            const { email, displayName } = userAuth;
            const createdAt = new Date();

            try {
                await setDoc(userRef, {
                    displayName: displayName || email.split('@')[0],
                    email,
                    createdAt,
                    wishlist: [],
                    address: {},
                    totalOrders: 0,
                    totalSpent: 0,
                    lastActivity: createdAt
                });
            } catch (error) {
                console.error("Error creating user profile", error.message);
            }
        }
        return userRef;
    }


/* ---- cart & wishlist ---- */

async function updateHeaderCounters() { const user = auth.currentUser; let cartItemCount = 0; let wishlistItemCount = 0; if (user) { const cartSnapshot = await getDocs(collection(db, `users/${user.uid}/cart`)); cartSnapshot.forEach(doc => { cartItemCount += doc.data().quantity; }); const userDoc = await getDoc(doc(db, "users", user.uid)); if (userDoc.exists() && userDoc.data().wishlist) { wishlistItemCount = userDoc.data().wishlist.length; wishlistProductIds = new Set(userDoc.data().wishlist); } } else { const localCart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || []; localCart.forEach(item => { cartItemCount += item.quantity; }); const localWishlist = JSON.parse(localStorage.getItem(WISHLIST_STORAGE_KEY)) || []; wishlistItemCount = localWishlist.length; wishlistProductIds = new Set(localWishlist); } document.querySelectorAll('.cart-count, .cart-count-badge').forEach(el => { el.textContent = cartItemCount; el.style.display = cartItemCount > 0 ? 'flex' : 'none'; }); document.querySelectorAll('.wishlist-count, .wishlist-count-badge').forEach(el => { el.textContent = wishlistItemCount; el.style.display = wishlistItemCount > 0 ? 'flex' : 'none'; }); document.querySelectorAll('.wishlist-toggle-btn').forEach(btn => { const icon = btn.querySelector('i'); if (wishlistProductIds.has(btn.dataset.productId)) { btn.classList.add('active'); icon.classList.remove('far'); icon.classList.add('fas'); } else { btn.classList.remove('active'); icon.classList.remove('fas'); icon.classList.add('far'); } }); }

async function updateProductCartStatus(productId) {
        const user = auth.currentUser;
        let quantityInCart = 0;
        if (user) {
            const cartItemRef = doc(db, `users/${user.uid}/cart`, productId);
            const docSnap = await getDoc(cartItemRef);
            if (docSnap.exists()) {
                quantityInCart = docSnap.data().quantity;
            }
        } else {
            const cart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || [];
            const existingItem = cart.find(item => item.productId === productId);
            if (existingItem) {
                quantityInCart = existingItem.quantity;
            }
        }

        const buttons = document.querySelectorAll(`.add-to-cart-btn[data-product-id="${productId}"]`);
        buttons.forEach(btn => {
            const badge = btn.querySelector('.cart-quantity-badge');
            if (badge) {
                if (quantityInCart > 0) {
                    badge.textContent = quantityInCart;
                    badge.classList.add('visible');
                } else {
                    badge.classList.remove('visible');
                }
            }
        });
    }

async function addToCart(productId, buttonElement) {
        const user = auth.currentUser;
        if (user) {
            const cartItemRef = doc(db, `users/${user.uid}/cart`, productId);
            try {
                await runTransaction(db, async (transaction) => {
                    const cartItemDoc = await transaction.get(cartItemRef);
                    if (!cartItemDoc.exists()) {
                        transaction.set(cartItemRef, { quantity: 1, addedAt: new Date() });
                    } else {
                        const newQuantity = cartItemDoc.data().quantity + 1;
                        transaction.update(cartItemRef, { quantity: newQuantity });
                    }
                });
            } catch (e) { console.error("Transaction failed: ", e); }
        } else {
            let cart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || [];
            const existingItem = cart.find(item => item.productId === productId);
            if (existingItem) { existingItem.quantity++; } else { cart.push({ productId, quantity: 1 }); }
            localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
        }
        showToast('Added to cart!', 'success');
        await updateHeaderCounters();
        await updateProductCartStatus(productId);

        if (buttonElement) {
            const originalTextNode = Array.from(buttonElement.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0);
            const originalText = originalTextNode ? originalTextNode.textContent : 'Add to Cart';
            
            if (originalTextNode) originalTextNode.textContent = ' Added!';
            buttonElement.classList.add('added');
            buttonElement.disabled = true;
            
            setTimeout(() => {
                if (originalTextNode) originalTextNode.textContent = originalText;
                buttonElement.classList.remove('added');
                buttonElement.disabled = false;
            }, 2000);
        }
    }

async function toggleWishlist(productId) { const user = auth.currentUser; if (user) { const userDocRef = doc(db, "users", user.uid); if (wishlistProductIds.has(productId)) { await updateDoc(userDocRef, { wishlist: arrayRemove(productId) }); showToast('Removed from wishlist.', 'danger'); } else { await updateDoc(userDocRef, { wishlist: arrayUnion(productId) }); showToast('Added to wishlist!', 'success'); } } else { let localWishlist = JSON.parse(localStorage.getItem(WISHLIST_STORAGE_KEY)) || []; const itemIndex = localWishlist.indexOf(productId); if (itemIndex > -1) { localWishlist.splice(itemIndex, 1); showToast('Removed from wishlist.', 'danger'); } else { localWishlist.push(productId); showToast('Added to wishlist! Sign in to save it.', 'info'); } localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(localWishlist)); } await updateHeaderCounters(); }

async function syncCartOnAuth(user) { const localCart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || []; if (localCart.length === 0) return; const cartCollectionRef = collection(db, `users/${user.uid}/cart`); const batch = writeBatch(db); for (const localItem of localCart) { const docRef = doc(cartCollectionRef, localItem.productId); const docSnap = await getDoc(docRef); if (docSnap.exists()) { const newQuantity = docSnap.data().quantity + localItem.quantity; batch.update(docRef, { quantity: newQuantity }); } else { batch.set(docRef, { quantity: localItem.quantity, addedAt: new Date() }); } } await batch.commit(); localStorage.removeItem(CART_STORAGE_KEY); showToast('Your cart has been synced!', 'info'); }

async function syncWishlistOnAuth(user) { const localWishlist = JSON.parse(localStorage.getItem(WISHLIST_STORAGE_KEY)) || []; if (localWishlist.length === 0) return; const userDocRef = doc(db, "users", user.uid); const userDoc = await getDoc(userDocRef); const firestoreWishlist = userDoc.exists() && userDoc.data().wishlist ? userDoc.data().wishlist : []; const merged = [...new Set([...firestoreWishlist, ...localWishlist])]; await setDoc(userDocRef, { wishlist: merged }, { merge: true }); localStorage.removeItem(WISHLIST_STORAGE_KEY); }

/* ---- login / register modal ---- */
const loginModal = document.getElementById('login-modal');
const closeModalBtn = document.querySelector('.close-modal-btn');
const desktopAuthBtn = document.getElementById('auth-button');
const mobileAuthBtn = document.getElementById('mobile-auth-button');
const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('auth-email');
const passwordInput = document.getElementById('auth-password');
const errorContainer = document.getElementById('auth-error');
const forgotPasswordLink = document.getElementById('forgot-password-link');

function openLoginModal(e) { e.preventDefault(); loginModal.style.display = 'block'; }
function closeLoginModal() { loginModal.style.display = 'none'; authForm.reset(); errorContainer.textContent = ''; }

document.getElementById('google-signin-btn').addEventListener('click', async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); closeLoginModal(); }
    catch (error) { errorContainer.textContent = error.message; }
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value;
    const password = passwordInput.value;
    errorContainer.textContent = '';
    try { await signInWithEmailAndPassword(auth, email, password); closeLoginModal(); }
    catch (error) {
        if (error.code === 'auth/user-not-found') {
            try { await createUserWithEmailAndPassword(auth, email, password); closeLoginModal(); }
            catch (createError) { errorContainer.textContent = createError.message; }
        } else { errorContainer.textContent = error.message; }
    }
});

forgotPasswordLink.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = emailInput.value;
    if (!email) { alert('Please enter your email in the email field to reset the password.'); return; }
    try { await sendPasswordResetEmail(auth, email); alert('Password reset email sent! Please check your inbox.'); }
    catch (error) { alert(`Error: ${error.message}`); }
});


function updateUIForAuthState(user) { if (user) { const userName = user.displayName || user.email.split('@')[0]; desktopAuthBtn.href = "/profile.html"; desktopAuthBtn.innerHTML = `<i class="fas fa-user-check"></i> <span class="auth-text">${userName}</span>`; desktopAuthBtn.title = "My Account"; desktopAuthBtn.removeEventListener('click', openLoginModal); mobileAuthBtn.href = "/profile.html"; mobileAuthBtn.querySelector('span').textContent = userName; mobileAuthBtn.removeEventListener('click', openLoginModal); } else { desktopAuthBtn.href = "#"; desktopAuthBtn.innerHTML = `<i class="far fa-user"></i> <span class="auth-text">Sign In</span>`; desktopAuthBtn.title = "Sign In"; desktopAuthBtn.addEventListener('click', openLoginModal); mobileAuthBtn.href = "#"; mobileAuthBtn.querySelector('span').textContent = 'Sign In / Register'; mobileAuthBtn.addEventListener('click', openLoginModal); } }

function openLoginModalForGuests(e) { e.preventDefault(); openLoginModal(e); }

function setupGuestInteractions() { const user = auth.currentUser; const wishlistLinks = document.querySelectorAll('a[href="/profile.html#wishlist"]'); wishlistLinks.forEach(link => { link.removeEventListener('click', openLoginModalForGuests); if (!user) { link.addEventListener('click', openLoginModalForGuests); } }); }


/* ---- global auth-state listener: keeps header, cart and wishlist in
   sync the moment the user signs in or out, on every page ---- */
onAuthStateChanged(auth, async (user) => {
    updateUIForAuthState(user);

    if (user) {
        await createUserProfileDocument(user);
        await syncCartOnAuth(user);
        await syncWishlistOnAuth(user);
    }

    setupGuestInteractions();
    await updateHeaderCounters();

    document.querySelectorAll('.add-to-cart-btn[data-product-id]').forEach(btn => {
        updateProductCartStatus(btn.dataset.productId);
    });
});



/* ---------------------------------------------------------------------- */
/* Shared page-shell wiring: mobile menu, search modal/box, footer's
   "secret" double-click into /admin.html, scroll-reveal animations.
   Called once by every page's init function.                             */
/* ---------------------------------------------------------------------- */
function initCommonUI() {
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    const navLinks = document.getElementById('main-nav');
    const footer = document.getElementById('footer');

    if (mobileMenuBtn && navLinks) {
        mobileMenuBtn.addEventListener('click', () => {
            const isActive = navLinks.classList.toggle('active');
            mobileMenuBtn.classList.toggle('active', isActive);
            mobileMenuBtn.innerHTML = isActive ? '<i class="fas fa-times"></i>' : '<i class="fas fa-bars"></i>';
        });

        document.querySelectorAll('#main-nav a').forEach(link => {
            link.addEventListener('click', (e) => {
                if (navLinks.classList.contains('active')) {
                    if (link.closest('.mobile-actions')) return;
                    e.preventDefault();
                    navLinks.style.transform = 'translateX(-100%)';
                    mobileMenuBtn.classList.remove('active');
                    mobileMenuBtn.innerHTML = '<i class="fas fa-bars"></i>';
                    setTimeout(() => {
                        navLinks.classList.remove('active');
                        navLinks.style.transform = '';
                        window.location.href = link.href;
                    }, 400);
                }
            });
        });
    }

    closeModalBtn.addEventListener('click', closeLoginModal);
    window.addEventListener('click', (e) => { if (e.target == loginModal) closeLoginModal(); });
    setupGuestInteractions();

    const desktopSearchBtn = document.querySelector('.search-btn.desktop-only');
    const searchModal = document.getElementById('search-modal');
    const closeSearchModalBtn = document.querySelector('.close-search-modal-btn');
    const desktopSearchForm = document.getElementById('desktop-search-form');
    const desktopSearchInput = document.getElementById('desktop-search-input');

    if (desktopSearchBtn && searchModal) {
        desktopSearchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            searchModal.style.display = 'block';
            desktopSearchInput.focus();
        });
        const closeSearchModal = () => { searchModal.style.display = 'none'; };
        closeSearchModalBtn.addEventListener('click', closeSearchModal);
        searchModal.addEventListener('click', (e) => { if (e.target === searchModal) closeSearchModal(); });
        desktopSearchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const q = desktopSearchInput.value.trim();
            if (q) window.location.href = `/catalog.html?search=${encodeURIComponent(q)}`;
        });
    }

    const mobileSearchForm = document.querySelector('.mobile-search .search-box');
    if (mobileSearchForm) {
        const mobileSearchInput = mobileSearchForm.querySelector('input');
        mobileSearchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const q = mobileSearchInput.value.trim();
            if (q) window.location.href = `/catalog.html?search=${encodeURIComponent(q)}`;
        });
    }

    if (footer) {
        let clickCount = 0, clickTimer = null;
        footer.addEventListener('click', () => {
            clickCount++;
            if (clickCount === 1) { clickTimer = setTimeout(() => { clickCount = 0; }, 400); }
            else if (clickCount === 2) { clearTimeout(clickTimer); clickCount = 0; window.location.href = 'admin.html'; }
        });
    }

    const animationObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add('is-visible');
            else entry.target.classList.remove('is-visible');
        });
    }, { threshold: 0.15 });
    document.querySelectorAll('.animate-on-scroll').forEach(el => animationObserver.observe(el));

    const observeDynamicContent = (container) => {
        if (!container) return;
        const mutationObserver = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        node.querySelectorAll('.animate-on-scroll').forEach(el => animationObserver.observe(el));
                        if (node.classList.contains('animate-on-scroll')) animationObserver.observe(node);
                    }
                });
            });
        });
        mutationObserver.observe(container, { childList: true, subtree: true });
    };
    observeDynamicContent(document.getElementById('category-carousels-container'));
    observeDynamicContent(document.querySelector('.products-grid'));
    observeDynamicContent(document.getElementById('related-products-grid'));
}


/* ---------------------------------------------------------------------- */
/* 2. PAGES                                                                 */
/* ---------------------------------------------------------------------- */

/* ============================== INDEX PAGE ============================= */
function initIndexPage() {
    const loader = document.getElementById('loader');
    const mainContent = document.getElementById('main-site-content');

    async function fetchHeroData() { const docSnap = await getDoc(doc(db, "siteContent", "hero")); return docSnap.exists() ? docSnap.data() : null; }
    async function fetchProducts() { const querySnapshot = await getDocs(query(collection(db, "products"))); return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); }
    function updateMetaTags(title, description) { if (title) document.title = title; let metaDesc = document.querySelector('meta[name="description"]'); if (description) metaDesc.setAttribute('content', description); }

    function renderHero(heroData) {
        const heroContent = document.querySelector('#hero-section .hero-content');
        if (!heroData || !heroContent) return;

        heroContent.querySelector('.hero-subtitle').textContent = heroData.heroSubtitle;
        heroContent.querySelector('.hero-title').textContent = heroData.heroTitle;
        heroContent.querySelector('.hero-description').textContent = heroData.heroDescription;

        const heroBg = document.querySelector('#hero-section .hero-bg');
        if (heroData.heroBgImage) heroBg.style.setProperty('--hero-bg-desktop', `url('${heroData.heroBgImage}')`);
        if (heroData.heroBgImageMobile) heroBg.style.setProperty('--hero-bg-mobile', `url('${heroData.heroBgImageMobile}')`);
        else heroBg.style.setProperty('--hero-bg-mobile', `url('${heroData.heroBgImage}')`);

        updateMetaTags(heroData.metaTitle, heroData.metaDescription);
    }

    const CATEGORIES_TO_DISPLAY = ['Red Wine', 'White Wine', 'Sparkling Wine', 'Rosé Wine', 'Fortified Wine', 'Dessert Wine', 'Vermouth & Aromatized Wine', 'Natural Wine', 'Orange Wine'];

    function renderCategoryCarousels(products) {
        const container = document.getElementById('category-carousels-container');
        container.innerHTML = '';

        const productsByCategory = products.reduce((acc, product) => {
            if (product.category && !product.isArchived) (acc[product.category] = acc[product.category] || []).push(product);
            return acc;
        }, {});

        CATEGORIES_TO_DISPLAY.forEach(categoryName => {
            const categoryProducts = productsByCategory[categoryName];
            if (!categoryProducts || categoryProducts.length === 0) return;

            const selectedProducts = categoryProducts.sort(() => 0.5 - Math.random()).slice(0, 15);
            const carouselId = `carousel-${categoryName.replace(/[^a-zA-Z0-9]/g, '-')}`;
            const categorySlug = generateSlug(categoryName);
            const categoryUrl = `/${categorySlug}`;

            const carouselWrapper = document.createElement('div');
            carouselWrapper.className = 'category-carousel-wrapper animate-on-scroll';
            carouselWrapper.innerHTML = `<div class="carousel-header"><a href="${categoryUrl}"><h2>${categoryName}</h2></a><div class="carousel-nav"><button class="nav-arrow prev-arrow" aria-label="Previous"><i class="fas fa-chevron-left"></i></button><button class="nav-arrow next-arrow" aria-label="Next"><i class="fas fa-chevron-right"></i></button></div></div><div class="products-carousel" id="${carouselId}"></div>`;

            const productsCarousel = carouselWrapper.querySelector('.products-carousel');
            selectedProducts.forEach(prod => { productsCarousel.innerHTML += createProductCardHTML(prod); });
            container.appendChild(carouselWrapper);
            setupCarouselNavigation(carouselWrapper);
            carouselWrapper.querySelectorAll('.slideshow-container').forEach(setupSlideshow);
        });
    }

    function setupCarouselNavigation(carouselWrapper) {
        const carousel = carouselWrapper.querySelector('.products-carousel');
        const prevBtn = carouselWrapper.querySelector('.prev-arrow');
        const nextBtn = carouselWrapper.querySelector('.next-arrow');
        const updateArrows = () => {
            if (!carousel) return;
            const maxScrollLeft = carousel.scrollWidth - carousel.clientWidth;
            prevBtn.disabled = carousel.scrollLeft < 10;
            nextBtn.disabled = carousel.scrollLeft > maxScrollLeft - 10;
        };
        prevBtn.addEventListener('click', () => carousel.scrollBy({ left: -carousel.clientWidth, behavior: 'smooth' }));
        nextBtn.addEventListener('click', () => carousel.scrollBy({ left: carousel.clientWidth, behavior: 'smooth' }));
        carousel.addEventListener('scroll', updateArrows, { passive: true });
        new ResizeObserver(updateArrows).observe(carousel);
        updateArrows();
    }

    function renderFeaturedProducts(products) {
        const grid = document.querySelector('#products-section .products-grid');
        grid.innerHTML = '';
        products.filter(p => !p.isArchived).slice(0, 4).forEach(prod => { grid.innerHTML += createProductCardHTML(prod); });
        document.querySelectorAll('#products-section .slideshow-container').forEach(setupSlideshow);
    }

    function enhanceCarousels() {
        document.querySelectorAll('.category-carousel-wrapper').forEach(wrapper => {
            const carousel = wrapper.querySelector('.products-carousel');
            if (!carousel) return;
            const progressBarContainer = document.createElement('div');
            progressBarContainer.className = 'carousel-progress';
            progressBarContainer.innerHTML = '<div class="carousel-progress-bar"></div>';
            wrapper.appendChild(progressBarContainer);
            const updateProgress = () => {
                const scrollableWidth = carousel.scrollWidth - carousel.clientWidth;
                if (scrollableWidth <= 0) { progressBarContainer.style.display = 'none'; return; }
                progressBarContainer.style.display = 'block';
                const progress = (carousel.scrollLeft / scrollableWidth) * 100;
                progressBarContainer.querySelector('.carousel-progress-bar').style.width = `${progress}%`;
            };
            carousel.addEventListener('scroll', updateProgress, { passive: true });
            new ResizeObserver(updateProgress).observe(carousel);
            updateProgress();
        });
    }
    const carouselObserver = new MutationObserver((mutationsList, obs) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) { enhanceCarousels(); obs.disconnect(); break; }
        }
    });
    const carouselsContainer = document.getElementById('category-carousels-container');
    if (carouselsContainer) carouselObserver.observe(carouselsContainer, { childList: true });

    async function main() {
        try {
            const [hero, products] = await Promise.all([fetchHeroData(), fetchProducts()]);
            renderHero(hero);
            renderCategoryCarousels(products);
            renderFeaturedProducts(products);
        } catch (error) {
            console.error("Error initializing page: ", error);
            document.body.innerHTML = `<div style="padding: 40px; text-align: center;"><h1>Error loading page data.</h1><p>${error.message}</p></div>`;
        }
    }

    main().finally(() => {
        loader.classList.add('hidden');
        mainContent.classList.add('loaded');
    });

    // index-page-only delegated click handler
    document.getElementById('main-site-content').addEventListener('click', function(e) {
        const cartButton = e.target.closest('.add-to-cart-btn');
        const wishlistButton = e.target.closest('.wishlist-toggle-btn');
        if (cartButton) {
            e.preventDefault(); e.stopPropagation();
            addToCart(cartButton.dataset.productId, cartButton);
        } else if (wishlistButton) {
            e.preventDefault(); e.stopPropagation();
            toggleWishlist(wishlistButton.dataset.productId);
        } else {
            const card = e.target.closest('.product-card');
            if (card && card.dataset.url) window.location.href = card.dataset.url;
        }
    });
}


/* ============================= CATALOG PAGE ============================= */
function initCatalogPage() {

        let allProducts = [];
        let filteredProducts = [];
        let displayedProductsCount = 0;
        const PRODUCTS_PER_PAGE = 12;
        const stillWineSweetnessOptions = ['Dry', 'Semi-Dry', 'Semi-Sweet', 'Sweet'];
        const sparklingWineSweetnessOptions = ['Brut Nature', 'Extra Brut', 'Brut', 'Extra-Dry', 'Dry / Sec', 'Demi-Sec', 'Doux'];
        let regionToCountryMap = {};
        let appellationToRegionMap = {};
        let countryToRegionsMap = {};
        let regionToAppellationsMap = {};
        const state = { filters: { category: [], country: [], region: [], appellation: [], grapeVarieties: [], sweetness: [], volume: [], year: [], price: { min: 0, max: 9999 } }, sorting: 'popularity' };

        const productsGrid = document.getElementById('products-grid');
        const productsCountEl = document.querySelector('.products-count');
        const filtersContainer = document.getElementById('filters-container');
        const sortSelect = document.getElementById('sort-select');
        const resetFiltersBtn = document.querySelector('.reset-filters');
        const breadcrumbContainer = document.getElementById('breadcrumb-container');
        const activeFiltersContainer = document.getElementById('active-filters-container');
        const loadMoreBtn = document.getElementById('load-more-btn');
        const pageTitleEl = document.querySelector('.page-title');

        // Animation Observer
        const animationObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    if(entry.target.classList.contains('product-card')) {
                        entry.target.classList.add('animated');
                    }
                }
            });
        }, { threshold: 0.1 });

        // Breadcrumb Sticky Logic (Unified)
        let lastScrollTop = 0;
        const breadcrumbSection = document.querySelector('.breadcrumb-section');
        window.addEventListener('scroll', () => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            if (scrollTop > lastScrollTop && scrollTop > 200) { breadcrumbSection.classList.add('scrolled-up'); } 
            else if (scrollTop < lastScrollTop && scrollTop > 200) { breadcrumbSection.classList.add('scrolled-up'); } 
            else { breadcrumbSection.classList.remove('scrolled-up'); }
            lastScrollTop = scrollTop;
        });

        async function updateMetaTags() {
            const selectedCategories = state.filters.category;
            let pageTitle = 'Wine Catalog | VinoElite';
            let pageDescription = 'Explore the exclusive collection of wines at VinoElite.';
            function generateTagsByTemplate() {
                const selectedCountries = state.filters.country;
                if (selectedCategories.length > 0 || selectedCountries.length > 0) {
                    const categoryText = selectedCategories.length > 0 ? selectedCategories.join(', ') : 'Wines';
                    const countryText = selectedCountries.length > 0 ? ` from ${selectedCountries.join(', ')}` : '';
                    pageTitle = `${categoryText}${countryText} | VinoElite`;
                    pageDescription = `Discover our premium selection of ${categoryText.toLowerCase()}${countryText}. Best prices and exclusive varieties.`;
                }
            }
            if (selectedCategories.length === 1) {
                const categoryName = selectedCategories[0];
                const categoryMeta = await loadCategoryMeta(categoryName);
                if (categoryMeta && categoryMeta.metaTitle && categoryMeta.metaDescription) { pageTitle = categoryMeta.metaTitle; pageDescription = categoryMeta.metaDescription; } 
                else { generateTagsByTemplate(); }
            } else { generateTagsByTemplate(); }
            document.title = pageTitle;
            const descriptionTag = document.querySelector('meta[name="description"]');
            if(descriptionTag) descriptionTag.setAttribute('content', pageDescription);
            const ogTitleTag = document.querySelector('meta[property="og:title"]');
            if(ogTitleTag) ogTitleTag.setAttribute('content', pageTitle);
            const ogDescriptionTag = document.querySelector('meta[property="og:description"]');
            if(ogDescriptionTag) ogDescriptionTag.setAttribute('content', pageDescription);
            const ogUrlTag = document.querySelector('meta[property="og:url"]');
            if(ogUrlTag) ogUrlTag.setAttribute('content', window.location.href);
            return { pageTitle, pageDescription };
        }

        function updateSchema(products, pageName, pageDescription) {
            const schemaScript = document.getElementById('schema-json');
            if (!schemaScript) return;
            const schemaData = { "@context": "https://schema.org", "@type": "CollectionPage", "name": pageName, "description": pageDescription, "url": window.location.href, "mainEntity": { "@type": "ItemList", "itemListElement": [], "numberOfItems": products.length } };
            products.slice(0, 10).forEach((product, index) => {
                const imageUrls = (product.imageUrls && Array.isArray(product.imageUrls) && product.imageUrls.length > 0) ? product.imageUrls : [product.imageUrl];
                schemaData.mainEntity.itemListElement.push({ "@type": "ListItem", "position": index + 1, "item": { "@type": "Product", "name": product.name, "description": product.metaDescription || product.description || '', "image": imageUrls[0], "url": `https://vinoelite.com/${generateSlug(product.category)}/${product.slug}`, "brand": { "@type": "Brand", "name": product.winery || "VinoElite" }, "offers": { "@type": "Offer", "priceCurrency": "USD", "price": product.price, "availability": "https://schema.org/InStock", "seller": { "@type": "Organization", "name": "VinoElite" } } } });
            });
            schemaScript.textContent = JSON.stringify(schemaData);
        }

        async function loadCategoryMeta(categoryName) {
            try {
                const q = query(collection(db, "categories"), where("name", "==", categoryName));
                const querySnapshot = await getDocs(q);
                if (!querySnapshot.empty) { return querySnapshot.docs[0].data(); }
                return null;
            } catch (error) { console.error("Error loading category meta:", error); return null; }
        }

        function setupSlideshow(container) {
            if (!container) return;
            const slides = Array.from(container.querySelectorAll('.slideshow-item'));
            if (slides.length <= 1) { if (slides.length === 1) slides[0].classList.add('active'); return; }
            if (container.querySelector('.slideshow-overlay')) return;
            const overlay = document.createElement('div'); overlay.className = 'slideshow-overlay'; container.appendChild(overlay);
            let currentIndex = 0; let intervalId = setInterval(() => showSlide(currentIndex + 1), 4000);
            function showSlide(index) { const oldSlide = slides[currentIndex]; if (oldSlide) oldSlide.classList.remove('active'); currentIndex = (index + slides.length) % slides.length; const newSlide = slides[currentIndex]; if (newSlide) setTimeout(() => newSlide.classList.add('active'), 50); }
            function manualSlide(direction) { clearInterval(intervalId); showSlide(currentIndex + direction); intervalId = setInterval(() => showSlide(currentIndex + 1), 5000); }
            let touchStartX = 0;
            overlay.addEventListener('mousedown', e => { touchStartX = e.clientX; overlay.style.cursor = 'grabbing'; clearInterval(intervalId); });
            overlay.addEventListener('mouseup', e => { overlay.style.cursor = 'grab'; if (e.clientX < touchStartX - 50) { manualSlide(1); } else if (e.clientX > touchStartX + 50) { manualSlide(-1); } else { intervalId = setInterval(() => showSlide(currentIndex + 1), 5000); } });
            overlay.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; clearInterval(intervalId); }, { passive: true });
            overlay.addEventListener('touchend', e => { let touchEndX = e.changedTouches[0].clientX; if (touchEndX < touchStartX - 50) { manualSlide(1); } else if (touchEndX > touchStartX + 50) { manualSlide(-1); } else { intervalId = setInterval(() => showSlide(currentIndex + 1), 5000); } });
            showSlide(0);
        }

        async function fetchProductsAndInit() {
            try {
                const initialQuery = query(collection(db, "products"), where("isArchived", "==", false), limit(12));
                const initialSnapshot = await getDocs(initialQuery);
                const initialProducts = initialSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                allProducts = initialProducts;
                filteredProducts = initialProducts;
                await main(); 
                
                const lastVisible = initialSnapshot.docs[initialSnapshot.docs.length - 1];
                if (lastVisible) {
                    setTimeout(async () => {
                        try {
                            const remainingQuery = query(collection(db, "products"), where("isArchived", "==", false), startAfter(lastVisible));
                            const remainingSnapshot = await getDocs(remainingQuery);
                            const remainingProducts = remainingSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                            allProducts = [...initialProducts, ...remainingProducts];
                            createGeoMaps();
                            renderFilters();
                            applyFilters(); 
                            applySorting();
                            if(productsCountEl) productsCountEl.textContent = `Showing ${displayedProductsCount} of ${filteredProducts.length} wines`;
                            if (loadMoreBtn && displayedProductsCount < filteredProducts.length) { loadMoreBtn.style.display = 'inline-block'; }
                        } catch (bgError) { console.error("Background loading failed:", bgError); }
                    }, 500);
                } else { createGeoMaps(); renderFilters(); }
            } catch (error) { console.error("Error fetching products: ", error); if(productsGrid) productsGrid.innerHTML = '<p>Error loading products. Please try again later.</p>'; }
        }

        function createGeoMaps() {
            allProducts.forEach(p => {
                if (p.region && p.country) { regionToCountryMap[p.region] = p.country; if (!countryToRegionsMap[p.country]) countryToRegionsMap[p.country] = new Set(); countryToRegionsMap[p.country].add(p.region); }
                if (p.appellation && p.region) { appellationToRegionMap[p.appellation] = p.region; if (!regionToAppellationsMap[p.region]) regionToAppellationsMap[p.region] = new Set(); regionToAppellationsMap[p.region].add(p.appellation); }
            });
        }

        function processSearchQueryAsFilter(searchQuery) {
            const query = searchQuery.toLowerCase();
            const newParams = new URLSearchParams();
            const filterTypes = ['category', 'country', 'region', 'appellation', 'grapeVarieties'];
            for (const type of filterTypes) {
                const values = getUniqueValues(type, allProducts);
                for (const value of values) {
                    if (value.toLowerCase() === query) {
                        if (type === 'appellation') {
                            const region = appellationToRegionMap[value];
                            const country = region ? regionToCountryMap[region] : null;
                            if (country) newParams.set('country', country);
                            if (region) newParams.set('region', region);
                            newParams.set('appellation', value);
                        } else if (type === 'region') {
                            const country = regionToCountryMap[value];
                            if (country) newParams.set('country', country);
                            newParams.set('region', value);
                        } else { newParams.set(type, value); }
                        window.location.replace(`${window.location.pathname}?${newParams.toString()}`);
                        return true;
                    }
                }
            }
            return false;
        }

        async function main() {
            const urlParams = new URLSearchParams(window.location.search);
            const searchQuery = urlParams.get('search');
            if (searchQuery) { const wasRedirected = processSearchQueryAsFilter(searchQuery); if (wasRedirected) return; }
            parseUrlParams();
            addEventListeners();
            validateAndCleanFilters();
            await runFilterAndSort();
            document.querySelectorAll('.animate-on-scroll').forEach(el => animationObserver.observe(el));
        }

        async function runFilterAndSort() {
            applyFilters();
            applySorting();
            updateURL();
            const { pageTitle, pageDescription } = await updateMetaTags();
            renderAll();
            updateDependentFilters();
            updateSchema(filteredProducts, pageTitle, pageDescription);
        }

        function applyFilters() {
            const urlParams = new URLSearchParams(window.location.search);
            const searchQuery = urlParams.get('search')?.toLowerCase().trim();
            if (searchQuery) { pageTitleEl.textContent = `Search Results for: "${urlParams.get('search')}"`; } else { pageTitleEl.textContent = 'Wine Catalog'; }
            filteredProducts = allProducts.filter(product => {
                if (searchQuery) {
                    const name = (product.name || '').toLowerCase();
                    const category = (product.category || '').toLowerCase();
                    const country = (product.country || '').toLowerCase();
                    const region = (product.region || '').toLowerCase();
                    const sweetness = (product.sweetness || '').toLowerCase();
                    const year = String(product.year || '');
                    const description = (product.description || product.metaDescription || '').toLowerCase();
                    const badge = (product.badge || '').toLowerCase();
                    const grape = (product.grapeVarieties || '').toLowerCase();
                    const isMatch = name.includes(searchQuery) || category.includes(searchQuery) || country.includes(searchQuery) || region.includes(searchQuery) || sweetness.includes(searchQuery) || year.includes(searchQuery) || description.includes(searchQuery) || badge.includes(searchQuery) || grape.includes(searchQuery);
                    if (!isMatch) return false;
                }
                if (product.price < state.filters.price.min || product.price > state.filters.price.max) { return false; }
                return Object.keys(state.filters).every(filterKey => {
                    if (filterKey === 'price') return true;
                    const selectedValues = state.filters[filterKey];
                    if (selectedValues.length === 0) return true;
                    const productValue = product[filterKey];
                    if (!productValue) return false;
                    if (filterKey === 'grapeVarieties') { const productGrapes = productValue.split(',').map(g => g.trim()); return selectedValues.some(v => productGrapes.includes(v)); }
                    return selectedValues.includes(String(productValue));
                });
            });
        }

        function applySorting() {
            state.sorting = sortSelect.value;
            switch (state.sorting) {
                case 'price-asc': filteredProducts.sort((a, b) => a.price - b.price); break;
                case 'price-desc': filteredProducts.sort((a, b) => b.price - a.price); break;
                case 'name-asc': filteredProducts.sort((a, b) => a.name.localeCompare(b.name)); break;
            }
        }
        
        function validateAndCleanFilters() {
            const { country, region, appellation } = state.filters;
            if (country.length > 0 && region.length > 0) {
                const validRegionsForSelectedCountries = new Set(allProducts.filter(p => country.includes(p.country) && p.region).map(p => p.region));
                const originalRegions = [...region];
                state.filters.region = region.filter(r => validRegionsForSelectedCountries.has(r));
                originalRegions.filter(r => !state.filters.region.includes(r)).forEach(r => { const checkbox = document.getElementById(`filter-region-${generateSlug(r)}`); if (checkbox) checkbox.checked = false; });
            }
            if (appellation.length > 0) {
                let relevantProducts = allProducts;
                if (state.filters.region.length > 0) { relevantProducts = relevantProducts.filter(p => state.filters.region.includes(p.region)); } 
                else if (country.length > 0) { relevantProducts = relevantProducts.filter(p => country.includes(p.country)); }
                const validAppellations = new Set(relevantProducts.filter(p => p.appellation).map(p => p.appellation));
                const originalAppellations = [...appellation];
                state.filters.appellation = appellation.filter(a => validAppellations.has(a));
                originalAppellations.filter(a => !state.filters.appellation.includes(a)).forEach(a => { const checkbox = document.getElementById(`filter-appellation-${generateSlug(a)}`); if (checkbox) checkbox.checked = false; });
            }
        }

        function renderAll() { renderBreadcrumbs(); renderActiveFilters(); renderProducts(true); }

        function renderProducts(reset = false) {
            if (reset) { productsGrid.innerHTML = ''; displayedProductsCount = 0; }
            const productsToRender = filteredProducts.slice(displayedProductsCount, displayedProductsCount + PRODUCTS_PER_PAGE);
            if (productsToRender.length === 0 && reset) { productsGrid.innerHTML = '<p>No products match your criteria.</p>'; }

            productsToRender.forEach((prod, index) => {
                const categorySlug = generateSlug(prod.category);
                const productUrl = `/${categorySlug}/${prod.slug}`;
                const card = document.createElement('div');
                card.className = 'product-card animate-on-scroll';
                card.dataset.url = productUrl;

                let subtitle = '';
                const mainInfo = [prod.category, prod.sweetness].filter(Boolean).join(' ');
                const originInfo = [prod.region, prod.country].filter(Boolean).join(', ');
                if (mainInfo) subtitle += mainInfo;
                if (originInfo) subtitle += (subtitle ? ' from ' : '') + originInfo;
                const description = prod.metaDescription || prod.description || '';
                const imageUrls = (prod.imageUrls && Array.isArray(prod.imageUrls) && prod.imageUrls.length > 0) ? prod.imageUrls : [prod.imageUrl];
                const loadingType = (reset && index < 4) ? 'eager' : 'lazy';
                
                const slidesHTML = imageUrls.map((url, i) => 
                    `<div class="slideshow-item ${i===0?'active':''}">
                        <img src="${url}" alt="${prod.name} view ${i + 1}" loading="${loadingType}" width="300" height="400" style="aspect-ratio: 3/4; object-fit: cover;">
                     </div>`
                ).join('');

                card.innerHTML = `
                    <div class="slideshow-container">
                        ${slidesHTML}
                        ${prod.badge ? `<div class="product-badge">${prod.badge}</div>` : ''}
                        <button class="wishlist-toggle-btn" data-product-id="${prod.id}" aria-label="Add to wishlist"><i class="far fa-heart"></i></button>
                    </div>
                    <div class="product-info-card">
                        <div>
                            <div class="product-subtitle">${subtitle}</div>
                            <h3 class="product-name">${prod.name}</h3>
                            <p class="product-description">${description}</p>
                        </div>
                        <div>
                            <div class="product-price-row">
                                <div class="price">$${prod.price.toFixed(2)}</div>
                                ${prod.oldPrice ? `<div class="old-price">$${prod.oldPrice.toFixed(2)}</div>` : ''}
                            </div>
                            <button class="add-to-cart-btn" data-product-id="${prod.id}">
                                <i class="fas fa-shopping-cart"></i> Add to Cart
                                <span class="cart-quantity-badge"></span>
                            </button>
                        </div>
                    </div>
                `;
                productsGrid.appendChild(card);
                animationObserver.observe(card);
            });

            productsGrid.querySelectorAll('.slideshow-container').forEach(setupSlideshow);
            updateHeaderCounters();
            productsToRender.forEach(prod => { updateProductCartStatus(prod.id); });
            displayedProductsCount += productsToRender.length;
            productsCountEl.textContent = `Showing ${displayedProductsCount} of ${filteredProducts.length} wines`;
            loadMoreBtn.style.display = displayedProductsCount < filteredProducts.length ? 'inline-block' : 'none';
        }

        function renderBreadcrumbs() {
            let html = `<a href="/index.html">Home</a> / <a href="/catalog.html">Catalog</a>`;
            let tempFilters = {};
            
            // UPDATED BREADCRUMB LOGIC FOR PRETTY URLS
            if (state.filters.category.length > 0) { 
                const value = state.filters.category.join(', '); 
                let href = '';
                if (state.filters.category.length === 1) {
                    href = `/${generateSlug(state.filters.category[0])}`;
                } else {
                    tempFilters.category = state.filters.category.join(','); 
                    href = `/catalog.html?${new URLSearchParams(tempFilters)}`;
                }
                html += ` / <a href="${href}">${value}</a>`; 
            }
            
            const countriesToShow = new Set(state.filters.country);
            const regionsToShow = new Set(state.filters.region);
            const appellationsToShow = new Set(state.filters.appellation);
            if (countriesToShow.size > 0) { const value = [...countriesToShow].sort().join(', '); tempFilters.country = state.filters.country.join(','); html += ` / <a href="/catalog.html?${new URLSearchParams(tempFilters)}">${value}</a>`; }
            if (regionsToShow.size > 0) { const value = [...regionsToShow].sort().join(', '); if (state.filters.region.length > 0) tempFilters.region = state.filters.region.join(','); html += ` / <a href="/catalog.html?${new URLSearchParams(tempFilters)}">${value}</a>`; }
            if (appellationsToShow.size > 0) { const value = [...appellationsToShow].sort().join(', '); if (state.filters.appellation.length > 0) tempFilters.appellation = state.filters.appellation.join(','); html += ` / <a href="/catalog.html?${new URLSearchParams(tempFilters)}">${value}</a>`; }
            breadcrumbContainer.innerHTML = html;
        }

        function renderActiveFilters() {
            activeFiltersContainer.innerHTML = '';
            Object.keys(state.filters).forEach(key => {
                if (key === 'price') return;
                state.filters[key].forEach(value => {
                    const pill = document.createElement('div');
                    pill.className = 'filter-pill';
                    pill.innerHTML = `<span>${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}</span><button data-key="${key}" data-value="${value}" aria-label="Remove filter">&times;</button>`;
                    activeFiltersContainer.appendChild(pill);
                });
            });
        }
        
        function renderSweetnessFilter() {
            const selectedCategories = state.filters.category;
            let relevantSweetnessOptions;
            if (selectedCategories.length === 0) { relevantSweetnessOptions = stillWineSweetnessOptions; } 
            else {
                const hasSparkling = selectedCategories.some(cat => cat.toLowerCase().includes('sparkling'));
                const hasStill = selectedCategories.some(cat => !cat.toLowerCase().includes('sparkling'));
                if (hasSparkling && !hasStill) { relevantSweetnessOptions = sparklingWineSweetnessOptions; } 
                else if (hasStill && !hasSparkling) { relevantSweetnessOptions = stillWineSweetnessOptions; } 
                else { relevantSweetnessOptions = [...new Set([...stillWineSweetnessOptions, ...sparklingWineSweetnessOptions])]; }
            }
            const allSweetnessValuesInCatalog = getUniqueValues('sweetness', allProducts);
            const optionsToRender = relevantSweetnessOptions.filter(opt => allSweetnessValuesInCatalog.has(opt));
            const container = document.querySelector('#sweetness-filter-group .filter-content');
            if (!container) return;
            let optionsHTML = '';
            optionsToRender.forEach(option => {
                const isChecked = state.filters.sweetness.includes(option);
                optionsHTML += `<div class="filter-option"><input type="checkbox" id="filter-sweetness-${generateSlug(option)}" value="${option}" data-key="sweetness" ${isChecked ? 'checked' : ''}><label for="filter-sweetness-${generateSlug(option)}"><span>${option}</span></label></div>`;
            });
            container.innerHTML = optionsHTML;
        }

        function renderFilters() {
            const filterDefinitions = [ { key: 'category', title: 'Category' }, { key: 'country', title: 'Country' }, { key: 'region', title: 'Region' }, { key: 'appellation', title: 'Appellation' }, { key: 'grapeVarieties', title: 'Grape' }, { key: 'sweetness', title: 'Sweetness' }, { key: 'volume', title: 'Volume' }, { key: 'year', title: 'Year' } ];
            filtersContainer.innerHTML = '';
            renderPriceFilter();
            filterDefinitions.forEach(({key, title}) => {
                if (key === 'sweetness') {
                    const group = document.createElement('div'); group.className = 'filter-group'; group.dataset.filterGroup = 'sweetness'; group.id = 'sweetness-filter-group';
                    group.innerHTML = `<div class="filter-title"><span>${title}</span></div><div class="filter-content"></div>`; filtersContainer.appendChild(group);
                } else {
                    const options = getUniqueValues(key, allProducts);
                    if (options.size === 0) return;
                    const group = document.createElement('div'); group.className = 'filter-group'; group.dataset.filterGroup = key;
                    let optionsHTML = '';
                    [...options].sort().forEach(option => {
                        const isChecked = state.filters[key] && state.filters[key].includes(option);
                        optionsHTML += `<div class="filter-option"><input type="checkbox" id="filter-${key}-${generateSlug(option)}" value="${option}" data-key="${key}" ${isChecked ? 'checked' : ''}><label for="filter-${key}-${generateSlug(option)}"><span>${option}</span></label></div>`;
                    });
                    group.innerHTML = `<div class="filter-title"><span>${title}</span></div><div class="filter-content">${optionsHTML}</div>`; filtersContainer.appendChild(group);
                }
            });
            renderSweetnessFilter();
        }

        function renderPriceFilter() {
            const prices = allProducts.map(p => p.price);
            const minPrice = prices.length ? Math.floor(Math.min(...prices)) : 0;
            const maxPrice = prices.length ? Math.ceil(Math.max(...prices)) : 1000;
            state.filters.price.min = minPrice; state.filters.price.max = maxPrice;
            const group = document.createElement('div'); group.className = 'filter-group';
            group.innerHTML = `<div class="filter-title"><span>Price</span></div><div class="filter-content"><div class="price-filter-inputs"><span id="price-min-label">$${minPrice}</span><span>-</span><span id="price-max-label">$${maxPrice}</span></div><div class="price-slider-container"><div class="price-slider-range"></div><input type="range" id="price-slider-min" min="${minPrice}" max="${maxPrice}" value="${minPrice}"><input type="range" id="price-slider-max" min="${minPrice}" max="${maxPrice}" value="${maxPrice}"></div></div>`;
            filtersContainer.appendChild(group);
        }
        
        function updateDependentFilters() {
            let availableProducts = allProducts.filter(product => {
                return Object.keys(state.filters).every(filterKey => {
                    if (['region', 'appellation'].includes(filterKey)) return true;
                    if (filterKey === 'price') return product.price >= state.filters.price.min && product.price <= state.filters.price.max;
                    const selectedValues = state.filters[filterKey];
                    if (selectedValues.length === 0) return true;
                    const productValue = product[filterKey];
                    if (!productValue) return false;
                    if (filterKey === 'grapeVarieties') { return selectedValues.some(v => product.grapeVarieties.split(',').map(g=>g.trim()).includes(v)); }
                    return selectedValues.includes(String(productValue));
                });
            });
            const selectedCountries = state.filters.country;
            let regionProducts = selectedCountries.length > 0 ? availableProducts.filter(p => selectedCountries.includes(p.country)) : availableProducts;
            const availableRegions = getUniqueValues('region', regionProducts);
            updateOptionsVisibility('region', availableRegions);
            const selectedRegions = state.filters.region;
            let appellationProducts = selectedRegions.length > 0 ? regionProducts.filter(p => selectedRegions.includes(p.region)) : regionProducts;
            const availableAppellations = getUniqueValues('appellation', appellationProducts);
            updateOptionsVisibility('appellation', availableAppellations);
        }

        function updateOptionsVisibility(filterKey, availableOptions) {
            const filterGroup = document.querySelector(`[data-filter-group="${filterKey}"]`);
            if (!filterGroup) return;
            const optionElements = filterGroup.querySelectorAll('.filter-option');
            optionElements.forEach(opt => { const input = opt.querySelector('input'); if (availableOptions.has(input.value)) { opt.classList.remove('disabled'); } else { opt.classList.add('disabled'); } });
        }

        function getUniqueValues(key, productList) {
            const values = new Set();
            productList.forEach(product => { if (product[key]) { if (key === 'grapeVarieties') { product[key].split(',').forEach(grape => values.add(grape.trim())); } else { values.add(String(product[key])); } } });
            return values;
        }

        function generateSlug(text) { if (!text) return ''; return text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, ''); }

        // --- UPDATED URL PARSING FOR PRETTY URLS ---
        function parseUrlParams() {
            const params = new URLSearchParams(window.location.search);
            const path = window.location.pathname;
            
            // Clean path: remove leading slash, trailing slash, and .html
            let pathSlug = path.replace(/^\//, '').replace(/\/$/, '').replace('.html', '');

            // Check if path matches a category slug
            if (CATEGORY_SLUG_MAP[pathSlug]) {
                state.filters.category = [CATEGORY_SLUG_MAP[pathSlug]];
            } 
            // Fallback to query params
            else if (params.has('category')) {
                state.filters.category = params.get('category').split(',');
            }

            // Parse other filters
            params.forEach((value, key) => {
                if (state.filters[key] !== undefined && key !== 'category' && key !== 'price' && key !== 'search') {
                    state.filters[key] = value.split(',');
                }
            });
        }

        // --- UPDATED URL UPDATING FOR PRETTY URLS ---
        function updateURL() {
            const params = new URLSearchParams();
            let newPath = '/catalog.html';

            // If exactly one category is selected, use pretty URL
            if (state.filters.category.length === 1) {
                const categoryName = state.filters.category[0];
                const slug = generateSlug(categoryName);
                if (slug) {
                    newPath = `/${slug}`;
                }
            } 
            // If multiple categories, use query params
            else if (state.filters.category.length > 1) {
                params.set('category', state.filters.category.join(','));
            }

            // Add other filters
            Object.keys(state.filters).forEach(key => {
                if (key !== 'category' && key !== 'price' && state.filters[key].length > 0) {
                    params.set(key, state.filters[key].join(','));
                }
            });

            // Preserve search
            const currentParams = new URLSearchParams(window.location.search);
            if (currentParams.has('search')) {
                params.set('search', currentParams.get('search'));
            }

            const queryString = params.toString();
            const finalUrl = queryString ? `${newPath}?${queryString}` : newPath;
            history.pushState({}, '', finalUrl);
        }

        function updateCheckboxesFromState() {
            const allCheckboxes = filtersContainer.querySelectorAll('input[type="checkbox"]');
            allCheckboxes.forEach(cb => { const key = cb.dataset.key; const value = cb.value; cb.checked = state.filters[key]?.includes(value) ?? false; });
        }

        function addEventListeners() {
            productsGrid.addEventListener('click', function(e) {
                const cartButton = e.target.closest('.add-to-cart-btn');
                const wishlistButton = e.target.closest('.wishlist-toggle-btn');
                if (cartButton) { e.preventDefault(); e.stopPropagation(); addToCart(cartButton.dataset.productId, cartButton); } 
                else if (wishlistButton) { e.preventDefault(); e.stopPropagation(); toggleWishlist(wishlistButton.dataset.productId); } 
                else { const card = e.target.closest('.product-card'); if (card && card.dataset.url) { window.location.href = card.dataset.url; } }
            });

            filtersContainer.addEventListener('change', e => {
                if (e.target.type !== 'checkbox') return;
                const key = e.target.dataset.key; const value = e.target.value; const isChecked = e.target.checked;
                if (isChecked) { if (!state.filters[key].includes(value)) state.filters[key].push(value); } else { state.filters[key] = state.filters[key].filter(v => v !== value); }
                if (isChecked) {
                    if (key === 'appellation') { const region = appellationToRegionMap[value]; if (region && !state.filters.region.includes(region)) { state.filters.region.push(region); const country = regionToCountryMap[region]; if (country && !state.filters.country.includes(country)) { state.filters.country.push(country); } } } 
                    else if (key === 'region') { const country = regionToCountryMap[value]; if (country && !state.filters.country.includes(country)) { state.filters.country.push(country); } }
                } else {
                    if (key === 'country') { const regionsToClear = countryToRegionsMap[value] || []; regionsToClear.forEach(region => { const appellationsToClear = regionToAppellationsMap[region] || []; appellationsToClear.forEach(appellation => { state.filters.appellation = state.filters.appellation.filter(a => a !== appellation); }); state.filters.region = state.filters.region.filter(r => r !== region); }); } 
                    else if (key === 'region') { const appellationsToClear = regionToAppellationsMap[value] || []; appellationsToClear.forEach(appellation => { state.filters.appellation = state.filters.appellation.filter(a => a !== appellation); }); }
                }
                updateCheckboxesFromState(); if (key === 'category') { renderSweetnessFilter(); } runFilterAndSort();
            });
            
            filtersContainer.addEventListener('input', e => {
                if (e.target.id === 'price-slider-min' || e.target.id === 'price-slider-max') {
                    const minSlider = document.getElementById('price-slider-min'); const maxSlider = document.getElementById('price-slider-max');
                    let minVal = parseInt(minSlider.value); let maxVal = parseInt(maxSlider.value);
                    if (maxVal < minVal) { [minVal, maxVal] = [maxVal, minVal]; minSlider.value = minVal; maxSlider.value = maxVal; }
                    state.filters.price.min = minVal; state.filters.price.max = maxVal;
                    document.getElementById('price-min-label').textContent = `$${minVal}`; document.getElementById('price-max-label').textContent = `$${maxVal}`;
                    const range = maxSlider.max - maxSlider.min; const minPercent = ((minVal - minSlider.min) / range) * 100; const maxPercent = ((maxVal - minSlider.min) / range) * 100;
                    document.querySelector('.price-slider-range').style.left = `${minPercent}%`; document.querySelector('.price-slider-range').style.width = `${maxPercent - minPercent}%`;
                }
            });

            filtersContainer.addEventListener('change', e => { if (e.target.id === 'price-slider-min' || e.target.id === 'price-slider-max') { runFilterAndSort(); } });

            activeFiltersContainer.addEventListener('click', e => {
                if (e.target.tagName === 'BUTTON') {
                    const key = e.target.dataset.key; const value = e.target.dataset.value;
                    const checkbox = document.getElementById(`filter-${key}-${generateSlug(value)}`);
                    if (checkbox) { checkbox.checked = false; checkbox.dispatchEvent(new Event('change', { bubbles: true })); }
                }
            });

            sortSelect.addEventListener('change', runFilterAndSort);

            resetFiltersBtn.addEventListener('click', () => {
                Object.keys(state.filters).forEach(key => { if (key !== 'price') { state.filters[key] = []; } });
                const minSlider = document.getElementById('price-slider-min'); const maxSlider = document.getElementById('price-slider-max');
                if (minSlider && maxSlider) {
                    const minPrice = parseInt(minSlider.min); const maxPrice = parseInt(maxSlider.max);
                    state.filters.price.min = minPrice; state.filters.price.max = maxPrice;
                    minSlider.value = minPrice; maxSlider.value = maxPrice;
                    document.getElementById('price-min-label').textContent = `$${minPrice}`; document.getElementById('price-max-label').textContent = `$${maxPrice}`;
                    document.querySelector('.price-slider-range').style.left = `0%`; document.querySelector('.price-slider-range').style.width = `100%`;
                }
                updateCheckboxesFromState(); renderSweetnessFilter();
                const currentUrl = new URL(window.location); currentUrl.searchParams.delete('search'); history.pushState({}, '', currentUrl);
                runFilterAndSort();
            });

            document.getElementById('grid-view-btn').addEventListener('click', () => { productsGrid.classList.remove('list-view'); productsGrid.classList.add('grid-view'); document.getElementById('grid-view-btn').classList.add('active'); document.getElementById('list-view-btn').classList.remove('active'); });
            document.getElementById('list-view-btn').addEventListener('click', () => { productsGrid.classList.remove('grid-view'); productsGrid.classList.add('list-view'); document.getElementById('list-view-btn').classList.add('active'); document.getElementById('grid-view-btn').classList.remove('active'); });

            loadMoreBtn.addEventListener('click', () => renderProducts(false));

            document.querySelector('.mobile-filters-btn').addEventListener('click', () => {
                const sidebar = document.querySelector('.filters-sidebar'); sidebar.classList.toggle('active');
                const btnText = sidebar.classList.contains('active') ? 'Hide Filters' : 'Show Filters';
                document.querySelector('.mobile-filters-btn span').textContent = btnText;
            });
        }

        setTimeout(() => { fetchProductsAndInit(); }, 100);
    
}


/* ============================= PRODUCT PAGE ============================= */
function initProductPage() {
    function getProductSlugFromUrl() {
        const path = window.location.pathname;
        const parts = path.split('/').filter(part => part);
        return (parts.length >= 2) ? parts[parts.length - 1] : null;
    }

    /* This page has its own add-to-cart with an explicit quantity (the
       quantity stepper next to the big Add to Cart button); it shadows the
       shared 2-argument version only inside this function's scope. */
    async function addToCart(productId, quantity, buttonElement) {
        const user = auth.currentUser;
        if (user) {
            const cartItemRef = doc(db, `users/${user.uid}/cart`, productId);
            await runTransaction(db, async (transaction) => {
                const cartItemDoc = await transaction.get(cartItemRef);
                const newQuantity = cartItemDoc.exists() ? cartItemDoc.data().quantity + quantity : quantity;
                transaction.set(cartItemRef, { quantity: newQuantity, addedAt: new Date() }, { merge: true });
            });
        } else {
            let cart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || [];
            const existingItem = cart.find(item => item.productId === productId);
            if (existingItem) { existingItem.quantity += quantity; } else { cart.push({ productId, quantity }); }
            localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
        }
        showToast('Added to cart!', 'success');
        await updateHeaderCounters();
        await updateProductCartStatus(productId);
        if (buttonElement) {
            const originalTextNode = Array.from(buttonElement.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0);
            const originalText = originalTextNode ? originalTextNode.textContent : 'Add to Cart';
            if (originalTextNode) originalTextNode.textContent = 'Added!';
            buttonElement.classList.add('added');
            buttonElement.disabled = true;
            setTimeout(() => {
                if (originalTextNode) originalTextNode.textContent = originalText;
                buttonElement.classList.remove('added');
                buttonElement.disabled = false;
            }, 2000);
        }
    }

async function fetchReviewsForProduct(productId) { 
        const reviewsQuery = query(collection(db, `products/${productId}/reviews`), orderBy('createdAt', 'desc')); 
        const snapshot = await getDocs(reviewsQuery); 
        const reviews = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })); 
        if (reviews.length === 0) return []; 
        
        const userIds = [...new Set(reviews.map(review => review.userId).filter(Boolean))]; 
        const userProfiles = {}; 
        if (userIds.length > 0) { 
            try {
                const userDocsPromises = userIds.map(uid => getDoc(doc(db, "users", uid))); 
                const userDocsSnapshots = await Promise.all(userDocsPromises); 
                userDocsSnapshots.forEach(userDoc => { 
                    if (userDoc.exists()) { 
                        const userData = userDoc.data(); 
                        userProfiles[userDoc.id] = userData.displayName || userData.email?.split('@')[0]; 
                    } 
                }); 
            } catch (e) { console.log("Could not fetch user profiles, using saved names"); }
        } 
        
        return reviews.map(review => ({ 
            ...review, 
            userName: review.userName || userProfiles[review.userId] || 'Anonymous' 
        })); 
    }
function renderReviews(reviews) { const container = document.getElementById('reviews-list'); container.innerHTML = ''; if (reviews.length === 0) { container.innerHTML = '<p>No reviews yet for this product. Be the first to leave one!</p>'; return; } reviews.forEach(review => { const reviewDate = review.createdAt?.toDate().toLocaleDateString() || 'N/A'; container.innerHTML += `<div class="review-card"><div class="review-header"><div class="review-author">${review.userName}</div><div class="stars">${generateStars(review.rating)}</div></div><h4 class="review-title">${review.title}</h4><p class="review-text">${review.text}</p><div class="review-date">${reviewDate}</div></div>`; }); }
async function renderReviewForm(user, product) { const container = document.getElementById('review-form-container'); if (user) { const q = query(collection(db, `products/${product.id}/reviews`), where("userId", "==", user.uid), limit(1)); const existingReviewSnap = await getDocs(q); if (!existingReviewSnap.empty) { container.innerHTML = '<h4>Your Review</h4><p>You have already submitted a review for this product.</p>'; } else { container.innerHTML = `<h4>Leave a Review</h4><form id="review-form"><div class="form-group"><label>Your Rating</label><div class="star-rating"><input type="radio" id="star5" name="rating" value="5" required><label for="star5" title="5 stars">&#9733;</label><input type="radio" id="star4" name="rating" value="4"><label for="star4" title="4 stars">&#9733;</label><input type="radio" id="star3" name="rating" value="3"><label for="star3" title="3 stars">&#9733;</label><input type="radio" id="star2" name="rating" value="2"><label for="star2" title="2 stars">&#9733;</label><input type="radio" id="star1" name="rating" value="1"><label for="star1" title="1 star">&#9733;</label></div></div><div class="form-group"><label for="review-title">Review Title</label><input type="text" id="review-title" required></div><div class="form-group"><label for="review-text">Your Review</label><textarea id="review-text" required></textarea></div><button type="submit" class="btn-submit-review">Submit Review</button></form>`; document.getElementById('review-form').addEventListener('submit', (e) => handleReviewSubmit(e, user, product)); } } else { container.innerHTML = `<div class="login-prompt"><p>You must be <a href="#" id="login-link-in-review">signed in</a> to leave a review.</p></div>`; document.getElementById('login-link-in-review').addEventListener('click', openLoginModal); } }
async function handleReviewSubmit(e, user, product) { 
        e.preventDefault(); 
        const form = e.target; 
        const rating = form.rating.value; 
        if (!rating) { alert('Please select a star rating.'); return; } 
        
        const safeUserName = user.displayName || user.email.split('@')[0] || 'Wine Lover';
        
        const reviewData = { 
            userId: user.uid, 
            userName: safeUserName,
            rating: Number(rating), 
            title: form['review-title'].value, 
            text: form['review-text'].value, 
            createdAt: serverTimestamp(), 
            productId: product.id, 
            productName: product.name 
        }; 
        
        try { 
            await addDoc(collection(db, `products/${product.id}/reviews`), reviewData); 
            const productRef = doc(db, "products", product.id); 
            await runTransaction(db, async (transaction) => { 
                const productDoc = await transaction.get(productRef); 
                if (!productDoc.exists()) throw "Product does not exist!"; 
                const oldReviewCount = productDoc.data().reviewCount || 0; 
                const oldRatingValue = productDoc.data().ratingValue || 0; 
                const newReviewCount = oldReviewCount + 1; 
                const newRatingValue = ((oldRatingValue * oldReviewCount) + Number(rating)) / newReviewCount; 
                transaction.update(productRef, { reviewCount: newReviewCount, ratingValue: parseFloat(newRatingValue.toFixed(1)) }); 
            }); 
            showToast('Thank you for your review!', 'success'); 
            const reviews = await fetchReviewsForProduct(product.id); 
            renderReviews(reviews); 
            await renderReviewForm(user, product); 
        } catch (error) { 
            console.error("Error submitting review: ", error); 
            showToast('Error submitting review. Please try again.', 'danger'); 
        } 
    }
async function fetchProductBySlug(slug) { const q = query(collection(db, "products"), where("slug", "==", slug), limit(1)); const querySnapshot = await getDocs(q); return querySnapshot.empty ? null : { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() }; }
async function fetchRelatedProducts(currentProduct) { if (!currentProduct || !currentProduct.category) return []; const q = query(collection(db, "products"), where("category", "==", currentProduct.category), where("isArchived", "==", false), limit(5)); const querySnapshot = await getDocs(q); const related = []; querySnapshot.forEach((doc) => { if (doc.id !== currentProduct.id) related.push({ id: doc.id, ...doc.data() }); }); return related.slice(0, 4); }
function renderProduct(product) { 
        // Hide Skeleton, Show Real Content with Animation
        document.getElementById('product-skeleton').style.display = 'none';
        initContentReveal();

        document.title = product.metaTitle || `${product.name} - VinoElite`; 
        document.querySelector('meta[name="description"]').content = product.metaDescription || product.description; 
        const breadcrumbContainer = document.getElementById('breadcrumb'); 
        const params = new URLSearchParams(); 
        let breadcrumbHTML = `<a href="/index.html">Home</a> / <a href="/catalog.html">Catalog</a>`; 
        
        // --- UPDATED BREADCRUMB LOGIC FOR PRETTY URLS ---
        if (product.category) { 
            const slug = generateSlug(product.category);
            breadcrumbHTML += ` / <a href="/${slug}">${product.category}</a>`; 
        } 
        
        if (product.country) { params.set('country', product.country); breadcrumbHTML += ` / <a href="/catalog.html?${params.toString()}">${product.country}</a>`; } 
        if (product.region) { params.set('region', product.region); breadcrumbHTML += ` / <a href="/catalog.html?${params.toString()}">${product.region}</a>`; } 
        if (product.appellation) { params.set('appellation', product.appellation); breadcrumbHTML += ` / <a href="/catalog.html?${params.toString()}">${product.appellation}</a>`; } 
        breadcrumbHTML += ` / <span>${product.name}</span>`; 
        breadcrumbContainer.innerHTML = breadcrumbHTML; 
        
        const mainGalleryContainer = document.getElementById('product-gallery-main'); 
        const thumbnailsContainer = document.getElementById('product-thumbnails'); 
        const imageUrls = (product.imageUrls && product.imageUrls.length > 0) ? product.imageUrls : [product.imageUrl]; 
        
        // Optimize Main Image Loading (Eager)
        mainGalleryContainer.innerHTML = imageUrls.map((url, i) => 
            `<div class="slideshow-item ${i===0?'active':''}">
                <img src="${url}" alt="${product.name} view ${i + 1}" loading="${i===0?'eager':'lazy'}" width="600" height="800" style="aspect-ratio: 3/4;">
             </div>`
        ).join('') + `<div class="image-badge" style="display: ${product.badge ? 'block' : 'none'}">${product.badge || ''}</div>` + `<button class="wishlist-toggle-btn" data-product-id="${product.id}" aria-label="Add to wishlist"><i class="far fa-heart"></i></button>`; 
        
        thumbnailsContainer.innerHTML = imageUrls.map(url => `<div class="thumbnail-item"><img src="${url}" alt="Thumbnail" loading="lazy"></div>`).join(''); 
        
        const subtitleEl = document.getElementById('product-subtitle'); 
        let fullSubtitle = [product.category, product.sweetness].filter(Boolean).join(' '); 
        const originInfo = [product.region, product.country].filter(Boolean).join(', '); 
        if (originInfo) fullSubtitle += (fullSubtitle ? ' from ' : '') + originInfo; 
        subtitleEl.textContent = fullSubtitle; 
        document.getElementById('product-title').textContent = product.name; 
        document.getElementById('product-description').textContent = product.description; 
        if (product.ratingValue && product.reviewCount) { document.getElementById('product-rating').innerHTML = `<div class="stars">${generateStars(product.ratingValue)}</div><span class="rating-value">${product.ratingValue}</span><span class="rating-count">(${product.reviewCount} reviews)</span>`; } 
        const detailsContainer = document.getElementById('product-details-list'); 
        detailsContainer.innerHTML = ''; 
        const detailsOrder = [ { key: 'country', label: 'Country', icon: 'fa-globe-americas' }, { key: 'region', label: 'Region', icon: 'fa-map-marker-alt' }, { key: 'appellation', label: 'Appellation', icon: 'fa-award' }, { key: 'brand', label: 'Producer', icon: 'fa-industry' }, { key: 'year', label: 'Year', icon: 'fa-calendar-alt' }, { key: 'grapeVarieties', label: 'Grapes', icon: 'fa-wine-glass' }, { key: 'sweetness', label: 'Sweetness', icon: 'fa-tint' }, { key: 'alcohol', label: 'Alcohol', icon: 'fa-percentage', suffix: '%' }, { key: 'volume', label: 'Volume', icon: 'fa-wine-bottle' } ]; 
        detailsOrder.forEach(detail => { if (product[detail.key]) { detailsContainer.innerHTML += `<div class="detail-item"><i class="fas ${detail.icon}"></i><span>${detail.label}: ${product[detail.key]}${detail.suffix || ''}</span></div>`; } }); 
        if (product.serving) { product.serving.split('\n').forEach(line => { if (line.trim() === '') return; const [key, ...value] = line.split(':'); let icon = 'fa-info-circle'; if (key.toLowerCase().includes('temp')) icon = 'fa-thermometer-half'; if (key.toLowerCase().includes('decan')) icon = 'fa-hourglass-half'; detailsContainer.innerHTML += `<div class="detail-item"><i class="fas ${icon}"></i><span>${key}: ${value.join(':')}</span></div>`; }); } 
        document.getElementById('product-pricing').innerHTML = `<div class="current-price">$${product.price.toFixed(2)}</div>` + (product.oldPrice ? `<span class="old-price">$${product.oldPrice.toFixed(2)}</span>` : ''); 
        const stockEl = document.getElementById('product-stock-status'); 
        const cartBtn = document.getElementById('add-to-cart-btn'); 
        stockEl.textContent = product.stockStatus || 'In Stock'; 
        stockEl.className = 'stock-status'; 
        if (product.stockStatus === 'Out of Stock') { stockEl.classList.add('out-of-stock'); cartBtn.disabled = true; cartBtn.classList.add('out-of-stock'); cartBtn.querySelector('span').innerHTML = 'Out of Stock'; } else { stockEl.classList.add(product.stockStatus === 'Low Stock' ? 'low-stock' : 'in-stock'); cartBtn.disabled = false; } 
        
        cartBtn.dataset.productId = product.id;
        
        const tastingNotesTab = document.getElementById('tasting-notes-tab'); if (product.tastingNotes) { const notesHTML = product.tastingNotes.split('\n').map(line => { const [key, ...value] = line.split(':'); return `<li><strong>${key}:</strong> ${value.join(':').trim()}</li>`; }).join(''); tastingNotesTab.innerHTML = `<h3>Tasting Notes</h3><ul class="tasting-notes-list">${notesHTML}</ul>`; } else { tastingNotesTab.innerHTML = '<h3>Tasting Notes</h3><p>No tasting notes available.</p>'; } const foodPairingTab = document.getElementById('food-pairing-tab'); if (product.foodPairing) { foodPairingTab.innerHTML = `<h3>Food Pairing</h3><p class="food-pairing-content">${product.foodPairing.replace(/\n/g, '<br>')}</p>`; } else { foodPairingTab.innerHTML = '<h3>Food Pairing</h3><p>No recommendations available.</p>'; } 
    }
function renderRelatedProducts(products) {
        const grid = document.getElementById('related-products-grid');
        grid.innerHTML = '';
        if (!products || products.length === 0) {
            grid.innerHTML = '<p>No similar products found.</p>';
            return;
        }
        products.forEach(prod => {
            const categorySlug = prod.category.toLowerCase().replace(/\s+/g, '-');
            const productUrl = `/${categorySlug}/${prod.slug}`;
            
            let subtitle = [prod.category, prod.sweetness].filter(Boolean).join(' ') + (prod.region ? ` from ${[prod.region, prod.country].filter(Boolean).join(', ')}` : '');
            const imageUrls = (prod.imageUrls && prod.imageUrls.length > 0) ? prod.imageUrls : [prod.imageUrl];
            const card = document.createElement('div');
            card.className = 'product-card animate-on-scroll';
            card.dataset.url = productUrl;
            
            const slidesHTML = imageUrls.map((url, i) => 
                `<div class="slideshow-item ${i===0?'active':''}">
                    <img src="${url}" alt="${prod.name} view ${i + 1}" loading="lazy" width="300" height="400" style="aspect-ratio: 3/4; object-fit: cover;">
                 </div>`
            ).join('');

            card.innerHTML = `
                <div class="slideshow-container">
                    ${slidesHTML}
                    ${prod.badge ? `<div class="product-badge">${prod.badge}</div>` : ''}
                    <button class="wishlist-toggle-btn" data-product-id="${prod.id}" aria-label="Add to wishlist"><i class="far fa-heart"></i></button>
                </div>
                <div class="product-info-card">
                    <div>
                        <div class="product-subtitle-card">${subtitle}</div>
                        <h3 class="product-name-card">${prod.name}</h3>
                        <p class="product-description-card">${prod.metaDescription || prod.description || ''}</p>
                    </div>
                    <div>
                        <div class="product-price-card">
                            <div class="price-card">$${prod.price.toFixed(2)}</div>
                            ${prod.oldPrice ? `<div class="old-price-card">$${prod.oldPrice.toFixed(2)}</div>` : ''}
                        </div>
                        <button class="add-to-cart-btn" data-product-id="${prod.id}">
                            <i class="fas fa-shopping-cart"></i> Add to Cart
                            <span class="cart-quantity-badge"></span>
                        </button>
                    </div>
                </div>`;
            grid.appendChild(card);
            
            updateProductCartStatus(prod.id);
        });
        document.querySelectorAll('#related-products-grid .slideshow-container').forEach(setupSlideshow);
    }
function setupProductSlideshow(mainContainer, thumbnailsContainer) { const slides = Array.from(mainContainer.querySelectorAll('.slideshow-item')); const thumbnails = Array.from(thumbnailsContainer.querySelectorAll('.thumbnail-item')); if (slides.length <= 1) { if (slides.length === 1) { slides[0].classList.add('active'); if (thumbnails.length === 1) thumbnails[0].classList.add('active'); } return; } if (mainContainer.querySelector('.slideshow-overlay')) return; const overlay = document.createElement('div'); overlay.className = 'slideshow-overlay'; mainContainer.appendChild(overlay); let currentIndex = 0, intervalId = null; function resetInterval() { clearInterval(intervalId); intervalId = setInterval(() => showSlide(currentIndex + 1, false), 5000); } function showSlide(index, isManualAction = false) { if (index === currentIndex && slides[index]?.classList.contains('active')) return; if (slides[currentIndex]) slides[currentIndex].classList.remove('active'); if (thumbnails[currentIndex]) thumbnails[currentIndex].classList.remove('active'); currentIndex = (index + slides.length) % slides.length; if (slides[currentIndex]) slides[currentIndex].classList.add('active'); if (thumbnails[currentIndex]) thumbnails[currentIndex].classList.add('active'); if (isManualAction) thumbnails[currentIndex].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }); } thumbnails.forEach((thumb, index) => { thumb.addEventListener('click', () => { if (index === currentIndex) return; showSlide(index, true); resetInterval(); }); }); let touchStartX = 0; overlay.addEventListener('mousedown', e => { touchStartX = e.clientX; overlay.style.cursor = 'grabbing'; clearInterval(intervalId); }); overlay.addEventListener('mouseup', e => { overlay.style.cursor = 'grab'; const touchEndX = e.clientX; if (touchEndX < touchStartX - 50) showSlide(currentIndex + 1, true); else if (touchEndX > touchStartX + 50) showSlide(currentIndex - 1, true); resetInterval(); }); overlay.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; clearInterval(intervalId); }, { passive: true }); overlay.addEventListener('touchend', e => { let touchEndX = e.changedTouches[0].clientX; if (touchEndX < touchStartX - 50) showSlide(currentIndex + 1, true); else if (touchEndX > touchStartX + 50) showSlide(currentIndex - 1, true); resetInterval(); }); showSlide(0, false); resetInterval(); }
function initScrollAnimations() {
        const detailObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animated');
                    const detailItems = entry.target.querySelectorAll('.detail-item');
                    detailItems.forEach((item, index) => {
                        setTimeout(() => { item.classList.add('visible'); }, index * 100);
                    });
                }
            });
        }, { threshold: 0.3 });

        const productDetails = document.querySelector('.product-details');
        if (productDetails) { detailObserver.observe(productDetails); }

        const cardObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) { entry.target.classList.add('animated'); }
            });
        }, { threshold: 0.1 });

        document.querySelectorAll('.product-card').forEach(card => { cardObserver.observe(card); });

        let lastScrollTop = 0;
        const breadcrumbSection = document.querySelector('.breadcrumb-section');
        
        window.addEventListener('scroll', () => {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            if (scrollTop > lastScrollTop && scrollTop > 200) { breadcrumbSection.classList.add('scrolled-up'); } 
            else if (scrollTop < lastScrollTop && scrollTop > 200) { breadcrumbSection.classList.add('scrolled-up'); } 
            else { breadcrumbSection.classList.remove('scrolled-up'); }
            lastScrollTop = scrollTop;
        });
    }
function initContentReveal() {
        const realContent = document.getElementById('real-product-container');
        if (realContent) {
            setTimeout(() => {
                realContent.style.opacity = '0';
                realContent.style.display = 'grid';
                requestAnimationFrame(() => {
                    realContent.style.transition = 'opacity 0.8s ease';
                    realContent.style.opacity = '1';
                });
            }, 300);
        }
    }

    // Re-render the review form whenever auth state changes (e.g. the user
    // signs in from the login modal while already on the product page).
    onAuthStateChanged(auth, async (user) => {
        const productSlug = getProductSlugFromUrl();
        if (!productSlug) return;
        const product = await fetchProductBySlug(productSlug);
        if (product) {
            await updateProductCartStatus(product.id);
            renderReviewForm(user, product);
        }
    });

    (async () => {
        initScrollAnimations();

        const productSlug = getProductSlugFromUrl();
        if (!productSlug) {
            document.querySelector('.product-section .container').innerHTML = '<h2>Product not found. Please check the URL.</h2>';
            return;
        }

        try {
            const product = await fetchProductBySlug(productSlug);
            if (!product) {
                document.querySelector('.product-section .container').innerHTML = `<h2>Product not found.</h2><p>We couldn't find a product with the slug "${productSlug}".</p>`;
                return;
            }

            const [relatedProducts, reviews] = await Promise.all([fetchRelatedProducts(product), fetchReviewsForProduct(product.id)]);
            renderProduct(product);
            setupProductSlideshow(document.getElementById('product-gallery-main'), document.getElementById('product-thumbnails'));
            renderRelatedProducts(relatedProducts);
            renderReviews(reviews);

            const quantityInput = document.querySelector('.quantity-input');
            document.querySelector('.quantity-btn.minus').addEventListener('click', () => { let val = parseInt(quantityInput.value); if (val > 1) quantityInput.value = val - 1; });
            document.querySelector('.quantity-btn.plus').addEventListener('click', () => { quantityInput.value = parseInt(quantityInput.value) + 1; });
            document.getElementById('add-to-cart-btn').addEventListener('click', (e) => { addToCart(product.id, parseInt(quantityInput.value), e.currentTarget); });
            document.querySelector('.product-gallery-main').addEventListener('click', (e) => { const wishlistBtn = e.target.closest('.wishlist-toggle-btn'); if (wishlistBtn) toggleWishlist(wishlistBtn.dataset.productId); });
            document.querySelector('.tabs-header').addEventListener('click', e => { const tabBtn = e.target.closest('.tab-btn'); if (tabBtn) { document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active')); tabBtn.classList.add('active'); document.getElementById(`${tabBtn.dataset.tab}-tab`).classList.add('active'); } });

            document.getElementById('related-products-grid').addEventListener('click', function(e) {
                const cartButton = e.target.closest('.add-to-cart-btn');
                const wishlistButton = e.target.closest('.wishlist-toggle-btn');
                if (cartButton) {
                    e.preventDefault(); e.stopPropagation();
                    addToCart(cartButton.dataset.productId, 1, cartButton);
                } else if (wishlistButton) {
                    e.preventDefault(); e.stopPropagation();
                    toggleWishlist(wishlistButton.dataset.productId);
                } else {
                    const card = e.target.closest('.product-card');
                    if (card && card.dataset.url) window.location.href = card.dataset.url;
                }
            });
        } catch (error) {
            console.error("Error loading product page:", error);
            document.querySelector('.product-section .container').innerHTML = '<h2>Error loading product details. Please try again.</h2>';
        }
    })();
}


/* ---------------------------------------------------------------------- */
/* Router — only the page's own init function ever runs.                  */
/* Each public template sets <body data-page="index|catalog|product">.    */
/* ---------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    initCommonUI();
    const page = document.body.dataset.page;
    if (page === 'index') initIndexPage();
    else if (page === 'catalog') initCatalogPage();
    else if (page === 'product') initProductPage();
});
