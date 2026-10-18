// Component 6 tests (TinyFish is replaced by a fake client, so no internet needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const { findContacts, extractEmails, emailsFromLinks, contactPagesFromLinks, scoreEmail, isGovernment } =
  require('../src/contactFinder');

test('extracts normal and obfuscated emails, skips noreply', () => {
  const text = 'Contact: webinfo[at]example[dot]gov[dot]in or help (at) example (dot) in. noreply@example.gov.in';
  assert.deepEqual(extractEmails(text), ['webinfo@example.gov.in', 'help@example.in']);
});

test('mailto links and contact pages', () => {
  const links = ['mailto:accessibility@site.in?subject=hi', 'https://site.in/contact-us',
    'https://other.com/contact', 'https://site.in/about'];
  assert.deepEqual(emailsFromLinks(links), ['accessibility@site.in']);
  assert.deepEqual(contactPagesFromLinks(links, 'site.in'), ['https://site.in/contact-us']);
});

test('ranks accessibility inboxes above generic and outside addresses', () => {
  const a11y = scoreEmail('accessibility@site.in', 'site.in', 'https://site.in/accessibility').score;
  const info = scoreEmail('info@site.in', 'site.in', 'https://site.in/').score;
  const other = scoreEmail('someone@gmail.com', 'site.in').score;
  assert.ok(a11y > info && info > other);
});

test('detects Indian government sites', () => {
  assert.ok(isGovernment('indianrail.gov.in') && isGovernment('example.nic.in'));
  assert.ok(!isGovernment('flipkart.com'));
});

class FakeClient {
  async search() {
    return [{ url: 'https://www.example.gov.in/accessibility-statement', title: 'Accessibility Statement' },
      { url: 'https://unrelated.com/page', title: 'Other' }];
  }

  async fetchPages(urls) {
    const pages = [
      { url: 'https://www.example.gov.in/', title: 'Home', text: 'Welcome', links: ['https://www.example.gov.in/feedback'] },
      { url: 'https://www.example.gov.in/accessibility-statement', title: 'Accessibility Statement',
        text: 'Report problems to webinfo[at]example[dot]gov[dot]in', links: [] },
    ];
    return { results: pages.filter((p) => urls.includes(p.url)), errors: [] };
  }
}

test('finds the best contact end to end', async () => {
  const r = await findContacts('https://www.example.gov.in/book?x=1', { client: new FakeClient() });
  assert.ok(r.isGovernment && r.officialChannels.length === 1);
  assert.equal(r.bestContact.value, 'webinfo@example.gov.in');
  assert.equal(r.bestContact.confidence, 'high');
  assert.ok(r.contactPages.includes('https://www.example.gov.in/feedback'));
  assert.ok(r.pagesChecked.every((p) => !p.includes('unrelated.com')));
});

test('official @nic.in addresses count for government sites', () => {
  const nic = scoreEmail('webguidelines@nic.in', 'india.gov.in');
  const outside = scoreEmail('someone@gmail.com', 'india.gov.in');
  assert.ok(nic.score > outside.score);
  assert.ok(nic.reason.includes('official government address'));
});