const AUTH_VIEWS = ['signInView', 'signUpView', 'forgotPasswordView'];
        function showAuthView(activeId) {
            AUTH_VIEWS.forEach((id) => {
                document.getElementById(id)?.classList.toggle('hidden', id !== activeId);
            });
        }

        function toggleAuthView() {
            const signInHidden = document.getElementById('signInView').classList.contains('hidden');
            showAuthView(signInHidden ? 'signInView' : 'signUpView');
        }

        function showForgotPassword(e) {
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
            showAuthView('forgotPasswordView');
        }