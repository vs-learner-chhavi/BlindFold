/**
 * How emails leave the system.
 *
 * DELIVERY_MODE=dry_run (default): nothing is sent; each email is saved as a file in output/outbox/
 * DELIVERY_MODE=smtp: real sending (needs `npm install nodemailer`), but ONLY to addresses in
 *                     ALLOWED_RECIPIENTS unless ALLOW_REAL_RECIPIENTS=yes.
 *
 * This protects real companies from test emails during the hackathon.
 */

const fs = require('node:fs');
const path = require('node:path');

class Sender {
  constructor({ mode = process.env.DELIVERY_MODE || 'dry_run', outboxDir = 'output/outbox' } = {}) {
    this.mode = mode.toLowerCase();
    this.outboxDir = outboxDir;
    this.allowed = new Set((process.env.ALLOWED_RECIPIENTS || '')
      .split(',').map((a) => a.trim().toLowerCase()).filter(Boolean));
    this.allowReal = (process.env.ALLOW_REAL_RECIPIENTS || '').toLowerCase() === 'yes';
  }

  /** Returns 'previewed', 'sent' or 'blocked'. */
  async send(to, subject, body, tag) {
    if (this.mode !== 'smtp') {
      fs.mkdirSync(this.outboxDir, { recursive: true });
      const safe = tag.replace(/[^a-zA-Z0-9_.-]/g, '_');
      fs.writeFileSync(path.join(this.outboxDir, `${safe}.txt`), `To: ${to}\nSubject: ${subject}\n\n${body}\n`);
      return 'previewed';
    }

    if (!this.allowReal && !this.allowed.has(to.toLowerCase())) return 'blocked';

    // Loaded only when really sending, so nodemailer is optional for everyone else.
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
    await transport.sendMail({ from: process.env.FROM_EMAIL, to, subject, text: body });
    return 'sent';
  }
}

module.exports = { Sender };
