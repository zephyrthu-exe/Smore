import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAyakbw4yUO5p3dB1mWShCi5VRWi88YABg",
  authDomain: "smore-6464b.firebaseapp.com",
  projectId: "smore-6464b",
  storageBucket: "smore-6464b.firebasestorage.app",
  messagingSenderId: "520752853884",
  appId: "1:520752853884:web:50de936e9f43fca7d5eaf9",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
