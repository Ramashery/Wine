
// 1. Импортируем функции, которые нам понадобятся из SDK Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// 2. Ваши ключи для подключения к проекту "Wine" на Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBflzOWVf3HgDpdUhha3qvyeUJf7i6dOuk",
  authDomain: "wine-91d0e.web.app",
  projectId: "wine-91d0e",
  storageBucket: "wine-91d0e.firebasestorage.app", 
  messagingSenderId: "1021620433427",
  appId: "1:1021620433427:web:5439252fb350c4455a85e6",
  measurementId: "G-TRWHY3KXK1"
};

// 3. Инициализируем приложение Firebase ОДИН РАЗ
const app = initializeApp(firebaseConfig);

// 4. Создаем и ЭКСПОРТИРУЕМ сервисы, чтобы их можно было использовать в других файлах
export const auth = getAuth(app);       // Сервис для аутентификации (входа пользователей)
export const db = getFirestore(app);    // Сервис для работы с базой данных Firestore
