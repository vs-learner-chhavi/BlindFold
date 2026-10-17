/**
 * Blindfold component 5: Report Generator.
 *
 * Input:  an "incident" object from the Snapshot System (component 2) after a blind user
 *         pressed "Help me here". See sample-data/sample-incident.json.
 * Output: a structured report for Report Delivery (component 7), plus an email-ready Markdown version.
 *
 * Steps: detect barriers -> mark the one that blocked the user -> remove personal data
 *        -> fingerprint each barrier (so repeats can be grouped) -> format.
 */

const crypto = require('node:crypto');
const { BARRIER_TYPES, SEVERITY_ORDER, INTERACTIVE_ROLES, FIELD_ROLES } = require('./barrierRules');

// ------------------------------------------------------------------ privacy

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LONG_NUMBER_RE = /\b\d[\d\s-]{8,}\d\b/g; // phone, PNR, Aadhaar-like numbers

/** Keep only scheme, host and path. Query strings often hold session IDs or personal data. */
function sanitizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '';
  }
}

/** Remove emails and long numbers (phone numbers, PNRs, ID numbers) from free text. */
function scrubText(text) {
  if (!text) return '';
  return String(text).replace(EMAIL_RE, '[removed email]').replace(LONG_NUMBER_RE, '[removed number]');
}

// ------------------------------------------------------------------ detection

const nameOf = (node) => (node.name || '').trim();

function makeBarrier(type, node, evidence) {
  const info = BARRIER_TYPES[type];
  return {
    type,
    title: info.title,
    element: node
      ? { id: node.id ?? null, role: node.role ?? null, name: nameOf(node), htmlHint: scrubText(node.html || '').slice(0, 200) }
      : null,
    evidence,
    whatUserHears: info.whatUserHears,
    whyItMatters: info.whyItMatters,
    wcag: info.wcag,
    fix: info.fix,
    severity: info.defaultSeverity,
    blockedTheUser: false,
    verified: type !== 'unverified_user_report',
  };
}

/** True if the last presses of Tab keep cycling through the same few elements. */
function detectFocusTrap(history = []) {
  if (history.length < 6) return false;
  for (let period = 1; period <= 3; period++) {
    const tail = history.slice(-period * 3);
    if (tail.length !== period * 3) continue;
    const unit = tail.slice(0, period);
    if (tail.every((id, i) => id === unit[i % period])) return true;
  }
  return false;
}

function detectBarriers(incident) {
  const tree = incident.accessibility_tree || [];
  const barriers = [];

  for (const node of tree) {
    const role = (node.role || '').toLowerCase();
    const name = nameOf(node);

    if (role === 'button' && !name) {
      barriers.push(makeBarrier('unlabeled_button', node, 'Button has an empty accessible name.'));
    } else if (FIELD_ROLES.has(role) && !name) {
      barriers.push(makeBarrier('unlabeled_field', node, `${role} has an empty accessible name.`));
    } else if (role === 'link' && !name) {
      const type = node.contains_image ? 'image_link_no_text' : 'unlabeled_link';
      barriers.push(makeBarrier(type, node, 'Link has an empty accessible name.'));
    }

    if (INTERACTIVE_ROLES.has(role) && node.keyboard_operable === false) {
      barriers.push(makeBarrier('mouse_only_widget', node, 'Snapshot marked this control as not operable by keyboard.'));
    }

    if (role === 'img' && `${name} ${node.html || ''}`.toLowerCase().includes('captcha')) {
      const hasAudio = tree.some((n) => nameOf(n).toLowerCase().includes('audio'));
      if (!hasAudio) {
        barriers.push(makeBarrier('captcha_no_alternative', node, 'CAPTCHA image found and no audio alternative on the page.'));
      }
    }
  }

  const focus = incident.focus_history || [];
  if (detectFocusTrap(focus)) {
    barriers.push(makeBarrier('focus_trap', null, `Tab key kept cycling through the same elements: ${focus.slice(-6).join(' -> ')}`));
  }

  const announced = (incident.announced_messages || []).join(' ').toLowerCase();
  for (const msg of incident.visible_messages || []) {
    if (!announced.includes(msg.toLowerCase())) {
      barriers.push(makeBarrier('unannounced_error', null, `Shown on screen but not announced: "${scrubText(msg)}"`));
    }
  }

  if (tree.length && !tree.some((n) => (n.role || '').toLowerCase() === 'heading')) {
    barriers.push(makeBarrier('missing_headings', null, 'No heading elements found on the page.'));
  }

  // Remove duplicates (same type on the same element)
  const seen = new Set();
  return barriers.filter((b) => {
    const key = `${b.type}|${b.element?.id ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Barriers on the element where the user got stuck become blockers.
 *  If no rule matched that element, add an "unverified" entry so a human checks it. */
function markBlocking(barriers, incident) {
  const stuck = incident.stuck_element || {};
  if (!stuck.id) return barriers;
  let matched = false;
  for (const b of barriers) {
    if (b.element && b.element.id === stuck.id) {
      b.blockedTheUser = true;
      b.severity = 'blocker';
      matched = true;
    }
  }
  if (!matched) {
    const b = makeBarrier('unverified_user_report', stuck,
      `User was stuck here. Screen reader said: "${scrubText(incident.screen_reader_announcement || '')}"`);
    b.blockedTheUser = true;
    barriers.push(b);
  }
  return barriers;
}

// ------------------------------------------------------------------ grouping

/** /train/12345/book -> /train/{id}/book, so pages that differ only by an ID count as one page. */
function normalizePath(path) {
  return (path || '/').replace(/\/(?:\d+|[0-9a-f-]{36}|[0-9a-f]{8,})(?=\/|$)/gi, '/{id}');
}

/** Same website + same type of problem + same element = same problem (exact URL ignored).
 *  Page-level problems (no element) fall back to the normalised path. */
function fingerprint(domain, path, barrier) {
  const el = barrier.element || {};
  const where = el.id ? `${el.role}#${el.id}` : normalizePath(path);
  return crypto.createHash('sha1').update(`${domain}|${barrier.type}|${where}`).digest('hex').slice(0, 12);
}

// ------------------------------------------------------------------ report

function generateReport(incident) {
  const pageUrl = sanitizeUrl(incident.page_url || '');
  let domain = '';
  let path = '/';
  if (pageUrl) {
    const u = new URL(pageUrl);
    domain = u.host.replace(/^www\./, '');
    path = u.pathname;
  }

  const barriers = markBlocking(detectBarriers(incident), incident);
  for (const b of barriers) b.fingerprint = fingerprint(domain, path, b);
  barriers.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || Number(b.blockedTheUser) - Number(a.blockedTheUser));

  const blocker = barriers.find((b) => b.blockedTheUser);
  let verdict;
  let summary;
  if (blocker) {
    verdict = 'blocked';
    summary = `A screen reader user could not complete their task on ${domain}. We found ${barriers.length} `
      + `accessibility barrier(s); the main one is: ${blocker.title.toLowerCase()}.`;
  } else if (barriers.length) {
    verdict = 'barriers_found';
    summary = `We found ${barriers.length} accessibility barrier(s) on ${domain}.`;
  } else {
    verdict = 'no_barriers_detected';
    summary = `No barriers were detected automatically on ${domain}.`;
  }

  return {
    reportId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    standard: 'WCAG 2.2',
    website: { domain, pageUrl, pageTitle: scrubText(incident.page_title || '') },
    taskContext: {
      userGoal: scrubText(incident.user_goal || ''),
      rescuedByBlindfold: Boolean(incident.rescue && incident.rescue.completed),
    },
    verdict,
    summary,
    barriers,
  };
}

/** Email-ready version of a single report for website teams. */
function toMarkdown(report) {
  const w = report.website;
  const lines = [
    `# Accessibility barrier report: ${w.domain}`,
    '',
    `**Page:** ${w.pageUrl}  `,
    `**Generated:** ${report.generatedAt}  `,
    `**Standard:** ${report.standard}`,
    '',
    '## Summary',
    report.summary,
    '',
  ];
  if (report.taskContext.userGoal) lines.push(`The user was trying to: *${report.taskContext.userGoal}*`, '');

  report.barriers.forEach((b, i) => {
    const flag = b.blockedTheUser ? ' (this stopped the user)' : '';
    lines.push(`## ${i + 1}. ${b.title} [${b.severity.toUpperCase()}]${flag}`);
    if (b.element) lines.push(`- **Element:** role \`${b.element.role}\`, id \`${b.element.id}\`, name "${b.element.name}"`);
    lines.push(
      `- **What a screen reader user hears:** ${b.whatUserHears}`,
      `- **Why it matters:** ${b.whyItMatters}`,
      `- **Evidence:** ${b.evidence}`,
    );
    if (b.wcag.length) lines.push(`- **WCAG:** ${b.wcag.join(', ')}`);
    lines.push(`- **Suggested fix:** ${b.fix}`);
    if (!b.verified) lines.push('- **Status:** needs manual review');
    lines.push('');
  });

  lines.push('---',
    'This report was generated by Blindfold after a real screen reader user got stuck on this page. '
    + 'It contains no personal information about the user.');
  return lines.join('\n');
}

module.exports = {
  generateReport, toMarkdown, detectBarriers, sanitizeUrl, scrubText, normalizePath, fingerprint,
};
