/**
 * Blindfold component 7: Report Delivery.
 *
 * Rules (all adjustable in DEFAULT_POLICY):
 *  1. Same problem = same website + same type of problem + same element (exact URL ignored).
 *  2. Each user is counted once per problem, however many times they press "Help me here".
 *  3. One email per website, listing all its problems (most serious and most-reported first).
 *  4. Blockers: collect reports for 24 hours after the first one, then send.
 *     Smaller problems: wait for a weekly summary.
 *  5. At most one email per website per week. Exception: a NEW blocker may go out after 1 day.
 *  6. After the first email, more users only raise the count (public tracker).
 *     The website gets at most one follow-up, 14 days later, with the new total.
 *  7. Once the Verification System (component 9) confirms a fix, emails stop.
 */

const crypto = require('node:crypto');
const { Store } = require('./store');
const { Sender } = require('./sender');
const { composeEmail } = require('./composer');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const DEFAULT_POLICY = {
  blockerWait: 24 * HOUR,
  weeklyWait: 7 * DAY,
  minGap: 7 * DAY,
  blockerMinGap: 1 * DAY,
  followupAfter: 14 * DAY,
  maxFollowups: 1,
};

const SEVERITY_ORDER = { blocker: 0, major: 1, minor: 2 };
const ms = (iso) => (iso ? new Date(iso).getTime() : null);

/** Store only a hash of the anonymous install ID, never anything personal. */
const userHash = (userRef) => crypto.createHash('sha256').update(String(userRef)).digest('hex').slice(0, 16);

class DeliveryService {
  constructor({ storePath = 'data/delivery.json', policy = {}, sender, trackerUrl } = {}) {
    this.store = new Store(storePath);
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.sender = sender || new Sender();
    this.trackerUrl = trackerUrl;
  }

  get issues() { return this.store.data.issues; }
  get sites() { return this.store.data.sites; }

  // ---------------------------------------------------------- input from components 5 and 6

  ingest(report, userRef, contacts = null, now = new Date()) {
    const domain = report.website.domain;
    const uh = userHash(userRef);
    const t = now.toISOString();

    for (const b of report.barriers) {
      let issue = this.issues[b.fingerprint];
      if (!issue) {
        issue = this.issues[b.fingerprint] = {
          fingerprint: b.fingerprint, domain, type: b.type, title: b.title, severity: b.severity,
          pageUrl: report.website.pageUrl, barrier: b, firstSeen: t, lastSeen: t, status: 'open',
          firstEmailedAt: null, usersAtFirstEmail: null, followups: 0, lastFollowupAt: null, users: [],
        };
      } else {
        if (SEVERITY_ORDER[b.severity] < SEVERITY_ORDER[issue.severity]) issue.severity = b.severity;
        issue.barrier = { ...b, severity: issue.severity };
        issue.lastSeen = t;
        if (issue.status === 'fixed') { // it came back after being fixed: start again
          Object.assign(issue, { status: 'open', firstEmailedAt: null, usersAtFirstEmail: null, followups: 0 });
        }
      }
      if (!issue.users.includes(uh)) issue.users.push(uh);
    }

    const site = this.sites[domain] || (this.sites[domain] = { isGovernment: false, contactValue: null, lastEmailAt: null });
    if (contacts) {
      const best = contacts.bestContact || {};
      site.isGovernment = Boolean(contacts.isGovernment);
      site.contactValue = best.value || site.contactValue;
      site.contactType = best.type || site.contactType;
      site.contactConfidence = best.confidence || site.contactConfidence;
    }
    this.store.save();
  }

  userCount(fingerprint) {
    return (this.issues[fingerprint]?.users || []).length;
  }

  // ---------------------------------------------------------- deciding what to send

  plan(now = new Date()) {
    const p = this.policy;
    const t = now.getTime();
    const plans = [];

    for (const [domain, site] of Object.entries(this.sites)) {
      const issues = Object.values(this.issues).filter((i) => i.domain === domain && i.status !== 'fixed');
      const fresh = issues.filter((i) => i.status === 'open');
      const followups = issues.filter((i) => i.status === 'reported' && i.followups < p.maxFollowups
        && t - ms(i.firstEmailedAt) >= p.followupAfter);
      const blockersDue = fresh.filter((i) => i.severity === 'blocker' && t - ms(i.firstSeen) >= p.blockerWait);
      const othersDue = fresh.filter((i) => i.severity !== 'blocker' && t - ms(i.firstSeen) >= p.weeklyWait);

      const sinceLast = site.lastEmailAt ? t - ms(site.lastEmailAt) : null;
      let kind = null;
      if (blockersDue.length && (sinceLast === null || sinceLast >= p.blockerMinGap)) kind = 'first';
      else if ((othersDue.length || followups.length) && (sinceLast === null || sinceLast >= p.minGap)) {
        kind = othersDue.length ? 'weekly' : 'followup';
      }
      if (!kind) continue;

      plans.push({
        domain, kind, to: site.contactValue, isGovernment: site.isGovernment,
        newIssues: kind === 'first' ? fresh : othersDue,
        followupIssues: followups,
      });
    }
    return plans;
  }

  /** Send (or preview) every email that is due. Returns what happened. */
  async run(now = new Date()) {
    const results = [];
    for (const plan of this.plan(now)) {
      if (!plan.to) { results.push({ ...plan, status: 'waiting_for_contact' }); continue; }

      const all = [...plan.newIssues, ...plan.followupIssues];
      const userCounts = Object.fromEntries(all.map((i) => [i.fingerprint, this.userCount(i.fingerprint)]));
      const { subject, body } = composeEmail(plan.domain, plan.kind, plan.newIssues, plan.followupIssues,
        userCounts, this.trackerUrl);
      const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
      const status = await this.sender.send(plan.to, subject, body, `${stamp}_${plan.domain}_${plan.kind}`);

      if (status !== 'blocked') {
        const t = now.toISOString();
        for (const i of plan.newIssues) Object.assign(this.issues[i.fingerprint],
          { status: 'reported', firstEmailedAt: t, usersAtFirstEmail: userCounts[i.fingerprint] });
        for (const i of plan.followupIssues) {
          this.issues[i.fingerprint].followups += 1;
          this.issues[i.fingerprint].lastFollowupAt = t;
        }
        this.sites[plan.domain].lastEmailAt = t;
      }
      this.store.data.outbox.push({ domain: plan.domain, kind: plan.kind, to: plan.to, subject, body,
        fingerprints: Object.keys(userCounts), createdAt: now.toISOString(), status });
      this.store.save();
      results.push({ ...plan, subject, status, userCounts });
    }
    return results;
  }

  // ---------------------------------------------------------- links to components 8 and 9

  /** Called by the Verification System (component 9) after a successful re-test. */
  markFixed(fingerprint) {
    if (this.issues[fingerprint]) {
      this.issues[fingerprint].status = 'fixed';
      this.store.save();
    }
  }

  /** Data for the Public Tracker Dashboard (component 8). */
  tracker() {
    const out = {};
    for (const i of Object.values(this.issues)) {
      (out[i.domain] = out[i.domain] || []).push({
        title: i.title, severity: i.severity, status: i.status, usersAffected: i.users.length,
        firstReported: i.firstSeen, emailed: i.firstEmailedAt,
      });
    }
    return out;
  }
}

module.exports = { DeliveryService, DEFAULT_POLICY };
