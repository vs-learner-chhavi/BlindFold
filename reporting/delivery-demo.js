/**
 * Simulates a month in a few seconds to show the delivery rules (component 7) working.
 * No internet, no API key and no real emails: emails are saved in output/outbox/.
 *
 *   node delivery-demo.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { generateReport, DeliveryService, Sender } = require('./index');

const START = new Date('2026-11-02T09:00:00Z');
const at = (days = 0, hours = 0) => new Date(START.getTime() + ((days * 24) + hours) * 3600 * 1000);

async function main() {
  const outbox = path.join(__dirname, 'output', 'outbox');
  fs.rmSync(outbox, { recursive: true, force: true });
  const svc = new DeliveryService({ storePath: null, sender: new Sender({ mode: 'dry_run', outboxDir: outbox }) });

  const railway = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample-data', 'sample-incident.json'), 'utf8'));
  const railwayReport = generateReport(railway);
  const railwayContacts = { isGovernment: false,
    bestContact: { type: 'email', value: 'accessibility@example-railways.in', confidence: 'high' } };

  const college = structuredClone(railway);
  college.page_url = 'https://www.example-college.ac.in/admissions/2026';
  college.stuck_element = null;
  college.accessibility_tree = [{ id: 'applyLink', role: 'link', name: '', contains_image: true }];
  college.visible_messages = [];
  const collegeReport = generateReport(college);
  const collegeContacts = { isGovernment: false,
    bestContact: { type: 'email', value: 'webmaster@example-college.ac.in', confidence: 'medium' } };

  let received = 0;
  const hit = (report, contacts, user, when) => { svc.ingest(report, user, contacts, when); received += 1; };
  const run = async (label, when) => {
    const results = await svc.run(when);
    const sent = results.map((r) => `${r.kind.toUpperCase()} email to ${r.domain} (${r.status})`);
    console.log(`${label.padEnd(44)} -> ${sent.length ? sent.join(', ') : 'no email (rules say wait)'}`);
    return results;
  };

  console.log('\nDAY 0');
  ['user-1', 'user-2', 'user-2', 'user-3', 'user-4', 'user-5']
    .forEach((u, h) => hit(railwayReport, railwayContacts, u, at(0, h * 2)));
  console.log("  6 'Help me here' presses on the railway calendar (user-2 pressed twice)");
  hit(collegeReport, collegeContacts, 'user-6', at(0, 3));
  console.log('  1 user hits smaller problems on the college site');
  await run('  Day 0, 9 pm: check', at(0, 12));

  console.log('\nDAY 1');
  const first = await run('  Day 1, 10 am: 24 hours since first blocker', at(1, 1));
  for (const r of first) {
    console.log(`    Users counted per problem: ${[...new Set(Object.values(r.userCounts))].join(', ')} (user-2 counted once)`);
  }

  console.log('\nDAY 3');
  ['user-7', 'user-8', 'user-9'].forEach((u) => hit(railwayReport, railwayContacts, u, at(3)));
  await run('  3 more users hit the same calendar', at(3, 1));

  console.log('\nDAY 8');
  await run('  Weekly check', at(8));

  console.log('\nDAY 15');
  await run('  14 days after the first railway email', at(15, 1));

  console.log('\nDAY 20');
  for (const b of railwayReport.barriers) svc.markFixed(b.fingerprint);
  console.log('  Verification System confirms the railway site fixed everything');
  await run('  Day 30 check', at(30));

  const emails = fs.readdirSync(outbox).length;
  console.log(`\nResult: ${received} reports from users -> ${emails} emails in total.`);
  console.log('Preview the emails in output/outbox/\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
