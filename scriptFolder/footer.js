import { createScrollTrigger, fadeInUp, pulseGlow } from "./animations.js";
import "../styleFolder/site-footer.css";

class SpecialFooter extends HTMLElement {
    connectedCallback() {
        this.innerHTML = `
<div class="site-footer-wrap">
  <div class="footer-accent" aria-hidden="true">
    <span class="fa-1"></span><span class="fa-2"></span><span class="fa-3"></span>
  </div>
  <footer class="site-footer">
    <div class="footer-main">
      <p class="footer-eyebrow">/ Footer · 00</p>
      <h2 class="footer-headline">
        Build with us.<br>
        <span class="dim">Or sponsor what we build.</span>
      </h2>
      <span class="footer-cta-wrap"><a href="sponsors.html#contact" class="footer-cta">Get in touch <span class="arrow" aria-hidden="true">→</span></a></span>
    </div>
    <div class="footer-sitemap">
      <p class="footer-eyebrow">/ Sitemap</p>
      <nav class="footer-nav" aria-label="Footer">
        <a href="about.html">→ About</a>
        <a href="projects.html">→ Projects</a>
        <a href="events.html">→ Events</a>
        <a href="resources.html">→ Resources</a>
        <a href="sponsors.html">→ Sponsors</a>
      </nav>
    </div>
    <div class="footer-contact">
      <p class="footer-eyebrow">/ Contact</p>
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
</div>
        `;

        this.animate();
    }

    animate() {
        // Columns rise in one after another as the footer scrolls into view
        this.querySelectorAll(".footer-main, .footer-sitemap, .footer-contact").forEach((col, i) => {
            createScrollTrigger(col, fadeInUp, { delay: i * 0.1, animationOptions: { duration: 0.5 } });
        });
        createScrollTrigger(this.querySelector(".footer-cta-wrap"), pulseGlow, { delay: 0.6 });
    }
}

customElements.define('cs-footer', SpecialFooter);
