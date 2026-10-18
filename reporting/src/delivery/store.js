/**
 * Simple storage for component 7, kept in one JSON file (data/delivery.json).
 * No database setup needed. Pass path = null to keep everything in memory (used by tests).
 *
 * Shape:
 *   issues:  { [fingerprint]: { domain, type, title, severity, pageUrl, barrier, firstSeen, lastSeen,
 *              status: 'open'|'reported'|'fixed', firstEmailedAt, usersAtFirstEmail, followups,
 *              lastFollowupAt, users: [userHash, ...] } }
 *   sites:   { [domain]: { isGovernment, contactValue, contactType, contactConfidence, lastEmailAt } }
 *   outbox:  [ { domain, kind, to, subject, body, fingerprints, createdAt, status } ]
 */

const fs = require('node:fs');
const path = require('node:path');

class Store {
  constructor(filePath = 'data/delivery.json') {
    this.filePath = filePath;
    this.data = { issues: {}, sites: {}, outbox: [] };
    if (filePath && fs.existsSync(filePath)) this.data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  save() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}

module.exports = { Store };
