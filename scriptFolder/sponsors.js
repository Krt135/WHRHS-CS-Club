document.addEventListener('DOMContentLoaded', () => {
  const tierSelect = document.querySelector('#tier-interest');
  const contactSection = document.querySelector('#contact');
  const form = document.querySelector('#sponsor-form');
  const status = document.querySelector('#form-status');

  document.querySelectorAll('[data-tier]').forEach((button) => {
    button.addEventListener('click', () => {
      tierSelect.value = button.dataset.tier;
      contactSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const subject = `HillsHacks sponsorship: ${data.get('tier')}`;
    const body = `Name: ${data.get('name')}\nOrganization: ${data.get('organization') || 'N/A'}\nEmail: ${data.get('email')}\nTier interest: ${data.get('tier')}\n\nMessage:\n${data.get('message')}`;
    status.textContent = 'Opening your email app…';
    window.location.href = `mailto:cs.club@whrhs.org?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });
});
