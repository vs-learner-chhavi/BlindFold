const { Pool } = require("pg");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const enabled = !!process.env.DATABASE_URL;
const pool = enabled
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    })
  : null;

// Users are only ever stored as a keyed hash, never as the raw ID.
function hashUser(ref) {
  const secret = process.env.USER_HASH_SECRET || "dev-only-change-me";
  return crypto.createHmac("sha256", secret).update(String(ref || "anonymous")).digest("hex");
}

async function init() {
  if (!enabled) { console.log("Database: off (no DATABASE_URL), running in memory only"); return; }
  await pool.query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  console.log("Database: connected, schema ready");
}

async function saveSession(id, host) {
  if (!enabled) return;
  await pool.query(
    "INSERT INTO sessions (id, host, status, expires_at) VALUES ($1,$2,'in_progress', now() + interval '24 hours') ON CONFLICT (id) DO NOTHING",
    [id, host || ""]
  );
}

async function finishSession(id, completed) {
  if (!enabled) return;
  await pool.query("UPDATE sessions SET status='finished', completed=$2 WHERE id=$1", [id, !!completed]);
}

async function saveReport(report, userRef) {
  if (!enabled) return null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const w = await client.query(
      `INSERT INTO websites (domain) VALUES ($1)
       ON CONFLICT (domain) DO UPDATE SET last_seen = now() RETURNING id`,
      [report.website.domain]
    );
    const websiteId = w.rows[0].id;

    await client.query(
      "INSERT INTO reports (id, website_id, verdict, rescued, report) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",
      [report.reportId, websiteId, report.verdict, !!(report.taskContext && report.taskContext.rescuedByBlindfold), JSON.stringify(report)]
    );

    let problems = 0;
    for (const b of report.barriers.filter((x) => x.verified)) {
      const el = b.element || {};
      const p = await client.query(
        `INSERT INTO problems (fingerprint, website_id, barrier_type, title, element_role, element_name, wcag, severity, fix)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (fingerprint) DO UPDATE SET
           last_reported_at = now(),
           severity = CASE WHEN EXCLUDED.severity = 'blocker' THEN 'blocker' ELSE problems.severity END
         RETURNING id, status, (xmax = 0) AS inserted`,   // xmax = 0 means a brand-new row
        [b.fingerprint, websiteId, b.type, b.title, el.role || null, el.name || null, b.wcag || [], b.severity, b.fix]
      );
      const row = p.rows[0];
      if (row.inserted) {
        await client.query("INSERT INTO status_history (problem_id, status, note) VALUES ($1,'reported','first report')", [row.id]);
      } else if (row.status === 'fixed' || row.status === 'verified') {
        // A fixed problem came back: treat it as new.
        await client.query("UPDATE problems SET status='reported' WHERE id=$1", [row.id]);
        await client.query("INSERT INTO status_history (problem_id, status, note) VALUES ($1,'reported','came back after being fixed')", [row.id]);
      }
      await client.query(
        "INSERT INTO problem_users (problem_id, user_hash) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [row.id, hashUser(userRef)]
      );
      problems++;
    }
    await client.query("COMMIT");
    return { problems };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function saveContact(domain, contact) {
  if (!enabled || !contact) return;
  await pool.query("UPDATE websites SET contact=$2 WHERE domain=$1", [domain, JSON.stringify(contact)]);
}

async function getTracker() {
  if (!enabled) return [];
  const r = await pool.query(
    `SELECT w.domain, p.fingerprint, p.title, p.severity, p.wcag, p.status,
            p.first_reported_at, p.last_reported_at,
            (SELECT count(*) FROM problem_users u WHERE u.problem_id = p.id)::int AS users
     FROM problems p JOIN websites w ON w.id = p.website_id
     ORDER BY users DESC, p.last_reported_at DESC`
  );
  return r.rows;
}

async function markFixed(fingerprint, status) {
  if (!enabled) return null;
  const r = await pool.query("UPDATE problems SET status=$2 WHERE fingerprint=$1 RETURNING id", [fingerprint, status]);
  if (!r.rows.length) return null;
  await pool.query("INSERT INTO status_history (problem_id, status, note) VALUES ($1,$2,'set by admin')", [r.rows[0].id, status]);
  return { fingerprint, status };
}

async function cleanup() {
  if (!enabled) return;
  await pool.query("DELETE FROM sessions WHERE expires_at < now()");
}

const monthKey = () => new Date().toISOString().slice(0, 7);

// Counts one rescue. Returns { allowed, used, limit }. If the database is off or fails, it allows the rescue.
async function useRescue(userRef, limit) {
  if (!enabled) return { allowed: true, used: 0, limit };
  try {
    const r = await pool.query(
      `INSERT INTO rescue_usage (user_hash, month, count) VALUES ($1,$2,1)
       ON CONFLICT (user_hash, month) DO UPDATE SET count = rescue_usage.count + 1
       WHERE rescue_usage.count < $3
       RETURNING count`,
      [hashUser(userRef), monthKey(), limit]
    );
    if (r.rows.length) return { allowed: true, used: r.rows[0].count, limit };
    return { allowed: false, used: limit, limit };
  } catch (e) {
    console.warn("usage count skipped:", e.message);
    return { allowed: true, used: 0, limit };
  }
}

async function usageSummary() {
  if (!enabled) return null;
  const r = await pool.query(
    "SELECT COALESCE(SUM(count),0)::int AS rescues, COUNT(*)::int AS users FROM rescue_usage WHERE month=$1",
    [monthKey()]
  );
  return r.rows[0];
}

module.exports = { init, saveSession, finishSession, saveReport, saveContact, getTracker, markFixed, cleanup, useRescue, usageSummary, enabled };