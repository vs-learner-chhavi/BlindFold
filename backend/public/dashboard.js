document.addEventListener('DOMContentLoaded', () => {
  // Fetch raw problems instead of aggregated sites so we can count charts properly
  const API = 'http://localhost:3000/tracker'; 
  const $ = id => document.getElementById(id);
  
  if ($('current-date'))$('current-date').textContent = new Date().toLocaleString();
  
  let allProblems = [];
  let websites = [];
  let sortKey = 'users', sortDir = -1;

  const day = n => new Date(Date.now() - n * 864e5).toISOString();
  
  // Sample fallback data mapped as raw problems
  const SAMPLE_PROBLEMS = [
    {domain: 'demo-sewa.vercel.app', severity: 'blocker', users: 17, status: 'reported', last_reported_at: day(1)},
    {domain: 'demo-sewa.vercel.app', severity: 'major', users: 17, status: 'reported', last_reported_at: day(1)},
    {domain: 'cleartrip.com', severity: 'blocker', users: 5, status: 'acknowledged', last_reported_at: day(2)},
    {domain: 'cleartrip.com', severity: 'minor', users: 5, status: 'fixed', last_reported_at: day(2)},
    {domain: 'confirmtkt.com', severity: 'major', users: 2, status: 'verified', last_reported_at: day(3)}
  ];

  const usersStr = u => u < 5 ? "1 to 4 users" : u.toString();

  async function load() {
    try {
      const res = await fetch(API);
      const j = await res.json();
      if (!res.ok) throw new Error('Server error');
      allProblems = j.problems || [];
      setMode(false);
    } catch (e) {
      console.error(e);
      allProblems = SAMPLE_PROBLEMS;
      setMode(true);
    }
    processData();
    metrics();
    charts();
    render();
  }

  // Aggregate raw problems into website summaries for the main table
  function processData() {
    const sitesMap = {};
    allProblems.forEach(p => {
      if (!sitesMap[p.domain]) {
        sitesMap[p.domain] = {
          website_name: p.domain,
          max_severity: 'minor',
          users_affected: 0,
          problem_count: 0,
          status: 'reported',
          last_reported: p.last_reported_at || p.first_reported_at || day(0)
        };
      }
      const s = sitesMap[p.domain];
      s.problem_count++;
      s.users_affected = Math.max(s.users_affected, parseInt(p.users || 0));
      
      const rank = { blocker: 3, major: 2, minor: 1 };
      if (rank[p.severity] > rank[s.max_severity]) s.max_severity = p.severity;
      
      const sRank = { reported: 1, acknowledged: 2, fixed: 3, verified: 4 };
      if ((sRank[p.status] || 1) < (sRank[s.status] || 1)) s.status = p.status;
      
      if (new Date(p.last_reported_at) > new Date(s.last_reported)) s.last_reported = p.last_reported_at;
    });
    websites = Object.values(sitesMap);
  }

  function setMode(sample) {
    if ($('mode-chip'))$('mode-chip').classList.toggle('sample', sample);
    if ($('mode-text'))$('mode-text').textContent = sample ? 'Sample data' : 'Live';
    const b = $('banner');
    if (b) {
      b.classList.toggle('show', sample);
      b.textContent = sample ? 'Cannot reach the server at localhost:3000. Showing sample data for now.' : '';
    }
  }

  function countUp(el, to, fmt = v => v) {
    if (!el) return;
    if (matchMedia('(prefers-reduced-motion:reduce)').matches) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    (function f(t) {
      const p = Math.min(1, (t - t0) / 900);
      el.textContent = fmt(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(f);
    })(t0);
  }

  function metrics() {
    const probs = allProblems.length;
    // Now accurately counts individual verified problems across all sites
    const fixed = allProblems.filter(p => ['fixed', 'verified'].includes(p.status)).length;
    const totalUsers = websites.reduce((a, r) => a + r.users_affected, 0);
    
    countUp($('metric-sites'), websites.length);
    countUp($('metric-problems'), probs);
    countUp($('metric-users'), totalUsers);
    countUp($('metric-fixed'), fixed, v => `${v} (${probs ? Math.round(fixed / probs * 100) : 0}%)`);
  }

  function charts() {
    if (!$('chart-severity')) return;
    
    // Charts now accurately plot individual problem severities
    const sev = ['blocker', 'major', 'minor'].map(s => ({
      name: s,
      value: allProblems.filter(p => p.severity === s).length,
      color: SEV[s]
    }));
    donut($('chart-severity'), sev, 'Barriers by severity');

    // Charts now accurately plot individual problem statuses
    bars($('chart-status'), STAGES.map(s => ({
      name: s,
      value: allProblems.filter(p => p.status === s).length,
      color: STAGE_COL[s]
    })));

    bars($('chart-users'), [...websites].sort((a, b) => b.users_affected - a.users_affected).slice(0, 5).map(r => ({
      name: r.website_name,
      value: r.users_affected,
      color: SEV[r.max_severity] || SEV.minor
    })));

    const by = {};
    
    // Pre-fill the last 4 days with 0 so the line ALWAYS draws
    for (let i = 4; i >= 0; i--) {
      const dateString = new Date(Date.now() - i * 864e5).toISOString().slice(5, 10);
      by[dateString] = 0;
    }
    
    websites.forEach(r => {
      if (!r.last_reported) return;
      try {
        const k = new Date(r.last_reported).toISOString().slice(5, 10);
        by[k] = (by[k] || 0) + 1;
      } catch(e) {}
    });

    line($('chart-timeline'), Object.keys(by).sort().map(k => ({ x: k, y: by[k] })), 'Number of websites reported per day');
  }

  function render() {
    if (!$('table-body')) return;
    const q = $('search-input') ?$('search-input').value.toLowerCase() : '';
    const sv = $('severity-filter') ?$('severity-filter').value : 'all';
    const rank = { blocker: 3, major: 2, minor: 1 };
    
    const rows = websites.filter(r => r.website_name.toLowerCase().includes(q) && (sv === 'all' || r.max_severity === sv))
      .sort((a, b) => {
        const v = r => sortKey === 'users' ? r.users_affected : sortKey === 'max_severity' ? rank[r.max_severity] || 0 : sortKey === 'last_reported' ? +new Date(r.last_reported) : r.website_name.toLowerCase();
        return (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * sortDir;
      });

    $('table-body').innerHTML = rows.length ? rows.map(r => `<tr>
      <td class="site">${esc(r.website_name)}</td>
      <td><span class="sev ${esc(r.max_severity)}">${{ blocker: '▲', major: '◆', minor: '●' }[r.max_severity] || ''} ${esc(r.max_severity)}</span></td>
      <td class="mono">${esc(usersStr(r.users_affected))}</td>
      <td><span class="st ${esc(r.status)}">${esc(r.status)}</span></td>
      <td class="mono">${new Date(r.last_reported).toLocaleDateString()}</td>
      <td><a class="btn" href="details.html?site=${encodeURIComponent(r.website_name)}" aria-label="View report for ${esc(r.website_name)}">View report</a></td></tr>`).join('')
      : '<tr><td colspan="6">No barriers match. Scan a page with the BlindFold extension or clear the filters.</td></tr>';
  }

  document.querySelectorAll('th button').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.sort;
    sortDir = sortKey === k ? -sortDir : -1;
    sortKey = k;
    document.querySelectorAll('th[aria-sort]').forEach(th => th.setAttribute('aria-sort', 'none'));
    b.parentElement.setAttribute('aria-sort', sortDir === 1 ? 'ascending' : 'descending');
    render();
  }));

  if ($('search-input'))$('search-input').addEventListener('input', render);
  if ($('severity-filter'))$('severity-filter').addEventListener('change', render);

  load();
});