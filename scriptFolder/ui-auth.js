const VIEWS = ["signInView", "signUpView", "forgotPasswordView"];

export function showView(id) {
  VIEWS.forEach(v => {
    document.getElementById(v)?.classList.toggle("hidden", v !== id);
  });
}

export function initUI() {
  window.showAuthView = showView;

  window.toggleAuthView = () => {
    const signIn = document.getElementById("signInView");
    const isHidden = signIn.classList.contains("hidden");
    showView(isHidden ? "signInView" : "signUpView");
  };

  window.showForgotPassword = (e) => {
    e?.preventDefault();
    showView("forgotPasswordView");
  };
}