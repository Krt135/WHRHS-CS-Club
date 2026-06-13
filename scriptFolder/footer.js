class SpecialFooter extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
            <footer>
  <div class="footer-main">
    <p class="eyebrow">/ Footer · 00</p>
    <h2 class="footer-headline">
      Build with us.<br>
      <span class="dim">Or sponsor what we build.</span>
    </h2>
    <a href="index.html#sponsors" class="link-arrow" style="margin-top:32px">Get in touch <span class="arrow">→</span></a>
  </div>
  <div class="footer-sitemap">
    <p class="eyebrow">/ Sitemap</p>
    <nav class="footer-nav">
      <a href="index.html#about">→ About</a>
      <a href="index.html#projects">→ Projects</a>
      <a href="events.html">→ Events</a>
      <a href="index.html#resources">→ Resources</a>
      <a href="index.html#sponsors">→ Sponsors</a>
    </nav>
  </div>
  <div class="footer-contact">
    <p class="eyebrow">/ Contact</p>
    <ul class="footer-contact-list">
      <li>Watchung Hills Regional HS</li>
      <li>108 Stirling Rd, Warren NJ</li>
      <li>cs.club@whrhs.org</li>
      <li>github.com/whrhs-cs</li>
    </ul>
  </div>
</footer>
<div class="footer-bottom">
  <span>© 2026 WHRHS Computer Science Club</span>
  <span>Not Affiliated With WHRHS</span>
  <span>Built by members. For members.</span>
</div>
        
        `;
    }

}

customElements.define('cs-footer', SpecialFooter);
