class SpecialHeader extends HTMLElement {
    connectedCallback() {
        const active = this.getAttribute('active-page') || 'index';
        
        // Helper to check if a link should be marked active
        const isActive = (pageName) => active === pageName ? 'active' : '';

        this.innerHTML = `
            <div class="topbar">
                <span>WHRHS // Computer Science Club</span>
                <div class="topbar-center">
                    <span class="dot-live"></span>
                    <span>HillsHacks 2026 — March 21</span>
                </div>
                <span>v.2026.01 / Warren, NJ</span>
            </div>

            <header>
                <a href="index.html" class="nav-logo ${isActive('index')}">
                    <span class="nav-logo-icon">W/</span>
                    <span>WHRHS<span class="muted"> · CS Club</span></span>
                </a>
                <nav class="nav-links">
                    <a href="index.html#about" class="${isActive('about')}"><span class="num">01</span>About</a>
                    <a href="index.html#projects" class="${isActive('projects')}"><span class="num">02</span>Projects</a>
                    <a href="events.html" class="${isActive('events')}"><span class="num">03</span>Events</a>
                    <a href="index.html#resources" class="${isActive('resources')}"><span class="num">04</span>Resources</a>
                    <a href="index.html#sponsors" class="${isActive('sponsors')}"><span class="num">05</span>Sponsors</a>
                </nav>
                <div class="nav-right">
                    <a href="auth.html" class="btn-signin">Sign in →</a>
                </div>
                <button class="menu-btn" id="menu-btn" aria-label="Toggle navigation">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 5h16M4 12h16M4 19h16"/></svg>
                </button>
            </header>

            <nav class="mobile-nav" id="mobile-nav" aria-label="Mobile navigation">
                <a href="index.html#about" class="${isActive('about')}">01 About</a>
                <a href="index.html#projects" class="${isActive('projects')}">02 Projects</a>
                <a href="events.html" class="${isActive('events')}">03 Events</a>
                <a href="index.html#resources" class="${isActive('resources')}">04 Resources</a>
                <a href="index.html#sponsors" class="${isActive('sponsors')}">05 Sponsors</a>
                <a href="auth.html">Sign in →</a>
            </nav>
        `;
    }
}

customElements.define("cs-header", SpecialHeader);