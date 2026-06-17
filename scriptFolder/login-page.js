import { initUI } from "./ui-auth.js";
import { signUp, signIn, signInWithGoogle, initAuthRedirect } from "./auth.js";

initUI();
initAuthRedirect();

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
    alert(err.code + ": " + err.message);
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
  } catch (err) {
    alert(err.code + ": " + err.message);
  }
});

// ---------- GOOGLE ----------
document.getElementById("googleSignUpBtn")?.addEventListener("click", async () => {
  try {
    await signInWithGoogle();
  } catch (err) {
    alert(err.code);
  }
});