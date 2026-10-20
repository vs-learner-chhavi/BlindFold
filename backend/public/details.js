const id = (i) => document.getElementById(i);
const domain = new URLSearchParams(location.search).get('site') || 'Unknown site';
let problems = [];

id('domain-title').textContent = domain + ' report';
document.title = domain + ' – Accessibility details';

// Load saved token into input and sync automatically
id('token').value = sessionStorage.getItem('adminToken') || '';
id('token').addEventListener('input', () => {
  sessionStorage.setItem('adminToken', id('token').value.trim());
});
id('save-token').onclick = () => {
  sessionStorage.setItem('adminToken', id('token').value.trim());
  toast('Token saved for this tab');
};

const SAMPLE = [
  { barrier_title: 'Images missing alt text', severity: 'blocker', wcag_rules: ['1.1.1'], status: 'reported', users_affected: '21', fingerprint: 's1' },
  { barrier_title: 'Form fields have no labels', severity: 'major', wcag_rules: ['1.3.1', '3.3.2'], status: 'acknowledged', users_affected: '12', fingerprint: 's2' },
  { barrier_title: 'Low text contrast on buttons', severity: 'minor', wcag_rules: ['1.4.3'], status: 'fixed', users_affected: '1 to 4 users', fingerprint: 's3' }
];

async function load() {
  try {
    const r = await fetch(`http://localhost:3000/api/details/${encodeURIComponent(domain)}`);
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.message || 'Failed to load');
    problems = j.data || [];
    id('banner').classList.remove('show');
    id('email-status').textContent = j.email_status || 'Pending automated dispatch';
  } catch (e) {
    problems = SAMPLE;
    id('email-status').textContent = 'Unavailable (sample data)';
    id('banner').textContent = 'Cannot reach the server at localhost:3000. Showing sample data.';
    id('banner').classList.add('show');
  }
  draw();
}

function draw() {
  const sev = ['blocker', 'major', 'minor'].map(s => ({
    name: s,
    value: problems.filter(p => (p.severity || 'minor').toLowerCase() === s).length,
    color: SEV[s]
  }));
  donut(id('chart-severity'), sev, 'Barriers by severity');
  bars(id('chart-status'), STAGES.map(s => ({
    name: s,
    value: problems.filter(p => p.status === s).length,
    color: STAGE_COL[s]
  })));

  id('barrier-list').innerHTML = problems.length ? problems.map(p => {
    const s = (p.severity || 'minor').toLowerCase();
    return `<tr>
      <td>${esc(p.barrier_title)}</td>
      <td><span class="sev ${esc(s)}">${{ blocker: '▲', major: '◆', minor: '●' }[s] || ''} ${esc(s)}</span></td>
      <td class="mono">${esc((p.wcag_rules || []).join(', ') || 'N/A')}</td>
      <td><select data-fp="${esc(p.fingerprint)}" aria-label="Status for ${esc(p.barrier_title)}">${STAGES.map(x => `<option value="${x}"${p.status === x ? ' selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select></td>
      <td class="mono">${esc(p.users_affected)}</td></tr>`;
  }).join('') : '<tr><td colspan="5">No barrier details found for this domain.</td></tr>';
}

id('barrier-list').addEventListener('change', async e => {
  const sel = e.target.closest('select[data-fp]');
  if (!sel) return;
  const fp = sel.dataset.fp;
  const newStatus = sel.value;
  const token = (id('token').value || sessionStorage.getItem('adminToken') || '').trim();
  sessionStorage.setItem('adminToken', token);

  sel.disabled = true;
  try {
    const r = await fetch(`http://localhost:3000/update-problem/${encodeURIComponent(fp)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify({ status: newStatus })
    });
    if (r.ok) {
      toast(`Status updated to "${newStatus}"`);
      await load();
    } else if (r.status === 403) {
      toast('Unauthorized: Enter valid ADMIN_TOKEN in top-right box.', true);
      await load();
    } else {
      toast('Update failed on server.', true);
      await load();
    }
  } catch (err) {
    toast('Server unreachable. Status not saved.', true);
    await load();
  } finally {
    sel.disabled = false;
  }
});

// Toggle the Markdown Report viewer
id('view-report-btn').onclick = async () => {
  const container = id('markdown-container');
  const btn = id('view-report-btn');
  
  if (container.style.display === 'block') {
    container.style.display = 'none';
    btn.textContent = 'View Raw Markdown';
    return;
  }
  
  btn.textContent = 'Loading...';
  try {
    const r = await fetch(`http://localhost:3000/api/report/${encodeURIComponent(domain)}`);
    const j = await r.json();
    if (j.success) {
      container.textContent = j.report;
      container.style.display = 'block';
      btn.textContent = 'Hide Report';
    } else {
      // Now it will show the ACTUAL error from the backend
      toast(j.error || 'Report not found.', true);
      btn.textContent = 'View Raw Markdown';
    }
  } catch (e) {
    toast('Failed to reach server.', true);
    btn.textContent = 'View Raw Markdown';
  }
};

// Trigger Tinyfish and Nodemailer
id('send-email-btn').onclick = async () => {
  const btn = id('send-email-btn');
  btn.textContent = 'Searching via Tinyfish...';
  btn.style.opacity = '0.7';
  btn.disabled = true;
  
  try {
    const r = await fetch(`http://localhost:3000/api/dispatch-email/${encodeURIComponent(domain)}`, { 
      method: 'POST' 
    });
    const j = await r.json();
    
    if (j.success) {
      toast(`Email dispatched to ${j.email}`);
      await load(); // Reloads dashboard metrics so "Email Status" updates instantly
    } else {
      // Now it will show the ACTUAL error from the Tinyfish/Nodemailer module
      toast(`Error: ${j.error || 'Dispatch failed'}`, true);
    }
  } catch (e) {
    toast('Server error during dispatch.', true);
  } finally {
    btn.textContent = 'Dispatch Email via Tinyfish';
    btn.style.opacity = '1';
    btn.disabled = false;
  }
};

load();