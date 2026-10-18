// Component 5 tests. Run with: npm test (no internet or API key needed)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateReport, toMarkdown, detectBarriers, sanitizeUrl, scrubText } = require('../src/reportGenerator');

const SAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sample-data', 'sample-incident.json'), 'utf8'));
const types = (incident) => new Set(detectBarriers(incident).map((b) => b.type));

test('detects the expected barriers in the sample', () => {
  const found = types(SAMPLE);
  for (const t of ['unlabeled_field', 'unlabeled_button', 'image_link_no_text', 'mouse_only_widget',
    'unannounced_error', 'missing_headings']) assert.ok(found.has(t), t);
});

test('the element the user was stuck on becomes a blocker, listed first', () => {
  const report = generateReport(SAMPLE);
  assert.equal(report.verdict, 'blocked');
  const blockers = report.barriers.filter((b) => b.blockedTheUser);
  assert.ok(blockers.length > 0 && blockers.every((b) => b.severity === 'blocker'));
  assert.equal(report.barriers[0].severity, 'blocker');
});

test('removes personal data', () => {
  assert.equal(sanitizeUrl('https://a.in/book?mobile=9876543210#x'), 'https://a.in/book');
  const cleaned = scrubText('Call 98765 43210 or mail riya@gmail.com');
  assert.ok(!cleaned.includes('9876') && !cleaned.includes('riya@'));
  assert.ok(!JSON.stringify(generateReport(SAMPLE)).includes('9876543210'));
});

test('detects a focus trap', () => {
  const incident = { accessibility_tree: [{ id: 'h', role: 'heading', name: 'Login' }],
    focus_history: ['a', 'b', 'a', 'b', 'a', 'b'] };
  assert.ok(types(incident).has('focus_trap'));
});

test('CAPTCHA without audio is a barrier, with audio it is not', () => {
  const tree = [{ id: 'h', role: 'heading', name: 'Register' }, { id: 'cap', role: 'img', name: 'captcha image' }];
  assert.ok(types({ accessibility_tree: tree }).has('captcha_no_alternative'));
  tree.push({ id: 'aud', role: 'button', name: 'Play audio captcha' });
  assert.ok(!types({ accessibility_tree: tree }).has('captcha_no_alternative'));
});

test('an unexplained stuck point is flagged for manual review', () => {
  const report = generateReport({ page_url: 'https://x.in/p',
    accessibility_tree: [{ id: 'h', role: 'heading', name: 'Page' }, { id: 'ok', role: 'button', name: 'Next' }],
    stuck_element: { id: 'ok', role: 'button', name: 'Next' } });
  assert.equal(report.barriers[0].type, 'unverified_user_report');
  assert.equal(report.barriers[0].verified, false);
});

test('same element on different URLs is the same problem', () => {
  const fps = (url) => generateReport({ ...SAMPLE, page_url: url }).barriers.map((b) => b.fingerprint).sort();
  assert.deepEqual(fps('https://www.example-railways.in/train/12345'), fps('https://www.example-railways.in/train/67890'));
});

test('markdown output', () => {
  const md = toMarkdown(generateReport(SAMPLE));
  assert.ok(md.includes('this stopped the user') && md.includes('Suggested fix'));
});
