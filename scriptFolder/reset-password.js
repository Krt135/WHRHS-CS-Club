import { verifyPasswordResetCode, confirmPasswordReset } from "firebase/auth";
import { auth } from "./firebase";

const subtitle = document.getElementById("resetSubtitle");
const form = document.getElementById("resetPasswordForm");
const feedback = document.getElementById("resetFeedback");
const submitBtn = document.getElementById("resetSubmitBtn");

const oobCode = new URLSearchParams(window.location.search).get("oobCode");

function showFeedback(message) {
  feedback.textContent = message;
  feedback.hidden = false;
}

function resetErrorMessage(err) {
  switch (err?.code) {
    case "auth/expired-action-code":
      return "This reset link has expired. Request a new one from the sign-in page.";
    case "auth/invalid-action-code":
      return "This reset link is invalid or has already been used. Request a new one from the sign-in page.";
    case "auth/weak-password":
      return "That password is too weak. Use at least 6 characters.";
    default:
      return "Something went wrong. Please try again.";
  }
}

async function init() {
  if (!oobCode) {
    subtitle.textContent = "This reset link is missing its code. Request a new one from the sign-in page.";
    return;
  }

  try {
    const email = await verifyPasswordResetCode(auth, oobCode);
    subtitle.textContent = `Resetting the password for ${email}.`;
    form.hidden = false;
  } catch (err) {
    subtitle.textContent = resetErrorMessage(err);
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const password = document.getElementById("newPassword").value;
  const confirm = document.getElementById("confirmNewPassword").value;

  if (password !== confirm) {
    showFeedback("Passwords don't match.");
    return;
  }

  submitBtn.disabled = true;

  try {
    await confirmPasswordReset(auth, oobCode, password);
    form.hidden = true;
    subtitle.textContent = "Password updated! Redirecting you to sign in...";
    setTimeout(() => { window.location.href = "login.html"; }, 2500);
  } catch (err) {
    showFeedback(resetErrorMessage(err));
    submitBtn.disabled = false;
  }
});

init();
