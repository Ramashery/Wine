// Shared Firebase initialization for all public-facing pages.
// Previously this config block was duplicated in every HTML file (index, catalog,
// product, cart, profile) - now it lives in one place.
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// NOTE: this is the public web API key. It is safe to expose in client-side code -
// it is not a secret. Access control must be enforced with Firestore Security Rules
// (see /firestore.rules in this project), not by hiding this key.
export const firebaseConfig = {
    apiKey: "AIzaSyBflzOWVf3HgDpdUhha3qvyeUJf7i6dOuk",
    authDomain: "wine-91d0e.firebaseapp.com",
    projectId: "wine-91d0e",
    storageBucket: "wine-91d0e.firebasestorage.app",
    messagingSenderId: "1021620433427",
    appId: "1:1021620433427:web:5439252fb350c4455a85e6",
    measurementId: "G-TRWHY3KXK1"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
