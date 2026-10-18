# Blindfold reporting: components 5, 6 and 7

Part of **Blindfold: Rescue and Report** (Kritical Hacks 2026). Plain Node.js (18+), **no packages to install**.

| # | Component | File | What it does |
|---|-----------|------|--------------|
| 5 | Report Generator | `src/reportGenerator.js` | Turns a stuck user's snapshot into a clear, private report with WCAG 2.2 references and fixes |
| 6 | Contact Finder | `src/contactFinder.js` | Uses **TinyFish Search + Fetch** to find who to send it to (email, feedback page, or government grievance portal) |
| 7 | Report Delivery | `src/delivery/` | Groups reports from many users into **one email per website**, follows the sending rules, never spams |

## Try it

```bash
cd reporting
npm test                     # 21 tests, no internet needed
npm run demo:offline         # component 5: writes output/report.md and output/report.json
npm run demo:delivery        # component 7: simulates a month of sending rules in seconds
cp .env.example .env         # then paste your TinyFish key into .env
node demo.js --url https://www.example.org   # component 6 with real TinyFish
```

## Use it from the backend

```js
// backend/server.js
const express = require('express');
const reporting = require('../reporting');

const app = express();
app.use('/api/reporting', reporting.createRouter(express));
```

| Endpoint | Who calls it | What it does |
|----------|--------------|--------------|
| `POST /api/reporting/incident` | Snapshot System (2) / extension | Body = incident JSON. Generates the report, finds contacts (once per website), queues it for delivery. Returns `{ report, contacts }` |
| `GET /api/reporting/tracker` | Public Tracker (8) | Problems per website with status and number of users affected |
| `POST /api/reporting/run` | Anyone / timer | Checks the sending rules now (also runs automatically every hour) |
| `POST /api/reporting/fixed/:fingerprint` | Verification System (9) | Marks a problem fixed so emails stop |

Or call the functions directly: `generateReport(incident)`, `toMarkdown(report)`, `await findContacts(url)`,
`new DeliveryService().ingest(report, userRef, contacts)`, `await service.run()`.

## Input: the incident JSON (from component 2)

See `sample-data/sample-incident.json`.

- `user_ref`: random anonymous ID per installation (only used to count each user once; stored hashed)
- `page_url`, `page_title`, `user_goal`
- `stuck_element`: `{ id, role, name }` where the user got stuck
- `screen_reader_announcement`: what the screen reader said there
- `accessibility_tree`: list of `{ id, role, name, readonly?, keyboard_operable?, contains_image?, html? }`
- `focus_history`: element ids in the order Tab moved through them
- `visible_messages` / `announced_messages`: messages shown on screen vs. read aloud
- `rescue`: `{ completed, actions }` from the TinyFish agent (component 3)

## Sending rules (component 7)

1. **Same problem** = same website + same type of problem + same element. Exact URL ignored (`/train/123` = `/train/456`).
2. **Each user counts once** per problem.
3. **One email per website**, most serious and most-reported problems first.
4. **Blockers**: collect for 24 hours after the first report, then send. **Smaller problems**: weekly summary.
5. **At most one email per website per week**, except a new blocker may go out after 1 day.
6. **After the first email**, new users only raise the count (tracker). **One follow-up** after 14 days.
7. **Once a fix is verified**, emails stop.

Timings live in `DEFAULT_POLICY` in `src/delivery/deliveryService.js`.

**Safety:** by default nothing is sent; emails are saved in `output/outbox/`. Real sending needs
`DELIVERY_MODE=smtp` and only goes to `ALLOWED_RECIPIENTS`.

## Privacy

- URLs lose their query strings; emails and long numbers (phone, PNR, IDs) are removed from all text.
- Users are counted by a hashed anonymous ID only.
- Reports describe the website problem, never the user.
