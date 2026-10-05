import {
  escapeHTML,
  formatCurrency,
  groupByTier,
  safeUrl,
  watchActiveSponsors,
  watchFundraising,
} from './sponsor-data.js';

document.addEventListener('DOMContentLoaded', () => {
  const amount = document.querySelector('#fundraising-amount');
  const goal = document.querySelector('#fundraising-goal');
  const progressBar = document.querySelector('#progress-bar');
  const progressFill = progressBar.querySelector('span');
  const progressLabel = document.querySelector('#progress-label');
  const statFundsRaised = document.querySelector('#stat-funds-raised');
  const board = document.querySelector('#sponsor-board');
  const tierSelect = document.querySelector('#tier-interest');
  const contactSection = document.querySelector('#contact');
  const form = document.querySelector('#sponsor-form');
  const status = document.querySelector('#form-status');

  const renderProgress = ({ goal: goalValue, raised, percent }) => {
    amount.textContent = formatCurrency(raised);
    goal.textContent = `/ ${formatCurrency(goalValue)} goal`;
    progressFill.style.width = `${Math.min(100, percent)}%`;
    progressBar.setAttribute('aria-valuemax', String(goalValue));
    progressBar.setAttribute('aria-valuenow', String(Math.min(raised, goalValue)));
    progressBar.setAttribute('aria-valuetext', `${formatCurrency(raised)} of ${formatCurrency(goalValue)} (${percent}%)`);
    progressBar.removeAttribute('aria-busy');
    progressLabel.textContent = `${percent}% to goal`;
    statFundsRaised.textContent = formatCurrency(raised);
  };

  watchFundraising(renderProgress, (error) => {
    console.error('Unable to load fundraising progress:', error);
    progressLabel.textContent = 'Progress unavailable right now';
  });

  const renderSponsorLink = (sponsor, className, inner) => {
    const href = safeUrl(sponsor.websiteUrl);
    return href
      ? `<a class="${className}" href="${escapeHTML(href)}" target="_blank" rel="sponsored noopener noreferrer">${inner}</a>`
      : `<span class="${className}">${inner}</span>`;
  };

  const renderLogoTile = (sponsor) => {
    const name = escapeHTML(sponsor.name);
    const logo = safeUrl(sponsor.logoUrl);
    const inner = logo
      ? `<img src="${escapeHTML(logo)}" alt="${name}" loading="lazy"><span class="board-logo-name" aria-hidden="true">${name}</span>`
      : `<span class="board-logo-text">${name}</span>`;
    return `<li>${renderSponsorLink(sponsor, 'board-logo', inner)}</li>`;
  };

  const renderNameChip = (sponsor) => `<li>${renderSponsorLink(sponsor, '', escapeHTML(sponsor.name))}</li>`;

  const renderTier = (tier) => {
    const count = tier.sponsors.length;
    let body;
    if (!count) {
      body = `
        <div class="board-empty">
          <code>ls sponsors/${tier.id} → 0 results</code>
          <button type="button" data-tier="${tier.label} — $${tier.price}">Be the first ${tier.label} sponsor →</button>
        </div>`;
    } else if (tier.showLogo) {
      body = `<ul class="board-logos">${tier.sponsors.map(renderLogoTile).join('')}</ul>`;
    } else {
      body = `<ul class="board-names">${tier.sponsors.map(renderNameChip).join('')}</ul>`;
    }

    return `
      <section class="board-tier" data-board-tier="${tier.id}" aria-label="${tier.label} sponsors">
        <div class="board-tier-head">
          <h3>${tier.label}</h3>
          <span class="board-tier-count">${String(count).padStart(2, '0')} sponsor${count === 1 ? '' : 's'}</span>
        </div>
        ${body}
      </section>`;
  };

  // A broken logo falls back to the sponsor's name. Error events don't bubble,
  // so listen in the capture phase.
  board.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const label = img.parentElement.querySelector('.board-logo-name');
    label?.classList.replace('board-logo-name', 'board-logo-text');
    label?.removeAttribute('aria-hidden');
    img.remove();
  }, true);

  watchActiveSponsors((sponsors) => {
    board.innerHTML = groupByTier(sponsors).map(renderTier).join('');
  }, (error) => {
    console.error('Unable to load the Sponsorship Board:', error);
    board.innerHTML = '<p class="board-status">Couldn’t load the board right now. Try refreshing.</p>';
  });

  // Delegated so the board's "Be the first…" buttons work too.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tier]');
    if (!button) return;
    tierSelect.value = button.dataset.tier;
    contactSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);

    // 1. Extract values from the form data
    const name = data.get('name').trim();
    const orgName = data.get('organization').trim() || 'Individual/No Org';
    const clientEmail = data.get('email').trim();
    const tier = data.get('tier');
    const message = data.get('message').trim();

    // 2. Format the subject and body exactly as requested
    const subject = `${orgName}: ${tier}`;
    const bodyContent = `${message}\n\nSincerely,\n${name}\n\n(Contact Email Provided: ${clientEmail})`;

    // 3. Set the destination email (using the one from your HTML)
    const targetEmail = 'cs.whrhs.club@gmail.com';

    // 4. Construct the Gmail deep-link URL
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1` +
      `&to=${encodeURIComponent(targetEmail)}` +
      `&su=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(bodyContent)}`;

    // 5. Update the UI and open Gmail in a new tab
    status.textContent = 'Opening Gmail in a new tab…';
    window.open(gmailUrl, '_blank');

    // Optional: Reset the form and clear the status text after 3 seconds
    setTimeout(() => {
      status.textContent = '';
      form.reset();
    }, 3000);
  });
  
});
