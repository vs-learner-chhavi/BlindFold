// Component 7 tests. No internet, no real emails.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateReport } = require('../src/reportGenerator');
const { DeliveryService } = require('../src/delivery/deliveryService');
const { Sender } = require('../src/delivery/sender');

const SAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sample-data', 'sample-incident.json'), 'utf8'));
const CONTACTS = { isGovernment: false, bestContact: { type: 'email', value: 'a11y@example-railways.in' } };
const T0 = new Date('2026-11-02T09:00:00Z');
const later = ({ days = 0, hours = 0 }) => new Date(T0.getTime() + (days * 24 + hours) * 3600 * 1000);

const service = () => new DeliveryService({
  storePath: null,
  sender: new Sender({ mode: 'dry_run', outboxDir: fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-')) }),
});

test('each user is counted once per problem', () => {
  const svc = service();
  const report = generateReport(SAMPLE);
  for (const u of ['u1', 'u1', 'u1', 'u2']) svc.ingest(report, u, CONTACTS, T0);
  assert.equal(svc.userCount(report.barriers[0].fingerprint), 2);
});

test('blockers wait 24 hours, then one email for the whole website', async () => {
  const svc = service();
  const report = generateReport(SAMPLE);
  for (const u of ['u1', 'u2', 'u3', 'u4', 'u5']) svc.ingest(report, u, CONTACTS, T0);
  assert.deepEqual(await svc.run(later({ hours: 10 })), []);
  const results = await svc.run(later({ hours: 25 }));
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'first');
  assert.deepEqual([...new Set(Object.values(results[0].userCounts))], [5]);
});

test('more users do not trigger new emails; exactly one follow-up', async () => {
  const svc = service();
  const report = generateReport(SAMPLE);
  svc.ingest(report, 'u1', CONTACTS, T0);
  await svc.run(later({ days: 1 }));
  svc.ingest(report, 'u2', CONTACTS, later({ days: 3 }));
  assert.deepEqual(await svc.run(later({ days: 4 })), []);
  const follow = await svc.run(later({ days: 16 }));
  assert.equal(follow.length, 1);
  assert.equal(follow[0].kind, 'followup');
  assert.deepEqual(await svc.run(later({ days: 40 })), []);
});

test('smaller problems wait for the weekly summary', async () => {
  const svc = service();
  const report = generateReport({ page_url: 'https://site.in/p',
    accessibility_tree: [{ id: 'x', role: 'img', name: 'logo' }] });
  svc.ingest(report, 'u1', { bestContact: { value: 'info@site.in' } }, T0);
  assert.deepEqual(await svc.run(later({ days: 3 })), []);
  assert.equal((await svc.run(later({ days: 7 })))[0].kind, 'weekly');
});

test('fixed issues stop emails', async () => {
  const svc = service();
  const report = generateReport(SAMPLE);
  svc.ingest(report, 'u1', CONTACTS, T0);
  await svc.run(later({ days: 1 }));
  for (const b of report.barriers) svc.markFixed(b.fingerprint);
  assert.deepEqual(await svc.run(later({ days: 30 })), []);
});

test('waits when no contact is known', async () => {
  const svc = service();
  svc.ingest(generateReport(SAMPLE), 'u1', null, T0);
  assert.equal((await svc.run(later({ days: 2 })))[0].status, 'waiting_for_contact');
});

test('smtp mode refuses recipients that are not allowed', async () => {
  process.env.ALLOWED_RECIPIENTS = 'me@gmail.com';
  assert.equal(await new Sender({ mode: 'smtp' }).send('someone@company.com', 's', 'b', 't'), 'blocked');
  delete process.env.ALLOWED_RECIPIENTS;
});

test('store survives a restart (saved to a file)', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'store-')), 'delivery.json');
  const report = generateReport(SAMPLE);
  new DeliveryService({ storePath: file }).ingest(report, 'u1', CONTACTS, T0);
  assert.equal(new DeliveryService({ storePath: file }).userCount(report.barriers[0].fingerprint), 1);
});
