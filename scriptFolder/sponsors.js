import { auth, db } from './firebase.js';
import { onAuthStateChanged } from 'firebase/auth';
import { get, onValue, ref, set } from 'firebase/database';

const FUNDRAISING_GOAL = 1500;
const FUNDRAISING_PATH = 'siteSettings/fundraisingProgress';

document.addEventListener('DOMContentLoaded', () => {
  const amount = document.querySelector('#fundraising-amount');
  const progressBar = document.querySelector('#progress-bar');
  const progressFill = progressBar.querySelector('span');
  const progressLabel = document.querySelector('#progress-label');
  const execControl = document.querySelector('#exec-progress-control');
  const slider = document.querySelector('#fundraising-slider');
  const sliderOutput = document.querySelector('#fundraising-slider-output');
  const saveProgress = document.querySelector('#save-fundraising-progress');
  const saveStatus = document.querySelector('#fundraising-save-status');
  const tierSelect = document.querySelector('#tier-interest');
  const contactSection = document.querySelector('#contact');
  const form = document.querySelector('#sponsor-form');
  const status = document.querySelector('#form-status');

  const formatCurrency = (value) => `$${value.toLocaleString()}`;
  const renderProgress = (rawValue) => {
    const value = Math.max(0, Math.min(FUNDRAISING_GOAL, Number(rawValue) || 0));
    const percent = Math.round((value / FUNDRAISING_GOAL) * 100);
    amount.textContent = formatCurrency(value);
    progressFill.style.width = `${percent}%`;
    progressBar.setAttribute('aria-valuenow', String(value));
    progressLabel.textContent = `${percent}% to goal`;
    slider.value = String(value);
    sliderOutput.textContent = formatCurrency(value);
  };

  onValue(ref(db, FUNDRAISING_PATH), (snapshot) => {
    renderProgress(snapshot.exists() ? snapshot.val() : 605);
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      const userSnapshot = await get(ref(db, `users/${user.uid}`));
      const role = userSnapshot.val()?.role;
      if (role === 'exec' || role === 'admin') execControl.hidden = false;
    } catch (error) {
      console.error('Unable to check executive-board access:', error);
    }
  });

  slider.addEventListener('input', () => {
    sliderOutput.textContent = formatCurrency(Number(slider.value));
  });

  saveProgress.addEventListener('click', async () => {
    const value = Number(slider.value);
    saveProgress.disabled = true;
    saveStatus.textContent = 'Saving…';
    try {
      await set(ref(db, FUNDRAISING_PATH), value);
      saveStatus.textContent = 'Progress saved.';
    } catch (error) {
      console.error('Unable to save fundraising progress:', error);
      saveStatus.textContent = 'Could not save progress. Check Firebase permissions.';
    } finally {
      saveProgress.disabled = false;
    }
  });

  document.querySelectorAll('[data-tier]').forEach((button) => {
    button.addEventListener('click', () => {
      tierSelect.value = button.dataset.tier;
      contactSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
