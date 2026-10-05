// Shared sponsor + fundraising data for the Sponsors page, home page,
// arcade splash, and admin panel.
//
// Database layout (Realtime Database):
//   sponsors/{id}               name, tier, amount, active, logoUrl, logoPath,
//                               websiteUrl, createdAt, updatedAt
//   fundraising/hillshacks2027  goal, otherRaised, updatedAt
//
// "Raised" is never stored: it's the sum of active sponsors' amounts plus
// otherRaised (donations that aren't on the Sponsorship Board).
import { db } from './firebase.js';
import { equalTo, get, onValue, orderByChild, query, ref } from 'firebase/database';

export const FUNDRAISING_PATH = 'fundraising/hillshacks2027';
export const DEFAULT_GOAL = 1500;

// Highest first. showLogo tiers get a logo tile on the board; the rest are
// listed by name.
export const SPONSOR_TIERS = [
  { id: 'diamond', label: 'Diamond', price: 200, showLogo: true },
  { id: 'platinum', label: 'Platinum', price: 100, showLogo: true },
  { id: 'gold', label: 'Gold', price: 50, showLogo: false },
  { id: 'silver', label: 'Silver', price: 10, showLogo: false },
];

// The public may only read sponsors through this query (see database.rules.json).
const activeSponsorsQuery = () => query(ref(db, 'sponsors'), orderByChild('active'), equalTo(true));

export function formatCurrency(value) {
  return `$${Math.round(Number(value) || 0).toLocaleString()}`;
}

export function escapeHTML(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Only http(s) links ever reach an href/src.
export function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch {
    return '';
  }
}

export function snapshotToSponsors(snapshot) {
  const sponsors = [];
  snapshot.forEach((child) => {
    sponsors.push({ id: child.key, ...child.val() });
  });
  return sponsors;
}

// Biggest contribution first, then whoever signed on earliest.
export function sortSponsors(sponsors) {
  return [...sponsors].sort((a, b) =>
    (Number(b.amount) || 0) - (Number(a.amount) || 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

export function groupByTier(sponsors) {
  const sorted = sortSponsors(sponsors);
  return SPONSOR_TIERS.map((tier) => ({
    ...tier,
    sponsors: sorted.filter((sponsor) => sponsor.tier === tier.id),
  }));
}

export function computeProgress(sponsors, fundraising) {
  const goal = Number(fundraising?.goal) > 0 ? Number(fundraising.goal) : DEFAULT_GOAL;
  const otherRaised = Math.max(0, Number(fundraising?.otherRaised) || 0);
  const sponsorTotal = sponsors
    .filter((sponsor) => sponsor.active === true)
    .reduce((sum, sponsor) => sum + Math.max(0, Number(sponsor.amount) || 0), 0);
  const raised = sponsorTotal + otherRaised;
  return { goal, raised, sponsorTotal, otherRaised, percent: Math.round((raised / goal) * 100) };
}

export function watchActiveSponsors(onChange, onError = console.error) {
  return onValue(activeSponsorsQuery(), (snapshot) => onChange(snapshotToSponsors(snapshot)), onError);
}

export async function fetchActiveSponsors() {
  return snapshotToSponsors(await get(activeSponsorsQuery()));
}

// Calls onChange({ goal, raised, sponsorTotal, otherRaised, percent }) once
// both sources have loaded, and again whenever either changes.
export function watchFundraising(onChange, onError = console.error) {
  let sponsors = null;
  let fundraising;
  const render = () => {
    if (sponsors !== null && fundraising !== undefined) onChange(computeProgress(sponsors, fundraising));
  };

  const stopSponsors = watchActiveSponsors((list) => {
    sponsors = list;
    render();
  }, onError);
  const stopFundraising = onValue(ref(db, FUNDRAISING_PATH), (snapshot) => {
    fundraising = snapshot.val();
    render();
  }, onError);

  return () => {
    stopSponsors();
    stopFundraising();
  };
}
