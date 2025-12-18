
import admin from 'firebase-admin';
import fs from 'fs-extra';
import path from 'path';

// ===============================================================================================
// === 1. INITIALIZATION: CONNECT TO FIREBASE & PREPARE FILE SYSTEM ==============================
// ===============================================================================================

// IMPORTANT: Create this file in your Firebase project settings and place it in the root.
// Go to Project Settings > Service Accounts > Generate new private key.
const serviceAccount = await fs.readJson('./vino-elite-firebase-adminsdk-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://wine-91d0e.firebaseio.com`
});

const db = admin.firestore();
const outputDir = path.resolve(process.cwd(), 'dist');
const staticDir = path.resolve(process.cwd(), 'static'); // A folder for your CSS, JS, images

// Clean the output directory before generating new files
await fs.emptyDir(outputDir);
// Copy over static assets (like CSS, JS, images)
if (await fs.pathExists(staticDir)) {
  await fs.copy(staticDir, outputDir);
}
console.log('Build directory cleaned and static assets copied.');

// ===============================================================================================
// === 2. TEMPLATING ENGINE: A SIMPLE WAY TO BUILD HTML PAGES ====================================
// ===============================================================================================

// Load base HTML templates (header, footer, etc.)
const header = await fs.readFile('templates/header.html', 'utf-8');
const footer = await fs.readFile('templates/footer.html', 'utf-8');
const productCardTemplate = await fs.readFile('templates/product-card.html', 'utf-8');

/**
 * Replaces placeholders in a template with actual data.
 * e.g., turns {{product.name}} into "Château Margaux"
 * @param {string} template - The HTML template string.
 * @param {object} data - The object containing data to insert.
 * @returns {string} - The final HTML string.
 */
function compileTemplate(template, data) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    // Access nested properties like 'product.name'
    const keys = key.trim().split('.');
    let value = data;
    for (const k of keys) {
      value = value[k];
      if (value === undefined) return ''; // If key not found, return empty string
    }
    return value;
  });
}

/**
 * Builds a full HTML page from content and wraps it with the header and footer.
 * @param {string} pageTitle - The title for the <title> tag.
 * @param {string} content - The main HTML content for the page body.
 * @returns {string} - The complete HTML page.
 */
function buildPage(pageTitle, content) {
  const page = `
    ${compileTemplate(header, { title: pageTitle })}
    ${content}
    ${footer}
  `;
  return page;
}

// ===============================================================================================
// === 3. DATA FETCHING: GET ALL NECESSARY DATA FROM FIRESTORE ===================================
// ===============================================================================================

console.log('Fetching data from Firestore...');
const productsSnapshot = await db.collection('products').where('isArchived', '==', false).get();
const products = productsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

const categoriesSnapshot = await db.collection('categories').where('isArchived', '==', false).get();
const categories = categoriesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
console.log(`Fetched ${products.length} products and ${categories.length} categories.`);

// ===============================================================================================
// === 4. PAGE GENERATION: CREATE HTML FILES FOR EACH PAGE TYPE ==================================
// ===============================================================================================

// --- Generate the Main Catalog Page (index.html) ---
async function generateCatalogPage() {
  console.log('Generating main catalog page (index.html)...');
  let productCardsHtml = '';
  for (const product of products) {
    productCardsHtml += compileTemplate(productCardTemplate, { product });
  }

  const catalogContent = `
    <main class="container">
      <h1>Our Wines</h1>
      <div class="product-grid">
        ${productCardsHtml}
      </div>
    </main>
  `;

  const fullPage = buildPage('VinoElite - Wine Catalog', catalogContent);
  await fs.writeFile(path.join(outputDir, 'index.html'), fullPage);
  console.log('✓ index.html generated.');
}


// --- Generate Individual Product Pages ---
async function generateProductPages() {
  console.log('Generating product detail pages...');
  const productPageTemplate = await fs.readFile('templates/product-page.html', 'utf-8');
  let count = 0;

  for (const product of products) {
    const productContent = compileTemplate(productPageTemplate, { product });
    const fullPage = buildPage(product.name, productContent);
    const productDir = path.join(outputDir, 'products', product.slug);
    await fs.ensureDir(productDir);
    await fs.writeFile(path.join(productDir, 'index.html'), fullPage);
    count++;
  }
  console.log(`✓ ${count} product pages generated.`);
}

// --- Generate Category Pages ---
async function generateCategoryPages() {
  console.log('Generating category pages...');
  let count = 0;
  for (const category of categories) {
    const productsInCategory = products.filter(p => p.category === category.name);
    let productCardsHtml = '';
    for (const product of productsInCategory) {
      productCardsHtml += compileTemplate(productCardTemplate, { product });
    }

    const categoryContent = `
      <main class="container">
        <h1>${category.name}</h1>
        <div class="product-grid">
          ${productCardsHtml}
        </div>
      </main>
    `;

    const fullPage = buildPage(`${category.name} - VinoElite`, categoryContent);
    const categoryDir = path.join(outputDir, 'categories', category.slug);
    await fs.ensureDir(categoryDir);
    await fs.writeFile(path.join(categoryDir, 'index.html'), fullPage);
    count++;
  }
  console.log(`✓ ${count} category pages generated.`);
}

// ===============================================================================================
// === 5. EXECUTION: RUN ALL THE GENERATION FUNCTIONS ============================================
// ===============================================================================================

(async () => {
  try {
    await generateCatalogPage();
    await generateProductPages();
    await generateCategoryPages();
    console.log('\\n✨ Static site generation complete! ✨');
    console.log(`Output is in the '${path.basename(outputDir)}' directory.`);
  } catch (error) {
    console.error('❌ Error during static site generation:');
    console.error(error);
    process.exit(1);
  }
})();

