// "Thanks to our sponsors" splash shown over the arcade viewport while a game
// boots. Diamond-tier perk. The game keeps loading underneath, so the splash
// never delays it, and if the sponsor fetch is slow, fails, or finds no
// Diamond sponsors, nothing is shown at all.
import { escapeHTML, fetchActiveSponsors, safeUrl, sortSponsors } from './sponsor-data.js';

const SPLASH_MS = 3000;
const FETCH_TIMEOUT_MS = 1500;
const EXIT_MS = 250;

const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

async function fetchDiamondSponsors() {
    const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`sponsor fetch took over ${FETCH_TIMEOUT_MS}ms`)), FETCH_TIMEOUT_MS);
    });
    const sponsors = await Promise.race([fetchActiveSponsors(), timeout]);
    return sortSponsors(sponsors.filter((sponsor) => sponsor.tier === 'diamond'));
}

function renderSponsor(sponsor, index) {
    const logo = safeUrl(sponsor.logoUrl);
    return `
        <li class="sponsor-splash-item" style="--i: ${index}">
            ${logo ? `<img src="${escapeHTML(logo)}" alt="">` : ''}
            <span>${escapeHTML(sponsor.name)}</span>
        </li>`;
}

// Resolves once the splash is gone (or was never shown). Abort `signal` to
// cancel it, e.g. when the game fails to load.
export async function showSponsorSplash(container, signal) {
    let sponsors;
    try {
        sponsors = await fetchDiamondSponsors();
    } catch (error) {
        console.warn('Skipping sponsor splash:', error);
        return;
    }
    if (!sponsors.length || signal?.aborted) return;

    const splash = document.createElement('section');
    splash.className = 'sponsor-splash';
    splash.setAttribute('aria-label', 'Thanks to our sponsors');
    splash.style.setProperty('--splash-ms', `${SPLASH_MS}ms`);
    splash.innerHTML = `
        <div class="sponsor-splash-inner">
            <p class="sponsor-splash-cmd" aria-hidden="true"><span class="sponsor-splash-prompt">$</span> <span class="sponsor-splash-typed">./credits --tier=diamond</span><span class="sponsor-splash-cursor"></span></p>
            <h2 class="sponsor-splash-title">Thanks to our sponsors</h2>
            <ul class="sponsor-splash-list">${sponsors.map(renderSponsor).join('')}</ul>
            <div class="sponsor-splash-foot">
                <div class="sponsor-splash-timer" aria-hidden="true"><span></span></div>
                <button type="button" class="sponsor-splash-skip">Skip <span aria-hidden="true">›</span></button>
            </div>
        </div>`;

    // A broken logo shouldn't leave an empty box; the name still shows.
    splash.querySelectorAll('img').forEach((img) => {
        img.addEventListener('error', () => img.remove(), { once: true });
    });

    const skipButton = splash.querySelector('.sponsor-splash-skip');

    return new Promise((resolve) => {
        let timer;

        const onKeydown = (event) => {
            if (event.key === 'Escape') dismiss();
        };

        function dismiss() {
            if (!splash.isConnected || splash.classList.contains('is-leaving')) return;
            clearTimeout(timer);
            document.removeEventListener('keydown', onKeydown);
            signal?.removeEventListener('abort', dismiss);

            // Keyboard users who hit Skip land on the game, not on <body>.
            const hadFocus = splash.contains(document.activeElement);
            const finish = () => {
                splash.remove();
                if (hadFocus) container.querySelector('iframe')?.focus();
                resolve();
            };

            if (prefersReducedMotion()) {
                finish();
            } else {
                splash.classList.add('is-leaving');
                setTimeout(finish, EXIT_MS);
            }
        }

        skipButton.addEventListener('click', dismiss);
        document.addEventListener('keydown', onKeydown);
        signal?.addEventListener('abort', dismiss);

        container.appendChild(splash);
        timer = setTimeout(dismiss, SPLASH_MS);
    });
}
