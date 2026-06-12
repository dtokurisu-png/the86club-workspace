import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA8a3xETEZiimdSEZUctUWxNTzam_Lx5vw",
  authDomain: "the86club-workspace.firebaseapp.com",
  projectId: "the86club-workspace",
  storageBucket: "the86club-workspace.firebasestorage.app",
  messagingSenderId: "719700910835",
  appId: "1:719700910835:web:c571c5ac29b60e56fa4d86"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const WORKSPACE_ID = "the86club";
