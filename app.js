/* ── KONG CRM — app.js ─────────────────────────────────
 *
 * DEVELOPER HANDOFF NOTES
 * ────────────────────────
 * This file contains all application logic for KONG CRM.
 * Currently uses localStorage for persistence.
 *
 * TO MIGRATE TO SUPABASE:
 * 1. Replace the S.get() / S.set() calls with Supabase queries
 * 2. Add Supabase Auth for email/password login
 * 3. Replace photo storage (base64) with Supabase Storage URLs
 * 4. All data structures are documented below
 *
 * SUPABASE TABLES NEEDED:
 * - athletes (see athlete object structure below)
 * - sessions / attLog (attendance log)
 * - comps (competition results)
 * - events (upcoming events)
 * - actLog (activity log)
 *
 * See developer brief for full schema.
 * ─────────────────────────────────────────────────────── */

'use strict';

// ── CONSTANTS ──────────────────────────────────────────
const BELTS = [
  { name: 'White',  color: '#d4d4d4' },
  { name: 'Blue',   color: '#1d4ed8' },
  { name: 'Purple', color: '#7c3aed' },
  { name: 'Brown',  color: '#92400e' },
  { name: 'Black',  color: '#111111' },
];

const BELT_MAP = { white: 0, blue: 1, purple: 2, brown: 3, black: 4 };
const BELT_CLS = { white: 'bw', blue: 'bbl', purple: 'bp', brown: 'bbr', black: 'bk' };

const AVATAR_COLORS = [
  '#B549B6','#7c3aed','#1d4ed8','#047857',
  '#b45309','#9f1239','#0369a1','#6d28d9'
];

const SKILLS = [
  'Pin Escapes', 'Defense → Offense', 'Pinning & Progression', 'Structured Variety',
  'Leg Locks', 'Wrestling Base', 'Conditioning', 'Competition IQ'
];

const INACTIVE_REASONS = ['Injury', 'Moved away', 'Quit', 'School', 'Sports Season'];

// ── STATE ──────────────────────────────────────────────
let athletes  = [];
let comps     = [];
let events    = [];
let attLog    = [];
let actLog    = [];
let curAthId  = null;
let pendingBelt = null;
let curFilter = 'all';
let pendingInactiveId   = null;
let pendingReactivateId = null;

// ── HELPERS ────────────────────────────────────────────
function newUUID()     { return crypto.randomUUID(); }
function nowId()       { return Date.now(); }
function todayISO()    { return new Date().toISOString().split('T')[0]; }
function todayStr()    { return new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }
function esc(s)        { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function col(i)        { return AVATAR_COLORS[i % AVATAR_COLORS.length]; }
function initials(a)   { return (a.first[0] + a.last[0]).toUpperCase(); }
function beltIdx(b)    { return BELT_MAP[b] || 0; }
function beltCls(b)    { return BELT_CLS[b] || 'bw'; }

function fmtDate(d) {
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch(e) { return d; }
}

function fmtShort(d) {
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch(e) { return d; }
}

/**
 * TIME AT NLGA
 * Auto-calculates from sinceISO (YYYY-MM-DD).
 * Returns a short string like "2 yrs 3 mo" or "8 mo" or "3 wks"
 */
function timeAtNLGA(sinceISO) {
  if (!sinceISO) return null;
  try {
    const start = new Date(sinceISO);
    const now   = new Date();
    let years  = now.getFullYear() - start.getFullYear();
    let months = now.getMonth()    - start.getMonth();
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
  } catch(e) { return null; }
}

function fmtContact(a) { return a.email || a.phone || '—'; }

function addAct(txt) {
  const entry = { text: txt, time: todayStr() };
  actLog.unshift(entry);
  if (actLog.length > 20) actLog.pop();
  dbAddAct(txt, entry.time).catch(console.error);
}

// ── TOAST ──────────────────────────────────────────────
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── AVATAR HTML ────────────────────────────────────────
function avHTML(a, size = 30, fs = 12) {
  const i  = athletes.indexOf(a);
  const bg = col(i);
  if (a.photo) {
    return `<div class="av" style="width:${size}px;height:${size}px;">
      <img src="${a.photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">
    </div>`;
  }
  return `<div class="av" style="width:${size}px;height:${size}px;background:${bg};font-size:${fs}px;">${initials(a)}</div>`;
}

// ── MODAL HELPERS ──────────────────────────────────────
function openModal(id)  { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// ── NAVIGATION ─────────────────────────────────────────
function nav(page, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('on'));
  document.getElementById('p-' + page).classList.add('on');
  if (el) el.classList.add('on');

  const titles = {
    dashboard: 'Dashboard', athletes: 'Athletes', attendance: 'Attendance',
    ranks: 'Ranks', competition: 'Competition Records', events: 'Events',
    merch: 'Merch Store', billing: 'Billing', profile: 'Athlete Profile'
  };
  document.getElementById('pg-title').textContent = titles[page] || page;
  renderPage(page);
}

function renderPage(p) {
  if (p === 'dashboard')        renderDashboard();
  else if (p === 'athletes')    renderAthletes();
  else if (p === 'attendance')  renderAttendance();
  else if (p === 'ranks')       renderRanks();
  else if (p === 'competition') renderComp();
  else if (p === 'events')      renderEvents();
  else if (p === 'profile')     renderProfile();
}

// ── DASHBOARD ──────────────────────────────────────────
function renderDashboard() {
  const active   = athletes.filter(a => a.status === 'active');
  const inactive = athletes.filter(a => a.status === 'inactive');
  const wins     = comps.filter(c => c.place !== 'loss').length;
  const losses   = comps.filter(c => c.place === 'loss').length;

  document.getElementById('s-active').textContent   = active.length;
  document.getElementById('s-sessions').textContent = attLog.length;
  document.getElementById('s-record').textContent   = wins + '-' + losses;
  document.getElementById('s-inactive').textContent = inactive.length;

  // Roster
  const rEl = document.getElementById('d-roster'); rEl.innerHTML = '';
  active.slice(0, 5).forEach(a => {
    rEl.innerHTML += `<div class="arow" data-profile="${a.id}">
      ${avHTML(a, 30, 12)}
      <div style="flex:1">
        <div style="font-weight:600;font-size:13px">${a.first} ${a.last}</div>
        <div style="font-size:11px;color:var(--text3)">${a.bg} · ${a.sessions} sessions</div>
      </div>
      <span class="bb ${beltCls(a.belt)}">${a.belt}</span>
    </div>`;
  });

  // Attendance bars
  const aEl = document.getElementById('d-att'); aEl.innerHTML = '';
  const mx  = Math.max(...active.map(a => a.sessions), 1);
  active.slice(0, 5).forEach(a => {
    const p = Math.round((a.sessions / mx) * 100);
    aEl.innerHTML += `<div class="bar-row">
      <div class="bar-lbl" style="width:80px">${a.first} ${a.last[0]}.</div>
      <div class="bar-bg"><div class="bar-fill" style="width:${p}%"></div></div>
      <div class="bar-ct" style="width:20px">${a.sessions}</div>
    </div>`;
  });

  // Events
  const evEl = document.getElementById('d-events'); evEl.innerHTML = '';
  if (!events.length) { evEl.innerHTML = '<div class="empty-state">No upcoming events.</div>'; }
  events.slice(0, 3).forEach(ev => {
    const d  = new Date(ev.date + 'T00:00:00');
    const mo = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const dy = d.getDate();
    evEl.innerHTML += `<div class="ev-item">
      <div class="ev-box"><div class="ev-mo">${mo}</div><div class="ev-dy">${dy}</div></div>
      <div>
        <div style="font-weight:600;font-size:13px">${ev.name}</div>
        <div style="font-size:11px;color:var(--text3)">${ev.loc}</div>
      </div>
    </div>`;
  });

  // Win/Loss
  const wlEl = document.getElementById('d-wl'); wlEl.innerHTML = '';
  athletes.filter(a => a.wins + a.losses > 0).slice(0, 5).forEach(a => {
    const t = a.wins + a.losses || 1;
    const p = Math.round((a.wins / t) * 100);
    wlEl.innerHTML += `<div class="wl-row">
      <div class="wl-n">${a.first} ${a.last[0]}.</div>
      <div class="wl-w">${a.wins}W</div>
      <div class="wl-bg"><div class="wl-wf" style="width:${p}%"></div></div>
      <div class="wl-l">${a.losses}L</div>
    </div>`;
  });

  // Activity log
  const lEl = document.getElementById('d-log'); lEl.innerHTML = '';
  (actLog.length ? actLog : [{ text: 'No activity yet.', time: '' }]).slice(0, 6).forEach(l => {
    lEl.innerHTML += `<div class="log-e">
      <div class="log-t">${l.time}</div>
      <div class="log-dot"></div>
      <div class="log-a">${l.text}</div>
    </div>`;
  });
}

// ── ATHLETES ───────────────────────────────────────────
function renderFTabs() {
  const all = athletes.length;
  const act = athletes.filter(a => a.status === 'active').length;
  const ina = athletes.filter(a => a.status === 'inactive').length;
  document.getElementById('ftabs').innerHTML = [
    { k: 'all',      l: 'All',      n: all },
    { k: 'active',   l: 'Active',   n: act },
    { k: 'inactive', l: 'Inactive', n: ina },
  ].map(t => `<button class="ftab${curFilter === t.k ? ' on' : ''}" data-filter="${t.k}">${t.l}<span class="ftab-ct">${t.n}</span></button>`).join('');
}

function renderAthletes(search = '') {
  renderFTabs();
  let list = athletes;
  if (search) list = list.filter(a => (a.first + ' ' + a.last + a.email + a.phone).toLowerCase().includes(search.toLowerCase()));
  const activeList   = curFilter === 'inactive' ? [] : list.filter(a => a.status === 'active');
  const inactiveList = curFilter === 'active'   ? [] : list.filter(a => a.status === 'inactive');

  const aEl = document.getElementById('a-list'); aEl.innerHTML = '';
  if (!activeList.length && curFilter !== 'inactive') {
    aEl.innerHTML = '<div class="empty-state">No active athletes.</div>';
  }
  activeList.forEach(a => {
    aEl.innerHTML += `<div class="td-row at7">
      <div class="td"><div class="ac">${avHTML(a, 28, 11)}<span style="font-weight:600;cursor:pointer" data-profile="${a.id}">${a.first} ${a.last}</span></div></div>
      <div class="td"><span class="bb ${beltCls(a.belt)}">${a.belt}</span></div>
      <div class="td"><span class="sb-active">● Active</span></div>
      <div class="td tdm" style="font-size:11px">${fmtContact(a)}</div>
      <div class="td tdm">${a.sessions}</div>
      <div class="td"><span style="color:var(--green)">${a.wins}W</span> <span style="color:var(--text3)">-</span> <span style="color:var(--red)">${a.losses}L</span></div>
      <div class="td" style="display:flex;gap:4px">
        <button class="btn btn-sm" data-profile="${a.id}">View</button>
        <button class="btn btn-sm btn-red" data-inactive="${a.id}">Inactive</button>
      </div>
    </div>`;
  });

  const inacSec  = document.getElementById('inactive-sec');
  const inacList = document.getElementById('inactive-list');
  inacList.innerHTML = '';
  if (!inactiveList.length) { inacSec.style.display = 'none'; return; }
  inacSec.style.display = 'block';
  inactiveList.forEach(a => {
    inacList.innerHTML += `<div class="inactive-card">
      ${avHTML(a, 32, 12)}
      <div style="flex:1">
        <div style="font-weight:600;font-size:13px">${a.first} ${a.last}</div>
        <div style="font-size:11px;color:var(--red);margin-top:1px">⚠ ${a.inactiveReason}${a.inactiveSince ? ' · since ' + a.inactiveSince : ''}</div>
        ${a.inactiveNotes ? `<div style="font-size:11px;color:var(--text3);margin-top:1px">${a.inactiveNotes}</div>` : ''}
      </div>
      <span class="bb ${beltCls(a.belt)}">${a.belt}</span>
      <button class="btn btn-sm" data-profile="${a.id}">View</button>
      <button class="btn btn-sm btn-green" data-reactivate="${a.id}">Reactivate</button>
    </div>`;
  });
}

// ── ATTENDANCE ─────────────────────────────────────────
function renderAttendance() {
  const lEl = document.getElementById('att-log'); lEl.innerHTML = '';
  if (!attLog.length) { lEl.innerHTML = '<div class="empty-state">No sessions logged yet.</div>'; }
  attLog.slice().reverse().slice(0, 10).forEach(s => {
    const names = s.athletes.map(id => {
      const a = athletes.find(x => x.id === id);
      return a ? a.first + ' ' + a.last[0] + '.' : '?';
    }).join(', ');
    lEl.innerHTML += `<div class="log-e">
      <div class="log-t" style="width:90px">${s.date}</div>
      <div class="log-dot"></div>
      <div class="log-a">${s.type} · ${s.athletes.length} athletes<br><span style="color:var(--text3);font-size:11px">${names}</span></div>
    </div>`;
  });

  document.getElementById('att-total').textContent = attLog.length;

  const counts = {};
  attLog.forEach(s => s.athletes.forEach(id => counts[id] = (counts[id] || 0) + 1));
  const topId = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const topA  = topId ? athletes.find(a => a.id === topId) : null;
  document.getElementById('att-top').textContent = topA ? topA.first + ' ' + topA.last : '—';

  const bEl = document.getElementById('att-bars'); bEl.innerHTML = '';
  const mx  = Math.max(...athletes.map(a => a.sessions), 1);
  athletes.forEach(a => {
    const p = Math.round((a.sessions / mx) * 100);
    bEl.innerHTML += `<div class="bar-row" style="margin-bottom:9px">
      <div class="bar-lbl" style="width:110px">${a.first} ${a.last}${a.status === 'inactive' ? ' ⚠' : ''}</div>
      <div class="bar-bg"><div class="bar-fill" style="width:${p}%"></div></div>
      <div class="bar-ct" style="width:40px">${a.sessions}</div>
    </div>`;
  });
}

// ── RANKS ──────────────────────────────────────────────
function renderRanks() {
  const active = athletes.filter(a => a.status === 'active');
  const rEl    = document.getElementById('rank-list'); rEl.innerHTML = '';
  active.forEach(a => {
    rEl.innerHTML += `<div class="promo-row">
      <div class="pr-av" style="background:${col(athletes.indexOf(a))}">${avHTML(a, 34, 12)}</div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:13px">${a.first} ${a.last}</div>
        <div style="font-size:11px;color:var(--text3)">${a.sessions} sessions</div>
      </div>
      <span class="bb ${beltCls(a.belt)}">${a.belt}</span>
    </div>`;
  });

  const dEl = document.getElementById('belt-dist'); dEl.innerHTML = '';
  BELTS.forEach(b => {
    const count = active.filter(a => a.belt === b.name.toLowerCase()).length;
    if (!count) return;
    const p = Math.round((count / active.length) * 100);
    dEl.innerHTML += `<div class="bar-row" style="margin-bottom:11px">
      <div class="bar-lbl" style="width:70px"><span class="bb ${beltCls(b.name.toLowerCase())}">${b.name}</span></div>
      <div class="bar-bg" style="margin-left:6px"><div class="bar-fill" style="width:${p}%"></div></div>
      <div class="bar-ct" style="width:24px">${count}</div>
    </div>`;
  });
}

// ── COMPETITION ─────────────────────────────────────────
function renderComp() {
  const wins   = comps.filter(c => c.place !== 'loss').length;
  const losses = comps.filter(c => c.place === 'loss').length;
  document.getElementById('c-wins').textContent   = wins;
  document.getElementById('c-losses').textContent = losses;
  document.getElementById('c-gold').textContent   = comps.filter(c => c.place === '1').length;
  document.getElementById('c-events').textContent = [...new Set(comps.map(c => c.event))].length;

  const el = document.getElementById('comp-list'); el.innerHTML = '';
  comps.slice().reverse().forEach(c => {
    const a        = athletes.find(x => x.id === c.athleteId);
    const pMap     = { '1': ['rg','GOLD'], '2': ['rs','SILVER'], '3': ['rbrz','BRONZE'], 'loss': ['rl','LOSS'] };
    const [cls, lbl] = pMap[c.place] || ['rl','?'];
    const placeText  = { '1':'1st','2':'2nd','3':'3rd','loss':'Loss' }[c.place] || c.place;
    el.innerHTML += `<div class="td-row ct6">
      <div class="td" style="font-size:12px">${c.event}</div>
      <div class="td" style="font-size:12px">${a ? a.first + ' ' + a.last : '?'}</div>
      <div class="td tdm">${c.div}</div>
      <div class="td tdm">${fmtDate(c.date)}</div>
      <div class="td"><span class="rb ${cls}">${lbl}</span></div>
      <div class="td tdm">${placeText}</div>
    </div>`;
  });
}

// ── EVENTS ─────────────────────────────────────────────
function renderEvents() {
  const el = document.getElementById('events-list'); el.innerHTML = '';
  if (!events.length) { el.innerHTML = '<div class="cs" style="text-align:center;color:var(--text3);font-size:13px;padding:30px">No events yet.</div>'; return; }
  events.forEach(ev => {
    const d  = new Date(ev.date + 'T00:00:00');
    const mo = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const dy = d.getDate();
    el.innerHTML += `<div class="card" style="margin-bottom:10px;display:flex;align-items:center;gap:13px">
      <div class="ev-box" style="padding:6px 10px"><div class="ev-mo">${mo}</div><div class="ev-dy">${dy}</div></div>
      <div style="flex:1">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px">${ev.name}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${ev.loc}</div>
      </div>
      <button class="btn btn-sm btn-red" data-del-event="${ev.id}">Remove</button>
    </div>`;
  });
}

// ── PROFILE ────────────────────────────────────────────
function openProfile(id) {
  curAthId    = id;
  pendingBelt = null;
  nav('profile', null);
}

function renderProfile() {
  const a = athletes.find(x => x.id === curAthId);
  if (!a) return;
  if (pendingBelt === null) pendingBelt = beltIdx(a.belt);

  const i    = athletes.indexOf(a);
  const avEl = document.getElementById('prof-av');
  avEl.style.background = a.photo ? 'transparent' : col(i);
  avEl.innerHTML = a.photo
    ? `<img src="${a.photo}" style="width:100%;height:100%;object-fit:cover;">`
    : initials(a);

  document.getElementById('prof-name').textContent = a.first + ' ' + a.last;
  document.getElementById('prof-tag').textContent  = 'NLGA · Member since ' + a.since;
  document.getElementById('prof-bg').innerHTML     = `<span class="tag tag-comp">${a.bg || 'Athlete'}</span>`;

  // Time at NLGA
  const timeEl = document.getElementById('prof-time-nlga');
  const t = timeAtNLGA(a.sinceISO);
  if (t) { timeEl.innerHTML = `⏱ Time at NLGA: <span>${t}</span>`; timeEl.style.display = 'flex'; }
  else   { timeEl.style.display = 'none'; }

  // Status tag
  const stTag = document.getElementById('prof-status-tag');
  stTag.innerHTML = a.status === 'active'
    ? '<span class="tag tag-act">Active</span>'
    : '<span class="tag tag-inact">Inactive</span>';

  // Inactive banner
  const banner = document.getElementById('prof-inactive-banner');
  if (a.status === 'inactive') {
    banner.style.display = 'flex';
    document.getElementById('prof-inactive-reason').textContent = '⚠ ' + a.inactiveReason + (a.inactiveSince ? ' · since ' + a.inactiveSince : '');
    document.getElementById('prof-inactive-notes').textContent  = a.inactiveNotes || '';
  } else {
    banner.style.display = 'none';
  }

  // Status button
  const stBtn = document.getElementById('btn-toggle-status');
  stBtn.textContent = a.status === 'active' ? 'Mark Inactive' : 'Reactivate';
  stBtn.className   = 'btn btn-sm ' + (a.status === 'active' ? 'btn-red' : 'btn-green');

  // Belt
  const b = BELTS[beltIdx(a.belt)];
  document.getElementById('prof-swatch').style.background    = b.color;
  document.getElementById('prof-belt-title').textContent     = b.name + ' Belt';
  document.getElementById('prof-belt-title').style.color     = beltIdx(a.belt) === 0 ? '#555' : b.color;
  document.getElementById('prof-since').textContent          = 'Since ' + (a.history && a.history[0] ? a.history[0].date : '—');

  // Stats
  document.getElementById('prof-sess').textContent   = a.sessions;
  document.getElementById('prof-wins').textContent   = a.wins;
  document.getElementById('prof-losses').textContent = a.losses;
  document.getElementById('prof-medals').textContent = comps.filter(c => c.athleteId === a.id && c.place === '1').length;

  // Contact
  function setVal(id, val) {
    const el = document.getElementById(id);
    el.textContent = val || 'Not provided';
    el.className   = 'cl-val' + (val ? '' : ' empty');
  }
  setVal('prof-email',    a.email);
  setVal('prof-phone',    a.phone);
  setVal('prof-addr',     [a.street, a.city, a.statzip].filter(Boolean).join(', '));
  setVal('prof-physical', [a.age ? a.age + ' yrs' : null, a.weight || null, a.wclass || null].filter(Boolean).join(' · '));

  // Belt picker
  const pkEl = document.getElementById('prof-picker'); pkEl.innerHTML = '';
  BELTS.forEach((blt, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'bp-opt';
    const sw = document.createElement('div');
    sw.className      = 'bp-sw' + (idx === pendingBelt ? ' sel' : '');
    sw.style.background = blt.color;
    sw.title          = blt.name;
    sw.dataset.beltIdx = idx;
    const nm = document.createElement('div');
    nm.className  = 'bp-nm';
    nm.textContent = blt.name;
    wrap.appendChild(sw);
    wrap.appendChild(nm);
    pkEl.appendChild(wrap);
  });

  // Timeline
  const tlEl = document.getElementById('prof-timeline'); tlEl.innerHTML = '';
  (a.history || []).forEach((item, idx) => {
    tlEl.innerHTML += `<div class="ti">
      <div class="ti-dot${idx === 0 ? ' fill' : ''}"></div>
      <div class="ti-date">${item.date}</div>
      <div class="ti-label">${item.label}</div>
    </div>`;
  });

  // Skills
  const skEl  = document.getElementById('prof-skills'); skEl.innerHTML = '';
  const left  = document.createElement('div');
  const right = document.createElement('div');
  SKILLS.forEach((s, idx) => {
    const val  = a.skills ? a.skills[idx] : 65;
    const html = `<div class="sk-row">
      <div class="sk-lbl">${s}</div>
      <div class="sk-track"><div class="sk-fill" style="width:${val}%"></div></div>
      <div class="sk-val">${val}</div>
    </div>`;
    (idx < 4 ? left : right).innerHTML += html;
  });
  skEl.appendChild(left);
  skEl.appendChild(right);

  // Heatmap
  const hmEl   = document.getElementById('prof-hm');
  const dateSet = new Set(attLog.filter(s => s.athletes.includes(a.id)).map(s => s.rawDate || s.date));
  let hh = '';
  const now = new Date();
  for (let w = 12; w >= 0; w--) {
    for (let d = 6; d >= 0; d--) {
      const dt = new Date(now);
      dt.setDate(dt.getDate() - (w * 7 + d));
      const iso = dt.toISOString().split('T')[0];
      hh += `<div class="hc ${dateSet.has(iso) ? 'h3' : 'h0'}" title="${fmtShort(iso)}"></div>`;
    }
  }
  hmEl.innerHTML = hh;
  document.getElementById('prof-hm-stat').textContent = a.sessions + ' total sessions';

  // Competition
  const cpEl    = document.getElementById('prof-comp'); cpEl.innerHTML = '';
  const myComps = comps.filter(c => c.athleteId === a.id);
  if (!myComps.length) { cpEl.innerHTML = '<div class="empty-state">No results yet.</div>'; }
  myComps.slice().reverse().forEach(c => {
    const pMap        = { '1': ['cri-g','🥇','1st'], '2': ['cri-s','🥈','2nd'], '3': ['cri-s','🥉','3rd'], 'loss': ['cri-l','✕','Loss'] };
    const [cls, ico, lbl] = pMap[c.place] || ['cri-l','?','?'];
    cpEl.innerHTML += `<div class="cr">
      <div class="cri ${cls}">${ico}</div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:12px">${c.event}</div>
        <div style="font-size:11px;color:var(--text3)">${c.div}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:14px">${lbl}</div>
        <div style="font-size:10px;color:var(--text3)">${fmtDate(c.date)}</div>
      </div>
    </div>`;
  });

  renderNotes(a);
}

// ── NOTES ──────────────────────────────────────────────
function renderNotes(a) {
  if (!a) a = athletes.find(x => x.id === curAthId);
  if (!a) return;
  const el = document.getElementById('prof-notes'); el.innerHTML = '';
  if (!a.notes || !a.notes.length) { el.innerHTML = '<div class="empty-state">No notes yet.</div>'; return; }
  [...a.notes].reverse().forEach(n => {
    if (n.editing) {
      el.innerHTML += `<div class="note-wrap"><div class="note-edit">
        <div class="note-d">${n.date}</div>
        <textarea class="note-ta" id="edit-${n.id}" rows="3">${esc(n.text)}</textarea>
        <div class="note-ea">
          <button class="btn btn-sm btn-ghost" data-cancel-edit="${n.id}">Cancel</button>
          <button class="btn btn-sm btn-p" data-save-edit="${n.id}">Save</button>
        </div>
      </div></div>`;
    } else {
      el.innerHTML += `<div class="note-wrap"><div class="note-view">
        <div class="note-d">
          <span>${n.date}</span>
          <div class="note-actions">
            <button class="btn btn-sm btn-ghost" data-start-edit="${n.id}" style="padding:2px 6px;font-size:10px">Edit</button>
            <button class="btn btn-sm btn-red" data-del-note="${n.id}" style="padding:2px 6px;font-size:10px">Del</button>
          </div>
        </div>
        <div class="note-t">${esc(n.text)}</div>
      </div></div>`;
    }
  });
}

// ── PROMOTION ──────────────────────────────────────────
function promote() {
  const a = athletes.find(x => x.id === curAthId);
  if (!a) return;
  if (pendingBelt === beltIdx(a.belt)) { toast('Already at ' + BELTS[beltIdx(a.belt)].name + ' Belt.'); return; }
  const prev = BELTS[beltIdx(a.belt)].name;
  a.belt = BELTS[pendingBelt].name.toLowerCase();
  if (!a.history) a.history = [];
  a.history.unshift({ date: todayStr(), label: BELTS[pendingBelt].name + ' Belt' });
  addAct(`${a.first} ${a.last} promoted: ${prev} → ${BELTS[pendingBelt].name} Belt`);
  dbUpdateAthlete(a).catch(console.error);
  renderProfile();
  toast('🎉 ' + prev + ' → ' + BELTS[pendingBelt].name + ' Belt');
}

// ── STATUS ─────────────────────────────────────────────
function openMarkInactive(id) {
  pendingInactiveId = id;
  const a = athletes.find(x => x.id === id);
  document.getElementById('inactive-sub').textContent = `${a.first} ${a.last} will be moved off the active roster. All data and history is preserved.`;
  document.getElementById('inactive-notes').value = '';
  openModal('inactive-modal');
}

function markInactive() {
  const a = athletes.find(x => x.id === pendingInactiveId);
  if (!a) return;
  a.status        = 'inactive';
  a.inactiveReason = document.getElementById('inactive-reason').value;
  a.inactiveNotes  = document.getElementById('inactive-notes').value.trim();
  a.inactiveSince  = todayStr();
  addAct(`${a.first} ${a.last} marked inactive — ${a.inactiveReason}`);
  dbUpdateAthlete(a).catch(console.error);
  closeModal('inactive-modal');
  if (curAthId === a.id) renderProfile();
  renderAthletes();
  toast(`${a.first} ${a.last} moved to inactive`);
}

function openDeleteAthlete(id) {
  pendingInactiveId = id; // reuse this variable for pending delete
  const a = athletes.find(x => x.id === id);
  document.getElementById('delete-athlete-sub').textContent = `You are about to permanently delete ${a.first} ${a.last}.`;
  openModal('delete-athlete-modal');
}

async function confirmDeleteAthlete() {
  const a = athletes.find(x => x.id === pendingInactiveId);
  if (!a) return;
  const name = `${a.first} ${a.last}`;
  athletes = athletes.filter(x => x.id !== a.id);
  comps    = comps.filter(c => c.athleteId !== a.id);
  curAthId = null;
  await dbDeleteAthlete(a.id);
  closeModal('delete-athlete-modal');
  nav('athletes', document.querySelectorAll('.ni')[1]);
  toast(`${name} permanently deleted`);
}

function openReactivate(id) {
  pendingReactivateId = id;
  const a = athletes.find(x => x.id === id);
  document.getElementById('reactivate-sub').textContent = `${a.first} ${a.last} will be moved back to the active roster. Previous reason: ${a.inactiveReason}.`;
  document.getElementById('reactivate-notes').value = '';
  openModal('reactivate-modal');
}

function reactivate() {
  const a = athletes.find(x => x.id === pendingReactivateId);
  if (!a) return;
  const prevReason = a.inactiveReason;
  const notes      = document.getElementById('reactivate-notes').value.trim();
  a.status         = 'active';
  a.inactiveReason = '';
  a.inactiveNotes  = notes ? 'Returned: ' + notes : '';
  a.inactiveSince  = '';
  addAct(`${a.first} ${a.last} reactivated — was: ${prevReason}`);
  dbUpdateAthlete(a).catch(console.error);
  closeModal('reactivate-modal');
  if (curAthId === a.id) renderProfile();
  renderAthletes();
  toast(`${a.first} ${a.last} is back on the active roster`);
}

// ── CONTACT EDIT ───────────────────────────────────────
function openEditContact() {
  const a = athletes.find(x => x.id === curAthId);
  if (!a) return;
  const fields = ['fname','lname','bg','since','email','phone','street','city','statzip','age','weight','wclass'];
  const keys   = ['first','last','bg','since','email','phone','street','city','statzip','age','weight','wclass'];
  fields.forEach((f, i) => {
    const el = document.getElementById('e-' + f);
    if (el) el.value = a[keys[i]] || '';
  });
  openModal('edit-modal');
}

function saveContact() {
  const a = athletes.find(x => x.id === curAthId);
  if (!a) return;
  a.first   = document.getElementById('e-fname').value.trim();
  a.last    = document.getElementById('e-lname').value.trim();
  a.bg      = document.getElementById('e-bg').value.trim();
  a.since   = document.getElementById('e-since').value.trim();
  a.email   = document.getElementById('e-email').value.trim();
  a.phone   = document.getElementById('e-phone').value.trim();
  a.street  = document.getElementById('e-street').value.trim();
  a.city    = document.getElementById('e-city').value.trim();
  a.statzip = document.getElementById('e-statzip').value.trim();
  a.age     = document.getElementById('e-age').value.trim();
  a.weight  = document.getElementById('e-weight').value.trim();
  a.wclass  = document.getElementById('e-wclass').value.trim();
  addAct(`${a.first} ${a.last} contact info updated`);
  dbUpdateAthlete(a).catch(console.error);
  closeModal('edit-modal');
  renderProfile();
  toast('Contact info saved');
}

// ── ADD ATHLETE ────────────────────────────────────────
function openAddModal() {
  const ids = ['m-fname','m-lname','m-bg','m-email','m-phone','m-street','m-city','m-statzip','m-age','m-weight','m-wclass'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  openModal('add-modal');
}

function addAthlete() {
  const f = document.getElementById('m-fname').value.trim();
  const l = document.getElementById('m-lname').value.trim();
  if (!f || !l) { toast('Enter first and last name.'); return; }
  const belt  = document.getElementById('m-belt').value;
  const newA  = {
    id:       newUUID(),
    first: f, last: l, belt,
    bg:      document.getElementById('m-bg').value.trim() || 'Athlete',
    email:   document.getElementById('m-email').value.trim(),
    phone:   document.getElementById('m-phone').value.trim(),
    street:  document.getElementById('m-street').value.trim(),
    city:    document.getElementById('m-city').value.trim(),
    statzip: document.getElementById('m-statzip').value.trim(),
    age:     document.getElementById('m-age').value.trim(),
    weight:  document.getElementById('m-weight').value.trim(),
    wclass:  document.getElementById('m-wclass').value.trim(),
    since:   todayStr(), sinceISO: todayISO(),
    photo: '', sessions: 0, wins: 0, losses: 0,
    status: 'active', inactiveReason: '', inactiveNotes: '', inactiveSince: '',
    history: [{ date: todayStr(), label: BELTS[beltIdx(belt)].name + ' Belt' }],
    notes: [],
    skills: [65, 65, 65, 65, 65, 65, 65, 65],
  };
  athletes.push(newA);
  addAct(`${f} ${l} added to roster`);
  dbInsertAthlete(newA).catch(console.error);
  closeModal('add-modal');
  renderDashboard();
  renderAthletes();
  toast(f + ' ' + l + ' added to roster');
}

// ── ATTENDANCE MODAL ───────────────────────────────────
function openAttModal() {
  document.getElementById('att-date').value = todayISO();
  const cl = document.getElementById('att-checks'); cl.innerHTML = '';
  athletes.filter(a => a.status === 'active').forEach(a => {
    cl.innerHTML += `<label class="att-check">
      <input type="checkbox" value="${a.id}">
      ${avHTML(a, 26, 10)}
      <span style="font-size:13px;flex:1">${a.first} ${a.last}</span>
      <span class="bb ${beltCls(a.belt)}">${a.belt}</span>
    </label>`;
  });
  openModal('att-modal');
}

function logAttendance() {
  const date    = document.getElementById('att-date').value;
  const type    = document.getElementById('att-type').value;
  const checked = [...document.querySelectorAll('#att-checks input:checked')].map(i => i.value);
  if (!checked.length) { toast('Select at least one athlete.'); return; }
  const session = { id: newUUID(), date: fmtShort(date), rawDate: date, type, athletes: checked };
  attLog.push(session);
  checked.forEach(id => {
    const a = athletes.find(x => x.id === id);
    if (a) { a.sessions++; dbUpdateAthlete(a).catch(console.error); }
  });
  addAct(`${type} logged — ${checked.length} athletes (${fmtShort(date)})`);
  dbInsertAtt(session).catch(console.error);
  closeModal('att-modal');
  renderDashboard();
  toast('Session logged — ' + checked.length + ' athletes');
}

// ── COMPETITION MODAL ──────────────────────────────────
function openCompModal() {
  document.getElementById('c-date').value  = todayISO();
  document.getElementById('c-event').value = '';
  document.getElementById('c-div').value   = '';
  const sel = document.getElementById('c-athlete'); sel.innerHTML = '';
  athletes.forEach(a => { sel.innerHTML += `<option value="${a.id}">${a.first} ${a.last}</option>`; });
  openModal('comp-modal');
}

function addComp() {
  const event = document.getElementById('c-event').value.trim();
  if (!event) { toast('Enter event name.'); return; }
  const athleteId = document.getElementById('c-athlete').value;
  const date      = document.getElementById('c-date').value;
  const div       = document.getElementById('c-div').value || 'Open';
  const place     = document.getElementById('c-place').value;
  const newComp   = { id: newUUID(), event, athleteId, div, date, place };
  comps.push(newComp);
  const a = athletes.find(x => x.id === athleteId);
  if (a) {
    if (place === 'loss') a.losses++; else a.wins++;
    dbUpdateAthlete(a).catch(console.error);
  }
  const placeText = { '1':'1st place','2':'2nd place','3':'3rd place','loss':'Loss' }[place] || place;
  addAct(`${a ? a.first + ' ' + a.last : 'Athlete'} — ${placeText} at ${event}`);
  dbInsertComp(newComp).catch(console.error);
  closeModal('comp-modal');
  renderComp();
  toast('Result saved');
}

// ── EVENT MODAL ────────────────────────────────────────
function openEventModal() {
  document.getElementById('ev-name').value = '';
  document.getElementById('ev-date').value = '';
  document.getElementById('ev-loc').value  = '';
  openModal('event-modal');
}

function addEvent() {
  const name  = document.getElementById('ev-name').value.trim();
  const date  = document.getElementById('ev-date').value;
  const loc   = document.getElementById('ev-loc').value.trim() || 'TBD';
  if (!name || !date) { toast('Enter name and date.'); return; }
  const newEv = { id: newUUID(), name, date, loc };
  events.push(newEv);
  addAct(`Event added: ${name}`);
  dbInsertEvent(newEv).catch(console.error);
  closeModal('event-modal');
  renderEvents();
  toast('Event added');
}

// ── NOTE MODAL ─────────────────────────────────────────
function saveNote() {
  const text = document.getElementById('note-text').value.trim();
  if (!text) { toast('Write something first.'); return; }
  const a = athletes.find(x => x.id === curAthId);
  if (!a) return;
  if (!a.notes) a.notes = [];
  a.notes.push({ id: nowId(), date: todayStr(), text, editing: false });
  addAct(`Coach note added for ${a.first} ${a.last}`);
  dbUpdateAthlete(a).catch(console.error);
  document.getElementById('note-text').value = '';
  closeModal('note-modal');
  renderNotes(a);
  toast('Note saved');
}

// ── EVENT DELEGATION ───────────────────────────────────
document.addEventListener('click', function(e) {
  const t = e.target;

  // Nav items
  if (t.classList.contains('ni') || t.closest('.ni')) {
    const ni   = t.closest('.ni') || t;
    const page = ni.dataset.page;
    if (page) nav(page, ni);
    return;
  }

  // Filter tabs
  if (t.classList.contains('ftab') && t.dataset.filter) {
    curFilter = t.dataset.filter;
    renderAthletes(document.getElementById('athlete-search').value);
    return;
  }

  // Open profile
  if (t.dataset.profile)              { openProfile(t.dataset.profile); return; }
  if (t.closest('[data-profile]'))    { openProfile(t.closest('[data-profile]').dataset.profile); return; }

  // Mark inactive from roster
  if (t.dataset.inactive)             { openMarkInactive(t.dataset.inactive); return; }

  // Reactivate from roster
  if (t.dataset.reactivate)           { openReactivate(t.dataset.reactivate); return; }

  // Delete event
  if (t.dataset.delEvent) {
    events = events.filter(ev => ev.id !== t.dataset.delEvent);
    dbDeleteEvent(t.dataset.delEvent).catch(console.error);
    renderEvents(); toast('Event removed');
    return;
  }

  // Belt picker swatches
  if (t.classList.contains('bp-sw') && t.dataset.beltIdx !== undefined) {
    pendingBelt = +t.dataset.beltIdx;
    renderProfile();
    return;
  }

  // Note actions
  if (t.dataset.startEdit) {
    const a = athletes.find(x => x.id === curAthId);
    if (!a) return;
    a.notes = a.notes.map(n => ({ ...n, editing: n.id === +t.dataset.startEdit }));
    renderNotes(a);
    const ta = document.getElementById('edit-' + t.dataset.startEdit);
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    return;
  }

  if (t.dataset.cancelEdit) {
    const a = athletes.find(x => x.id === curAthId);
    if (!a) return;
    a.notes = a.notes.map(n => ({ ...n, editing: false }));
    renderNotes(a);
    return;
  }

  if (t.dataset.saveEdit) {
    const a = athletes.find(x => x.id === curAthId);
    if (!a) return;
    const ta = document.getElementById('edit-' + t.dataset.saveEdit);
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) { toast('Note cannot be empty.'); return; }
    a.notes = a.notes.map(n => n.id === +t.dataset.saveEdit ? { ...n, text, editing: false } : n);
    dbUpdateAthlete(a).catch(console.error);
    renderNotes(a); toast('Note updated');
    return;
  }

  if (t.dataset.delNote) {
    if (!confirm('Delete this note?')) return;
    const a = athletes.find(x => x.id === curAthId);
    if (!a) return;
    a.notes = a.notes.filter(n => n.id !== +t.dataset.delNote);
    dbUpdateAthlete(a).catch(console.error);
    renderNotes(a); toast('Note deleted');
    return;
  }

  // Close modals
  if (t.dataset.close)                  { closeModal(t.dataset.close); return; }
  if (t.classList.contains('modal-ov')) { t.style.display = 'none'; return; }

  // Top-level buttons
  if (t.id === 'btn-add-athlete')        { openAddModal(); return; }
  if (t.id === 'btn-log-att')            { openAttModal(); return; }
  if (t.id === 'btn-add-comp')           { openCompModal(); return; }
  if (t.id === 'btn-add-event')          { openEventModal(); return; }
  if (t.id === 'btn-promote')            { promote(); return; }
  if (t.id === 'btn-save-athlete')       { addAthlete(); return; }
  if (t.id === 'btn-save-att')           { logAttendance(); return; }
  if (t.id === 'btn-save-comp')          { addComp(); return; }
  if (t.id === 'btn-save-event')         { addEvent(); return; }
  if (t.id === 'btn-save-note')          { saveNote(); return; }
  if (t.id === 'btn-save-contact')       { saveContact(); return; }
  if (t.id === 'btn-edit-contact')       { openEditContact(); return; }
  if (t.id === 'btn-confirm-inactive')        { markInactive(); return; }
  if (t.id === 'btn-confirm-reactivate')      { reactivate(); return; }
  if (t.id === 'btn-delete-athlete')          { openDeleteAthlete(curAthId); return; }
  if (t.id === 'btn-confirm-delete-athlete')  { confirmDeleteAthlete(); return; }
  if (t.id === 'btn-add-note')           { openModal('note-modal'); return; }
  if (t.id === 'btn-back-athletes')      { nav('athletes', document.querySelectorAll('.ni')[1]); return; }

  if (t.id === 'btn-toggle-status') {
    const a = athletes.find(x => x.id === curAthId);
    if (!a) return;
    if (a.status === 'active') openMarkInactive(a.id);
    else openReactivate(a.id);
    return;
  }

  if (t.id === 'btn-reactivate-profile') { openReactivate(curAthId); return; }

  // Auth buttons
  if (t.id === 'btn-login')        { handleLogin(); return; }
  if (t.id === 'btn-reset-pw')     { handleResetPassword(); return; }
  if (t.id === 'btn-logout')       { handleLogout(); return; }
  if (t.id === 'btn-set-password') { handleSetNewPassword(); return; }

  // Dashboard roster rows
  if (t.closest('.arow')) {
    const id = t.closest('.arow').dataset.profile;
    if (id) openProfile(id);
    return;
  }
});

// ── SEARCH ─────────────────────────────────────────────
document.getElementById('athlete-search').addEventListener('input', function() {
  renderAthletes(this.value);
});

// ── PHOTO UPLOAD ───────────────────────────────────────
document.getElementById('prof-photo').addEventListener('change', async function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const a = athletes.find(x => x.id === curAthId);
  if (!a) return;
  try {
    toast('Uploading photo...');
    const url = await dbUploadPhoto(a.id, file);
    a.photo   = url;
    await dbUpdateAthlete(a);
    renderProfile();
    toast('Photo updated');
  } catch(err) {
    console.error('Photo upload error:', err);
    toast('Photo upload failed — check Storage bucket');
  }
});

// ── AUTH HANDLERS ──────────────────────────────────────
async function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.style.color  = 'var(--red)';
  errEl.textContent  = '';
  if (!email || !password) { errEl.textContent = 'Enter email and password.'; return; }
  const btn = document.getElementById('btn-login');
  btn.textContent = 'Signing in…'; btn.disabled = true;
  const { error } = await signIn(email, password);
  btn.textContent = 'Sign In'; btn.disabled = false;
  if (error) { errEl.textContent = error.message; }
}

async function handleResetPassword() {
  const email = document.getElementById('login-email').value.trim();
  const errEl = document.getElementById('login-error');
  if (!email) { errEl.style.color = 'var(--red)'; errEl.textContent = 'Enter your email first.'; return; }
  const { error } = await sendPasswordReset(email);
  if (error) { errEl.style.color = 'var(--red)';   errEl.textContent = error.message; }
  else        { errEl.style.color = 'var(--green)'; errEl.textContent = 'Password reset email sent!'; }
}

async function handleLogout() {
  await signOut();
}

async function handleSetNewPassword() {
  const pw1   = document.getElementById('new-password').value;
  const pw2   = document.getElementById('confirm-password').value;
  const errEl = document.getElementById('reset-error');
  errEl.style.color = 'var(--red)';
  errEl.textContent = '';
  if (!pw1)          { errEl.textContent = 'Enter a new password.'; return; }
  if (pw1.length < 6){ errEl.textContent = 'Password must be at least 6 characters.'; return; }
  if (pw1 !== pw2)   { errEl.textContent = 'Passwords do not match.'; return; }
  const btn = document.getElementById('btn-set-password');
  btn.textContent = 'Saving…'; btn.disabled = true;
  const { error } = await db.auth.updateUser({ password: pw1 });
  btn.textContent = 'Set New Password'; btn.disabled = false;
  if (error) { errEl.textContent = error.message; }
  else {
    document.getElementById('reset-screen').style.display = 'none';
    showLogin();
    document.getElementById('login-error').style.color = 'var(--green)';
    document.getElementById('login-error').textContent  = 'Password updated! Please sign in.';
  }
}

// ── LOGIN / APP VISIBILITY ─────────────────────────────
function showLogin() {
  athletes = []; comps = []; events = []; attLog = []; actLog = [];
  curAthId = null;
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('crm').style.display          = 'none';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('crm').style.display          = 'flex';
}

// ── INIT APP (after login) ─────────────────────────────
async function initApp() {
  showApp();
  const data = await loadAllData();
  athletes   = data.athletes;
  comps      = data.comps;
  events     = data.events;
  attLog     = data.attLog;
  actLog     = data.actLog.length
    ? data.actLog
    : [{ text: 'KONG initialized — welcome to the mat', time: 'Today' }];
  renderDashboard();
}

// ── ENTER KEY ON LOGIN ─────────────────────────────────
document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin();
});
document.getElementById('login-email').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleLogin();
});

// ── AUTH INIT (runs on page load) ──────────────────────
(async function () {
  showLogin(); // default: show login while checking session

  const isRecovery = window.location.hash.includes('type=recovery');
  const session = await getSession();
  if (session && !isRecovery) await initApp();

  onAuthChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      // User clicked the reset link — show the set-new-password screen
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('crm').style.display          = 'none';
      document.getElementById('reset-screen').style.display = 'flex';
      return;
    }
    if (event === 'SIGNED_IN' && session) await initApp();
    if (event === 'SIGNED_OUT')           showLogin();
  });
})();
