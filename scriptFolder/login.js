import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";

// Firebase Config
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "whrhs-cs-club.firebaseapp.com",
  databaseURL: "https://whrhs-cs-club-default-rtdb.firebaseio.com",
  projectId: "whrhs-cs-club",
  storageBucket: "whrhs-cs-club.firebasestorage.app",
  messagingSenderId: "110216471172",
  appId: "1:110216471172:web:53ed19da91c397420258d1"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);

// Grab your exact HTML form elements
const signInForm = document.getElementById("signInForm");
const emailInput = document.getElementById("signInEmail");
const passwordInput = document.getElementById("signInPassword");
const feedbackDiv = document.getElementById("signInFeedback");

// Redirect if already authenticated
onAuthStateChanged(auth, (user) => {
    if (user) {
        window.location.href = "account.html";
    }
});

// Handle authentication lifecycle through Form submission
if (signInForm) {
    signInForm.addEventListener("submit", async (e) => {
        e.preventDefault(); 

        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const submitBtn = signInForm.querySelector(".auth-submit-btn");

        // Reset feedback state
        if (feedbackDiv) {
            feedbackDiv.hidden = true;
            feedbackDiv.textContent = "";
        }

        if (!email || !password) {
            showError("Please enter both email and password.");
            return;
        }

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = 'Verifying...';
            }

            // Firebase authentication execution
            await signInWithEmailAndPassword(auth, email, password);
            window.location.href = "account.html";

        } catch (error) {
            console.error("Login Error:", error.code);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Sign in <span class="arrow">→</span>';
            }

            // Route dynamic error messages right into your template UI
            switch (error.code) {
                case "auth/invalid-email":
                    showError("The email format is invalid.");
                    break;
                case "auth/invalid-credential":
                    showError("Incorrect email or password.");
                    break;
                case "auth/user-not-found":
                    showError("No account found with this email.");
                    break;
                default:
                    showError("Authentication failed: " + error.message);
            }
        }
    });
}

// Utility function to print errors into your card's built-in feedback container
function showError(message) {
    if (feedbackDiv) {
        feedbackDiv.textContent = message;
        feedbackDiv.hidden = false;
    } else {
        alert(message);
    }
}