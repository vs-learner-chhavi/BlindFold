/**
 * Blindfold component 6: Contact Finder (TinyFish Search + Fetch).
 *
 * Input:  the URL of the page where the user got stuck.
 * Output: the best contacts to send the report to, ranked, with where each was found.
 *
 * 1. TinyFish Search looks for the site's accessibility statement, contact and feedback pages.
 * 2. TinyFish Fetch reads those pages (plus the homepage) and returns text and links.
 * 3. We extract emails (including "name[at]site[dot]gov[dot]in", common on Indian government
 *    sites) and contact/feedback page links, then rank them.
 * 4. For Indian government sites we add the official public grievance portal.
 *
 * This component only FINDS contacts. It never sends anything.
 */

const { TinyFishClient, TinyFishError } = require('./tinyfishClient');

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const AT_RE = /\s*[[({]\s*at\s*[\])}]\s*/gi;
const DOT_RE = /\s*[[({]\s*dot\s*[\])}]\s*/gi;

const EMAIL_KEYWORDS = [
  ['accessib', 50], ['a11y', 50], ['webmaster', 35], ['webinfo', 35], ['web-info', 35], ['webguidelines', 30],
  ['wim', 30], ['feedback', 30], ['grievance', 30], ['support', 25], ['help', 20],
  ['contact', 20], ['care', 15], ['info', 15],
];
const PAGE_KEYWORDS = ['accessib', 'contact', 'feedback', 'grievance', 'help', 'support',
  'web-information', 'webinformation'];
const BAD_EMAIL_PARTS = ['noreply', 'no-reply', 'donotreply', 'example.com', '.png', '.jpg', 'sentry'];

const GOV_SUFFIXES = ['.gov.in', '.nic.in'];
const GOV_GRIEVANCE_PORTAL = {
  name: 'CPGRAMS (Centralized Public Grievance Redress and Monitoring System)',
  url: 'https://pgportal.gov.in',
  howToUse: 'File a grievance with the department that runs the website; attach the Blindfold report.',
};

// ------------------------------------------------------------------ helpers (pure, easy to test)

const hostOf = (url) => {
  try { return new URL(url).host.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};
const sameSite = (url, domain) => {
  const h = hostOf(url);
  return h === domain || h.endsWith(`.${domain}`);
};
const isGovernment = (domain) => GOV_SUFFIXES.some((s) => domain.endsWith(s) || domain === s.slice(1));

/** Find normal emails and obfuscated ones like "webinfo[at]site[dot]gov[dot]in". */
function extractEmails(text) {
  if (!text) return [];
  const normalised = text.replace(AT_RE, '@').replace(DOT_RE, '.');
  const found = [];
  for (const raw of normalised.match(EMAIL_RE) || []) {
    const e = raw.replace(/^\.+|\.+$/g, '').toLowerCase();
    if (!BAD_EMAIL_PARTS.some((bad) => e.includes(bad)) && !found.includes(e)) found.push(e);
  }
  return found;
}

function emailsFromLinks(links = []) {
  return links.filter((l) => l.toLowerCase().startsWith('mailto:'))
    .flatMap((l) => extractEmails(l.slice(7).split('?')[0]));
}

function contactPagesFromLinks(links = [], domain) {
  const pages = [];
  for (const link of links) {
    if (!link.startsWith('http') || !sameSite(link, domain)) continue;
    const path = new URL(link).pathname.toLowerCase();
    if (PAGE_KEYWORDS.some((k) => path.includes(k)) && !pages.includes(link)) pages.push(link);
  }
  return pages;
}

/** Higher score = more likely the right inbox. Returns { score, reason }. */
function scoreEmail(email, domain, pageUrl = '', pageTitle = '') {
  const [local, emailDomain = ''] = email.split('@');
  let score = 10;
  const reasons = [];
  const hit = EMAIL_KEYWORDS.find(([word]) => local.includes(word));
  if (hit) { score += hit[1]; reasons.push(`address contains '${hit[0]}'`); }
  if (emailDomain === domain || emailDomain.endsWith(`.${domain}`) || domain.endsWith(`.${emailDomain}`)) {
    score += 15; reasons.push('same domain as the website');
  } else if (isGovernment(domain) && isGovernment(emailDomain)) {
    // Indian government sites are often run by NIC and list official @nic.in / @gov.in addresses.
    score += 10; reasons.push('official government address');
  } else {
    score -= 10;
  }
  const context = `${pageUrl} ${pageTitle}`.toLowerCase();
  if (context.includes('accessib')) { score += 20; reasons.push('found on the accessibility page'); }
  else if (['contact', 'feedback', 'grievance'].some((k) => context.includes(k))) {
    score += 10; reasons.push('found on a contact/feedback page');
  }
  return { score, reason: reasons.join('; ') || 'found on the website' };
}

const confidence = (score) => (score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low');

function pageScore(url, title = '') {
  const text = `${url} ${title}`.toLowerCase();
  if (text.includes('accessib')) return 3;
  if (['contact', 'feedback', 'grievance'].some((k) => text.includes(k))) return 2;
  return PAGE_KEYWORDS.some((k) => text.includes(k)) ? 1 : 0;
}

// ------------------------------------------------------------------ main entry point

async function findContacts(pageUrl, { client, maxPages = 8 } = {}) {
  const domain = hostOf(pageUrl);
  const homepage = `${new URL(pageUrl).protocol}//${new URL(pageUrl).host}/`;
  const gov = isGovernment(domain);
  const result = {
    domain,
    isGovernment: gov,
    bestContact: null,
    contacts: [],
    contactPages: [],
    officialChannels: gov ? [GOV_GRIEVANCE_PORTAL] : [],
    searchedQueries: [],
    pagesChecked: [],
    errors: [],
  };
  client = client || new TinyFishClient();

  // 1. Search for likely pages on the same site
  const queries = [`site:${domain} accessibility statement`, `site:${domain} contact us email`, `site:${domain} feedback`];
  if (gov) queries.push(`site:${domain} web information manager`);

  const candidates = new Map([[homepage, 0]]);
  for (const q of queries) {
    result.searchedQueries.push(q);
    try {
      for (const r of await client.search(q)) {
        if (r.url && sameSite(r.url, domain) && !candidates.has(r.url)) candidates.set(r.url, pageScore(r.url, r.title));
      }
    } catch (e) {
      result.errors.push(e.message);
    }
  }
  const ordered = [...candidates.keys()]
    .sort((a, b) => (a === homepage ? -1 : b === homepage ? 1 : candidates.get(b) - candidates.get(a)))
    .slice(0, maxPages);

  // 2. Fetch the pages
  let pages = [];
  try {
    const fetched = await client.fetchPages(ordered, { links: true });
    pages = fetched.results;
    result.errors.push(...fetched.errors.map((e) => `${e.url}: ${e.error}`));
  } catch (e) {
    if (!(e instanceof TinyFishError)) throw e;
    result.errors.push(e.message);
    return result;
  }

  // 3. Extract and rank contacts
  const contacts = new Map();
  const contactPages = [];
  for (const page of pages) {
    const url = page.final_url || page.url || '';
    const title = page.title || '';
    const links = page.links || [];
    const text = typeof page.text === 'string' ? page.text : '';
    result.pagesChecked.push(url);

    for (const email of [...extractEmails(text), ...emailsFromLinks(links)]) {
      const { score, reason } = scoreEmail(email, domain, url, title);
      if (!contacts.has(email) || score > contacts.get(email).score) {
        contacts.set(email, { type: 'email', value: email, score, confidence: confidence(score), reason, foundOn: url });
      }
    }
    for (const link of contactPagesFromLinks(links, domain)) if (!contactPages.includes(link)) contactPages.push(link);
    if (pageScore(url, title) >= 2 && !contactPages.includes(url)) contactPages.push(url);
  }

  result.contacts = [...contacts.values()].sort((a, b) => b.score - a.score).slice(0, 5);
  result.contactPages = contactPages.sort((a, b) => pageScore(b) - pageScore(a)).slice(0, 5);
  if (result.contacts.length) {
    result.bestContact = result.contacts[0];
  } else if (result.contactPages.length) {
    result.bestContact = { type: 'form_or_page', value: result.contactPages[0], confidence: 'medium',
      reason: 'no email found; use this contact/feedback page' };
  }
  return result;
}

module.exports = {
  findContacts, extractEmails, emailsFromLinks, contactPagesFromLinks, scoreEmail, isGovernment,
  GOV_GRIEVANCE_PORTAL,
};