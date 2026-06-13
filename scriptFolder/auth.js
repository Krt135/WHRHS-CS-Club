const AUTH_VIEWS = ['signInView', 'signUpView', 'forgotPasswordView'];

// Expose to window so HTML onclick handlers can see them
window.showAuthView = function(activeId) {
    AUTH_VIEWS.forEach((id) => {
        document.getElementById(id)?.classList.toggle('hidden', id !== activeId);
    });
}

window.toggleAuthView = function() {
    const signInCard = document.getElementById('signInView');
    if (!signInCard) return;
    const signInHidden = signInCard.classList.contains('hidden');
    window.showAuthView(signInHidden ? 'signInView' : 'signUpView');
}

window.showForgotPassword = function(e) {
    if (e) e.preventDefault();
    const signInEmail = document.getElementById('signInEmail')?.value.trim();
    const forgotInput = document.getElementById('forgotPasswordEmail');
    if (signInEmail && forgotInput) forgotInput.value = signInEmail;
    
    const feedback = document.getElementById('forgotPasswordFeedback');
    if (feedback) {
        feedback.hidden = true;
        feedback.textContent = '';
        feedback.className = 'auth-feedback';
    }
    window.showAuthView('forgotPasswordView');
}