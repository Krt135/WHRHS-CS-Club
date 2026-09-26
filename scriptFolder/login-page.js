import { initUI } from "./ui-auth.js";
import { signUp, signIn, signInWithGoogle, initAuthRedirect } from "./auth.js";

initUI();
initAuthRedirect();

function showFeedback(id, message) {
  const feedback = document.getElementById(id);
  if (!feedback) return;

  feedback.textContent = message;
  feedback.hidden = false;
}

function authMessage(err) {
  if (err?.code === "membership/pending") return err.message;
  return `${err.code}: ${err.message}`;
}

// ---------- LOGIN ----------
document.getElementById("signInForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("signInEmail")?.value?.trim();
  const password = document.getElementById("signInPassword")?.value;

  if (!email || !password) {
    alert("Missing login fields");
    return;
  }

  try {
    await signIn(email, password);
  } catch (err) {
    showFeedback("signInFeedback", authMessage(err));
  }
});

// ---------- SIGNUP ----------
document.getElementById("signUpForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("signUpName")?.value?.trim();
  const email = document.getElementById("signUpEmail")?.value?.trim();
  const password = document.getElementById("signUpPassword")?.value;
  const confirm = document.getElementById("signUpConfirm")?.value;

  if (!name || !email || !password || !confirm) {
    alert("Missing signup fields");
    return;
  }

  if (password !== confirm) {
    alert("Passwords don't match");
    return;
  }

  try {
    await signUp(email, password, name);
    window.showAuthView("signInView");
    showFeedback("signInFeedback", "Your request to join has been submitted. You will be able to log in after an exec approves it.");
  } catch (err) {
    showFeedback("signUpFeedback", authMessage(err));
  }
});

// ---------- FORGOT PASSWORD ----------
const PASSWORD_RESET_URL = "https://us-central1-whrhs-cs-club.cloudfunctions.net/onPasswordReset";

document.getElementById("forgotPasswordForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("forgotPasswordEmail")?.value?.trim();
  const submitBtn = e.target.querySelector("button[type=submit]");
  if (!email) return;

  submitBtn.disabled = true;

  try {
    const res = await fetch(PASSWORD_RESET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    showFeedback("forgotPasswordFeedback", data.message || data.error || "Something went wrong. Try again later.");
  } catch (err) {
    showFeedback("forgotPasswordFeedback", "Couldn't reach the server. Check your connection and try again.");
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- GOOGLE ----------
document.getElementById("googleSignInBtn")?.addEventListener("click", async () => {
  try {
    await signInWithGoogle();
  } catch (err) {
    showFeedback("signInFeedback", authMessage(err));
  }
});
