import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore, doc, setDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAt75RSvz-efmf9gvdB9zYJ7fv2N9F_XVA",
  authDomain: "sihalgotwin.firebaseapp.com",
  projectId: "sihalgotwin",
  storageBucket: "sihalgotwin.firebasestorage.app",
  messagingSenderId: "96684525644",
  appId: "1:96684525644:web:c557009a6ca0254dfa0ce9",
  measurementId: "G-6VC01HSV84"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { auth, db, onAuthStateChanged, googleProvider, signInWithPopup, signOut, doc, setDoc, collection, getDocs };