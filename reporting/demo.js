/**
 * Run components 5 (Report Generator) and 6 (Contact Finder) together.
 *
 *   node demo.js --offline                     report only, no internet or API key needed
 *   node demo.js --url https://www.example.org also find real contacts with TinyFish
 */

const fs = require('node:fs');
const path = require('node:path');
const { generateReport, toMarkdown, findContacts, TinyFishError } = require('./index');

async function main() {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  const urlArg = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
  const incidentPath = args.includes('--incident') ? args[args.indexOf('--incident') + 1]
    : path.join(__dirname, 'sample-data', 'sample-incident.json');

  const incident = JSON.parse(fs.readFileSync(incidentPath, 'utf8'));
  const out = path.join(__dirname, 'output');
  fs.mkdirSync(out, { recursive: true });

  // Component 5
  const report = generateReport(incident);
  console.log(`\n[5] Report generated: ${report.verdict}, ${report.barriers.length} barrier(s)`);
  console.log(`    ${report.summary}`);

  // Component 6
  if (!offline) {
    const target = urlArg || incident.page_url;
    console.log(`\n[6] Finding contacts for ${target} with TinyFish ...`);
    try {
      const contacts = await findContacts(target);
      report.delivery = contacts;
      const best = contacts.bestContact;
      console.log(best ? `    Best contact: ${best.value} (${best.confidence})`
        : '    No contact found. See output/contacts.json for pages checked and errors.');
      fs.writeFileSync(path.join(out, 'contacts.json'), JSON.stringify(contacts, null, 2));
    } catch (e) {
      if (!(e instanceof TinyFishError)) throw e;
      console.log(`    Skipped: ${e.message}`);
    }
  }

  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, 'report.md'), toMarkdown(report));
  console.log(`\nSaved: output/report.json, output/report.md${offline ? '' : ', output/contacts.json'}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
