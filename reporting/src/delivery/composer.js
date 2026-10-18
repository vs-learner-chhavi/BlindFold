/** Writes one email per website, listing every problem we're reporting, most serious first. */

const SEVERITY_ORDER = { blocker: 0, major: 1, minor: 2 };

function issueBlock(n, issue, users, previously) {
  const b = issue.barrier;
  const el = b.element || {};
  const lines = [`${n}. ${b.title} [${b.severity.toUpperCase()}]`];
  let usersLine = `   Users affected: ${users}`;
  if (previously != null && users > previously) usersLine += ` (was ${previously} when we first reported it)`;
  lines.push(usersLine, `   Page: ${issue.pageUrl}`);
  if (el.id || el.role) lines.push(`   Element: ${el.role} with id "${el.id}"`);
  lines.push(
    `   What a screen reader user hears: ${b.whatUserHears}`,
    `   Why it matters: ${b.whyItMatters}`,
  );
  if (b.wcag && b.wcag.length) lines.push(`   WCAG 2.2: ${b.wcag.join(', ')}`);
  lines.push(`   Suggested fix: ${b.fix}`);
  return lines.join('\n');
}

/**
 * @param {string} domain
 * @param {'first'|'weekly'|'followup'} kind
 * @param {object[]} newIssues        issues not emailed before
 * @param {object[]} followupIssues   issues emailed before and still open
 * @param {Object<string, number>} userCounts  fingerprint -> number of different users
 */
function composeEmail(domain, kind, newIssues, followupIssues, userCounts, trackerUrl) {
  const sortKey = (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
    || (userCounts[b.fingerprint] || 0) - (userCounts[a.fingerprint] || 0);
  newIssues = [...newIssues].sort(sortKey);
  followupIssues = [...followupIssues].sort(sortKey);
  const totalUsers = Math.max(0, ...Object.values(userCounts));

  let subject;
  let intro;
  if (kind === 'followup') {
    subject = `Follow-up: ${followupIssues.length} accessibility issue(s) still affecting users on ${domain}`;
    intro = 'We wrote to you earlier about accessibility barriers on your website. '
      + 'They are still affecting screen reader users, and more people have run into them since.';
  } else {
    const blockers = newIssues.filter((i) => i.severity === 'blocker').length;
    subject = blockers
      ? `${blockers} accessibility barrier(s) are stopping blind users on ${domain}`
      : `Accessibility summary for ${domain}: ${newIssues.length} issue(s)`;
    intro = `Blind and low-vision people using screen readers got stuck on your website. Up to ${totalUsers} `
      + 'different user(s) hit the same problem. Each issue below comes from a real person who could not '
      + 'continue, and includes what they heard and a suggested fix.';
  }

  const parts = [`Hello ${domain} team,`, '', intro, ''];
  let n = 1;
  if (newIssues.length) {
    parts.push(followupIssues.length ? 'NEW ISSUES' : 'ISSUES');
    for (const i of newIssues) parts.push(issueBlock(n++, i, userCounts[i.fingerprint]), '');
  }
  if (followupIssues.length) {
    parts.push('STILL OPEN FROM OUR EARLIER EMAIL');
    for (const i of followupIssues) parts.push(issueBlock(n++, i, userCounts[i.fingerprint], i.usersAtFirstEmail), '');
  }
  parts.push(
    'These reports contain no personal information about the users.',
    "Please reply to this email when an issue is fixed, and we'll re-test the page and update its status.",
  );
  if (trackerUrl) parts.push(`Public status of these issues: ${trackerUrl}`);
  parts.push('', 'Blindfold: Rescue and Report');
  return { subject, body: parts.join('\n') };
}

module.exports = { composeEmail };
