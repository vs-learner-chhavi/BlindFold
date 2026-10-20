const db = require('./db');

function safeName(raw) {
  const t = String(raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const head = t.replace(/\d.*$/, "").trim().slice(0, 40);
  return head || "(named control)";
}

const ROLE_MAP = { a: "link", input: "textbox", textarea: "textbox", select: "combobox", clickable: "button" };
const normRole = (r) => ROLE_MAP[r] || r;

const NONSEMANTIC = /^(div|span|li|td|img|svg|p)$/;
const reportRole = (n) =>
  NONSEMANTIC.test(n.role) && n.keyboardReachable === false ? "button" : normRole(n.role);

function safeGoal(r) {
  const kind = r.situation && r.situation.fieldKind;
  if (kind === "calendar" || kind === "date") return "choose a date";
  if (kind === "place") return "choose a place";
  if (kind === "search") return "search";
  return "complete a step on this page";
}

function toIncident(session) {
  const r = session.request;
  const f = r.focusedElement;

  const tree = (r.nearbyTree || [])
    .map((n) => ({
      id: n.id,
      role: reportRole(n),
      name: safeName(n.name) || "",
      readonly: !!(n.state && n.state.readonly),
      keyboard_operable: n.keyboardReachable !== false,
      contains_image: !!n.containsImage,
    }))
    .concat((r.headings || []).map((h) => ({
      id: h.id, role: "heading", name: h.name || "heading",
      readonly: false, keyboard_operable: true, contains_image: false,
    })));

  let stuck = f ? { id: f.id, role: normRole(f.role), name: safeName(f.name) || "" } : null;
  if (stuck && /^(dialog|main|form|region|div)$/.test(stuck.role)) {
    const bad = tree.find((n) => n.role !== "heading" && (!n.name || n.keyboard_operable === false || n.readonly));
    if (bad) stuck = { id: bad.id, role: bad.role, name: bad.name };
  }

  return {
    user_ref: r.userRef,
    page_url: r.pageUrl,
    page_title: r.pageTitle,
    user_goal: safeGoal(r),
    stuck_element: stuck,
    screen_reader_announcement: stuck
      ? "(estimated, not recorded from a screen reader) " + stuck.role + (stuck.name ? ", " + stuck.name : "")
      : "",
    accessibility_tree: tree,
    focus_history: r.focusHistory || [],
    visible_messages: [],
    announced_messages: [],
    rescue: {
      completed: !!session.completed,
      actions: (session.history || []).map((h) => h.description || h.label).filter(Boolean),
    },
  };
}

// Priority order for "Worst problem status" (lower index = less resolved / worse)
const STATUS_RANK = { reported: 1, acknowledged: 2, fixed: 3, verified: 4 };

async function getTrackerDashboardData() {
    const rawData = await db.getTracker();
    const websites = {};
    
    rawData.forEach(row => {
        const rowStatus = (row.status || 'reported').toLowerCase();
        if (!websites[row.domain]) {
            websites[row.domain] = {
                website_name: row.domain,
                severity_score: 0,
                max_severity: 'minor',
                users_affected: 0,
                problem_count: 0,
                worst_status_rank: 99,
                status: rowStatus,
                last_reported: row.last_reported_at
            };
        }
        
        const site = websites[row.domain];
        site.problem_count += 1;

        // Track maximum severity
        let score = 0;
        if (row.severity === 'blocker') score = 3;
        else if (row.severity === 'major') score = 2;
        else if (row.severity === 'minor') score = 1;
        
        if (score > site.severity_score) {
            site.severity_score = score;
            site.max_severity = row.severity;
        }

        // Track worst (least resolved) problem status across the site's problems
        const sRank = STATUS_RANK[rowStatus] || 1;
        if (sRank < site.worst_status_rank) {
            site.worst_status_rank = sRank;
            site.status = rowStatus;
        }
        
        // Ensure Math.max is applied here so users aren't incorrectly multiplied
        site.users_affected = Math.max(site.users_affected, parseInt(row.users || 0));
        
        // Track most recent report date
        if (new Date(row.last_reported_at) > new Date(site.last_reported)) {
            site.last_reported = row.last_reported_at;
        }
    });

    return Object.values(websites).map(site => {
        let displayUsers = site.users_affected;
        let finalUsersAffected = displayUsers < 5 ? "1 to 4 users" : displayUsers.toString();

        return {
            website_name: site.website_name,
            max_severity: site.max_severity,
            users_affected: finalUsersAffected,
            problem_count: site.problem_count,
            status: site.status,
            worst_status: site.status,
            last_reported: site.last_reported
        };
    });
}

async function getWebsiteDetails(domain) {
    const rawData = await db.getTracker();
    
    const cleanDomain = domain ? domain.replace(/^https?:\/\//, '').toLowerCase() : '';
    const siteData = rawData.filter(row => row.domain && row.domain.toLowerCase().includes(cleanDomain));
    
    let emailStatus = "Pending automated dispatch";
    try {
        const pool = db.pool || db;
        if (typeof pool.query === "function" && cleanDomain) {
            // Safely querying ONLY the JSON column to avoid crashing if contacted_at doesn't exist
            const res = await pool.query(
                "SELECT contact FROM websites WHERE LOWER(domain) LIKE $1 LIMIT 1",
                [`%${cleanDomain}%`]
            );
            if (res.rows && res.rows[0] && res.rows[0].contact) {
                const contactData = typeof res.rows[0].contact === 'string' ? JSON.parse(res.rows[0].contact) : res.rows[0].contact;
                const contactEmail = contactData?.bestContact?.value;
                if (contactEmail) {
                    emailStatus = `Dispatched to ${contactEmail} via Tinyfish`;
                }
            }
        }
    } catch (e) {
        console.error("Email status fetch error:", e);
    }

    const problems = siteData.map(row => {
        let displayUsers = parseInt(row.users || 0);
        let finalUsersAffected = displayUsers < 5 ? "1 to 4 users" : displayUsers.toString();

        return {
            fingerprint: row.fingerprint,
            barrier_title: row.title,
            severity: row.severity,
            wcag_rules: row.wcag || [],
            status: (row.status || 'reported').toLowerCase(),
            users_affected: finalUsersAffected,
            first_reported: row.first_reported_at
        };
    });

    return { problems, email_status: emailStatus };
}

module.exports = { toIncident, getTrackerDashboardData, getWebsiteDetails };