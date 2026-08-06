/* ── KONG CRM — portal.js ─── Athlete Portal Logic ──────
 * Uses portal-supabase.js for auth & data queries, and its
 * global `db` Supabase client instance.
 * ─────────────────────────────────────────────────────── */

'use strict';

const P_BELTS = [
  { name: 'White', color: '#d4d4d4' },
  { name: 'Blue', color: '#1d4ed8' },
  { name: 'Purple', color: '#7c3aed' },
  { name: 'Brown', color: '#92400e' },
  { name: 'Black', color: '#111111' },
];

const P_BELT_MAP = { white: 0, blue: 1, purple: 2, brown: 3, black: 4 };
const P_BELT_CLS = { white: 'bw', blue: 'bbl', purple: 'bp', brown: 'bbr', black: 'bk' };

const P_SKILLS = [
  'Pin Escapes', 'Defense → Offense', 'Pinning & Progression', 'Structured Variety',
  'Leg Locks', 'Wrestling Base', 'Conditioning', 'Competition IQ'
];

const P_AVATAR_COLORS = [
  '#B549B6', '#7c3aed', '#1d4ed8', '#047857',
  '#b45309', '#9f1239', '#0369a1', '#6d28d9'
];

function pEsc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function pCol(i) { return P_AVATAR_COLORS[i % P_AVATAR_COLORS.length]; }
function pInitials(a) { return ((a.first ? a.first[0] : '') + (a.last ? a.last[0] : '')).toUpperCase() || 'A'; }
function pBeltIdx(b) { return P_BELT_MAP[b] || 0; }
function pBeltCls(b) { return P_BELT_CLS[b] || 'bw'; }

function pFmtDate(d) {
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch (e) { return d; }
}

function pFmtShort(d) {
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch (e) { return d; }
}

function pTimeAtNLGA(sinceISO) {
  if (!sinceISO) return null;
  try {
    const start = new Date(sinceISO);
    const now = new Date();
    let years = now.getFullYear() - start.getFullYear();
    let months = now.getMonth() - start.getMonth();
    if (months < 0) { years--; months += 12; }
    const totalMonths = years * 12 + months;
    if (totalMonths < 1) {
      const days = Math.floor((now - start) / (1000 * 60 * 60 * 24));
      if (days < 7) return days + ' day' + (days !== 1 ? 's' : '');
      return Math.floor(days / 7) + ' wk' + (Math.floor(days / 7) !== 1 ? 's' : '');
    }
    if (years === 0) return months + ' mo';
    if (months === 0) return years + ' yr' + (years !== 1 ? 's' : '');
    return years + ' yr ' + months + ' mo';
  } catch (e) { return null; }
}

function computeMatchRecord(comps) {
  return (comps || []).reduce((acc, c) => {
    acc.wins += (c.matches_won ?? c.matchesWon ?? 0);
    acc.losses += (c.matches_lost ?? c.matchesLost ?? 0);
    return acc;
  }, { wins: 0, losses: 0 });
}

function pToast(msg) {
  const t = document.getElementById('portal-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function showPortalLogin() {
  document.getElementById('portal-login').style.display = 'flex';
  document.getElementById('portal-app').style.display = 'none';
  document.getElementById('portal-reset-screen').style.display = 'none';
}

function showPortalResetScreen() {
  document.getElementById('portal-login').style.display = 'none';
  document.getElementById('portal-app').style.display = 'none';
  document.getElementById('portal-reset-screen').style.display = 'flex';
}

function showPortalApp() {
  document.getElementById('portal-login').style.display = 'none';
  document.getElementById('portal-reset-screen').style.display = 'none';
  document.getElementById('portal-app').style.display = 'block';
  document.getElementById('portal-loading').style.display = 'block';
  document.getElementById('portal-error-state').style.display = 'none';
  document.getElementById('portal-content').style.display = 'none';
}

async function portalHandleLogin() {
  const email = document.getElementById('portal-email').value.trim();
  const password = document.getElementById('portal-password').value;
  const errEl = document.getElementById('portal-error');
  errEl.style.color = 'var(--red)';
  errEl.textContent = '';

  if (!email || !password) { errEl.textContent = 'Enter email and password.'; return; }

  const btn = document.getElementById('btn-portal-login');
  btn.textContent = 'Signing in…'; btn.disabled = true;

  const { error } = await portalSignIn(email, password);

  btn.textContent = 'Sign In'; btn.disabled = false;

  if (error) {
    errEl.textContent = error.message;
  }
}

async function portalHandleResetPassword() {
  const email = document.getElementById('portal-email').value.trim();
  const errEl = document.getElementById('portal-error');

  if (!email) {
    errEl.style.color = 'var(--red)';
    errEl.textContent = 'Enter your email first.';
    return;
  }

  const { error } = await portalSendPasswordReset(email);
  if (error) {
    errEl.style.color = 'var(--red)';
    errEl.textContent = error.message;
  } else {
    errEl.style.color = 'var(--green)';
    errEl.textContent = 'Password reset email sent!';
  }
}

async function portalHandleLogout() {
  await portalSignOut();
}

async function portalHandleSetPassword() {
  const pw1 = document.getElementById('portal-new-password').value;
  const pw2 = document.getElementById('portal-confirm-password').value;
  const errEl = document.getElementById('portal-reset-error');
  errEl.style.color = 'var(--red)';
  errEl.textContent = '';

  if (!pw1) { errEl.textContent = 'Enter a new password.'; return; }
  if (pw1.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; return; }
  if (pw1 !== pw2) { errEl.textContent = 'Passwords do not match.'; return; }

  const btn = document.getElementById('btn-portal-set-password');
  btn.textContent = 'Saving…'; btn.disabled = true;

  const { error } = await db.auth.updateUser({ password: pw1 });

  btn.textContent = 'Set Password & Continue'; btn.disabled = false;

  if (error) {
    errEl.textContent = error.message;
    return;
  }

  history.replaceState(null, '', window.location.pathname);
  await initPortal();
}

async function initPortal() {
  showPortalApp();

  try {
    const athleteId = await resolveMyAthleteId().catch(() => null);

    if (!athleteId) {
      const errEl = document.getElementById('portal-error');
      errEl.style.color = 'var(--red)';
      errEl.innerHTML =
        `This account doesn't have athlete portal access. ` +
        `<a href="/" style="color:var(--purple)">Go to the coach dashboard</a> ` +
        `or sign in with a different account.`;
      await portalSignOut();
      showPortalLogin();
      return;
    }

    const data = await loadPortalData(athleteId);

    if (!data || !data.athlete) {
      document.getElementById('portal-loading').style.display = 'none';
      document.getElementById('portal-error-state').style.display = 'block';
      return;
    }

    const record = computeMatchRecord(data.comps);

    renderPortalProfile(data.athlete, record);
    renderPortalBeltHistory(data.athlete);
    renderPortalAttendance(data.athlete, data.attendance || []);
    renderPortalSkills(data.athlete);
    renderPortalCompetition(data.comps || [], record);
    renderPortalMembership(data.athlete);

    document.getElementById('portal-loading').style.display = 'none';
    document.getElementById('portal-content').style.display = 'block';

  } catch (err) {
    console.error('Portal init error:', err);
    document.getElementById('portal-loading').style.display = 'none';
    document.getElementById('portal-error-state').style.display = 'block';
  }
}

function renderPortalProfile(a, record) {
  const avEl = document.getElementById('pp-avatar');
  if (a.photo_url) {
    avEl.style.background = 'transparent';
    avEl.innerHTML = `<img src="${a.photo_url}" alt="${pEsc(a.first)}">`;
  } else {
    avEl.style.background = pCol(0);
    avEl.textContent = pInitials(a);
  }

  document.getElementById('pp-name').textContent = a.first + ' ' + a.last;
  document.getElementById('pp-member-since').textContent = 'NLGA · Member since ' + (a.since || '—');
  document.getElementById('pp-bg').innerHTML = `<span class="tag tag-comp">${pEsc(a.bg || 'Athlete')}</span>`;

  const stTag = document.getElementById('pp-status-tag');
  stTag.innerHTML = a.status === 'active'
    ? '<span class="tag tag-act">Active</span>'
    : '<span class="tag tag-inact">Inactive</span>';

  const timeEl = document.getElementById('pp-time-nlga');
  const t = pTimeAtNLGA(a.since_iso || a.sinceISO);
  if (t) {
    timeEl.innerHTML = `⏱ Time at NLGA: <span>${t}</span>`;
    timeEl.style.display = 'flex';
  } else {
    timeEl.style.display = 'none';
  }

  const b = P_BELTS[pBeltIdx(a.belt)];
  document.getElementById('pp-belt-swatch').style.background = b.color;
  document.getElementById('pp-belt-title').textContent = b.name + ' Belt';
  document.getElementById('pp-belt-title').style.color = pBeltIdx(a.belt) === 0 ? '#555' : b.color;
  document.getElementById('pp-belt-since').textContent = 'Since ' + (a.history && a.history[0] ? a.history[0].date : '—');

  document.getElementById('pp-sessions').textContent = a.sessions || 0;
  document.getElementById('pp-wins').textContent = record.wins;
  document.getElementById('pp-losses').textContent = record.losses;
}

function renderPortalBeltHistory(a) {
  const el = document.getElementById('pp-timeline');
  el.innerHTML = '';
  if (!a.history || !a.history.length) {
    el.innerHTML = '<div class="empty-state">No belt history recorded.</div>';
    return;
  }
  a.history.forEach((item, idx) => {
    el.innerHTML += `<div class="ti">
      <div class="ti-dot${idx === 0 ? ' fill' : ''}"></div>
      <div class="ti-date">${pEsc(item.date)}</div>
      <div class="ti-label">${pEsc(item.label)}</div>
    </div>`;
  });
}

function renderPortalAttendance(a, attRows) {
  const hmEl = document.getElementById('pp-heatmap');
  const dateSet = new Set(
    attRows.map(s => s.session_date_raw || s.session_date)
  );

  let html = '';
  const now = new Date();
  for (let w = 12; w >= 0; w--) {
    for (let d = 6; d >= 0; d--) {
      const dt = new Date(now);
      dt.setDate(dt.getDate() - (w * 7 + d));
      const iso = dt.toISOString().split('T')[0];
      html += `<div class="hc ${dateSet.has(iso) ? 'h3' : 'h0'}" title="${pFmtShort(iso)}"></div>`;
    }
  }
  hmEl.innerHTML = html;
  document.getElementById('pp-hm-stat').textContent = (a.sessions || 0) + ' total sessions';
}

function renderPortalSkills(a) {
  const el = document.getElementById('pp-skills');
  el.innerHTML = '';

  const leftCol = document.createElement('div');
  const rightCol = document.createElement('div');

  P_SKILLS.forEach((s, idx) => {
    const val = a.skills ? a.skills[idx] : 65;
    const html = `<div class="sk-row">
      <div class="sk-lbl">${pEsc(s)}</div>
      <div class="sk-track"><div class="sk-fill" style="width:${val}%"></div></div>
      <div class="sk-val">${val}</div>
    </div>`;
    (idx < 4 ? leftCol : rightCol).innerHTML += html;
  });

  el.appendChild(leftCol);
  el.appendChild(rightCol);
}

function renderPortalCompetition(myComps, record) {
  const el = document.getElementById('pp-comp');
  const summEl = document.getElementById('pp-comp-summary');

  const golds = myComps.filter(c => c.place === '1').length;
  const silvers = myComps.filter(c => c.place === '2').length;

  let summParts = [];
  if (record.wins || record.losses) summParts.push(`<span class="green">${record.wins}W</span>-<span class="red">${record.losses}L</span>`);
  if (golds) summParts.push(`<span class="amber">${golds} Gold</span>`);
  if (silvers) summParts.push(`${silvers} Silver`);
  summEl.innerHTML = summParts.length ? '· ' + summParts.join(' · ') : '';

  document.getElementById('pp-medals').textContent = myComps.filter(c => ['1', '2', '3'].includes(c.place)).length;

  el.innerHTML = '';
  if (!myComps.length) {
    el.innerHTML = '<div class="empty-state">No competition results yet.</div>';
    return;
  }

  myComps.slice().reverse().forEach(c => {
    const pMap = {
      '1': ['cri-g', '🥇', '1st'],
      '2': ['cri-s', '🥈', '2nd'],
      '3': ['cri-s', '🥉', '3rd'],
      'loss': ['cri-l', '✕', 'Loss']
    };
    const [cls, ico, lbl] = pMap[c.place] || ['cri-l', '?', '?'];
    const mWon = c.matches_won ?? c.matchesWon ?? 0;
    const mLost = c.matches_lost ?? c.matchesLost ?? 0;
    const matchRec = (mWon || mLost) ? `${mWon}-${mLost}` : '';

    el.innerHTML += `<div class="cr">
      <div class="cri ${cls}">${ico}</div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:12px">${pEsc(c.event_name || c.event)}</div>
        <div style="font-size:11px;color:var(--text3)">${pEsc(c.division || c.div)}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:14px">${lbl}</div>
        ${matchRec ? `<div style="font-size:11px;font-weight:600;color:var(--text2)">${matchRec}</div>` : ''}
        <div style="font-size:10px;color:var(--text3)">${pFmtDate(c.result_date || c.date)}</div>
      </div>
    </div>`;
  });
}

function renderPortalMembership(a) {
  const map = {
    active: ['pay-active', 'Active'],
    overdue: ['pay-overdue', 'Overdue'],
    cancelled: ['pay-cancelled', 'Cancelled'],
    inactive: ['pay-inactive', 'No Membership'],
  };
  const [cls, label] = map[a.payment_status] || map.inactive;
  document.getElementById('pp-payment-badge').innerHTML = `<span class="pay-badge ${cls}">${label}</span>`;

  const lines = [];
  if (a.last_payment_date) lines.push(`Last payment: ${pFmtDate(a.last_payment_date)}`);
  if (a.next_payment_due) lines.push(`Next payment due: ${pFmtDate(a.next_payment_due)}`);
  if (!lines.length) lines.push('No billing history yet. Contact your coach to set up membership billing.');
  document.getElementById('pp-billing-info').innerHTML = lines.join('<br>');
}

document.addEventListener('click', function (e) {
  const t = e.target;
  if (t.id === 'btn-portal-login') { portalHandleLogin(); return; }
  if (t.id === 'btn-portal-reset') { portalHandleResetPassword(); return; }
  if (t.id === 'btn-portal-logout') { portalHandleLogout(); return; }
  if (t.id === 'btn-portal-set-password') { portalHandleSetPassword(); return; }
});

document.getElementById('portal-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') portalHandleLogin();
});
document.getElementById('portal-email').addEventListener('keydown', e => {
  if (e.key === 'Enter') portalHandleLogin();
});

(async function () {
  showPortalLogin();

  // Handoff from the coach dashboard — a recovery/invite link for an
  // athlete account landed there first (misconfigured redirect or stale
  // link); pick up the live session here instead of failing.
  const handoff = sessionStorage.getItem('kong_recovery_handoff');
  if (handoff) {
    sessionStorage.removeItem('kong_recovery_handoff');
    try {
      const { access_token, refresh_token } = JSON.parse(handoff);
      const { error } = await db.auth.setSession({ access_token, refresh_token });
      if (!error) { showPortalResetScreen(); return; }
    } catch (e) {
      console.error('Recovery handoff failed:', e);
    }
  }

  const hash = window.location.hash;
  const isRecovery = hash.includes('type=recovery');
  const isInvite = hash.includes('type=invite');
  const session = await portalGetSession();

  if (session && (isRecovery || isInvite)) {
    showPortalResetScreen();
  } else if (session) {
    await initPortal();
  }

  portalOnAuthChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      showPortalResetScreen();
      return;
    }
    if (event === 'SIGNED_IN' && session) {
      const h = window.location.hash;
      if (h.includes('type=invite')) {
        showPortalResetScreen();
        return;
      }
      await initPortal();
    }
    if (event === 'SIGNED_OUT') showPortalLogin();
  });
})();
