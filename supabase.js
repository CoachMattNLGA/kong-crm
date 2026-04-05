/* ── supabase.js — KONG CRM database layer ────────────────── */

const SUPABASE_URL = 'https://huguxargfxryyhavjxqy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_aN3U9D-AYzcqXIDoTEwNHw_BSZow8Ah';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── ROW MAPPERS (DB → JS) ─────────────────────────────────
function mapAthlete(r) {
  return {
    id:             r.id,
    first:          r.first           || '',
    last:           r.last            || '',
    belt:           r.belt            || 'white',
    bg:             r.bg              || 'Athlete',
    email:          r.email           || '',
    phone:          r.phone           || '',
    street:         r.street          || '',
    city:           r.city            || '',
    statzip:        r.statzip         || '',
    age:            r.age             || '',
    weight:         r.weight          || '',
    wclass:         r.wclass          || '',
    since:          r.since           || '',
    sinceISO:       r.since_iso       || '',
    photo:          r.photo_url       || '',
    sessions:       r.sessions        || 0,
    wins:           r.wins            || 0,
    losses:         r.losses          || 0,
    status:         r.status          || 'active',
    inactiveReason: r.inactive_reason || '',
    inactiveNotes:  r.inactive_notes  || '',
    inactiveSince:  r.inactive_since  || '',
    history:        Array.isArray(r.history) ? r.history : [],
    notes:          Array.isArray(r.notes)   ? r.notes   : [],
    skills:         Array.isArray(r.skills)  ? r.skills  : [65,65,65,65,65,65,65,65],
  };
}

function mapComp(r) {
  return {
    id:        r.id,
    event:     r.event_name,
    athleteId: r.athlete_id,
    div:       r.division,
    date:      r.result_date,
    place:     r.place,
  };
}

function mapEvent(r) {
  return {
    id:   r.id,
    name: r.event_name,
    date: r.event_date,
    loc:  r.event_loc,
  };
}

function mapAtt(r) {
  return {
    id:      r.id,
    date:    r.session_date,
    rawDate: r.session_date_raw,
    type:    r.session_type,
    athletes: Array.isArray(r.athlete_ids) ? r.athlete_ids : [],
  };
}

// ── JS → DB ROW ───────────────────────────────────────────
function athleteToRow(a) {
  return {
    first: a.first, last: a.last, belt: a.belt, bg: a.bg,
    email: a.email, phone: a.phone, street: a.street,
    city: a.city, statzip: a.statzip, age: a.age,
    weight: a.weight, wclass: a.wclass,
    since: a.since, since_iso: a.sinceISO,
    photo_url: a.photo,
    sessions: a.sessions, wins: a.wins, losses: a.losses,
    status: a.status,
    inactive_reason: a.inactiveReason,
    inactive_notes:  a.inactiveNotes,
    inactive_since:  a.inactiveSince,
    history: a.history, notes: a.notes, skills: a.skills,
  };
}

// ── LOAD ALL DATA ─────────────────────────────────────────
async function loadAllData() {
  const [athR, cmpR, evtR, attR, actR] = await Promise.all([
    db.from('athletes').select('*').order('created_at'),
    db.from('competition_results').select('*').order('created_at'),
    db.from('events').select('*').order('event_date'),
    db.from('attendance_sessions').select('*').order('created_at'),
    db.from('activity_log').select('*').order('created_at', { ascending: false }).limit(20),
  ]);
  return {
    athletes: (athR.data  || []).map(mapAthlete),
    comps:    (cmpR.data  || []).map(mapComp),
    events:   (evtR.data  || []).map(mapEvent),
    attLog:   (attR.data  || []).map(mapAtt),
    actLog:   (actR.data  || []).map(r => ({ text: r.text, time: r.time_str })),
  };
}

// ── ATHLETE OPS ───────────────────────────────────────────
async function dbInsertAthlete(a) {
  const { error } = await db.from('athletes').insert({ id: a.id, ...athleteToRow(a) });
  if (error) console.error('Insert athlete:', error);
}

async function dbUpdateAthlete(a) {
  const { error } = await db.from('athletes').upsert({ id: a.id, ...athleteToRow(a) });
  if (error) console.error('Update athlete:', error);
}

// ── COMPETITION OPS ───────────────────────────────────────
async function dbInsertComp(c) {
  const { error } = await db.from('competition_results').insert({
    id: c.id, event_name: c.event, athlete_id: c.athleteId,
    division: c.div, result_date: c.date, place: c.place,
  });
  if (error) console.error('Insert comp:', error);
}

// ── EVENT OPS ─────────────────────────────────────────────
async function dbInsertEvent(ev) {
  const { error } = await db.from('events').insert({
    id: ev.id, event_name: ev.name, event_date: ev.date, event_loc: ev.loc,
  });
  if (error) throw error;
}

async function dbDeleteEvent(id) {
  const { error } = await db.from('events').delete().eq('id', id);
  if (error) console.error('Delete event:', error);
}

// ── DELETE ATHLETE ────────────────────────────────────────
async function dbDeleteAthlete(id) {
  const { error } = await db.from('athletes').delete().eq('id', id);
  if (error) console.error('Delete athlete:', error);
}

// ── ATTENDANCE OPS ────────────────────────────────────────
async function dbInsertAtt(s) {
  const { error } = await db.from('attendance_sessions').insert({
    id: s.id, session_date: s.date, session_date_raw: s.rawDate,
    session_type: s.type, athlete_ids: s.athletes,
  });
  if (error) console.error('Insert attendance:', error);
}

// ── ACTIVITY LOG ──────────────────────────────────────────
async function dbAddAct(text, time) {
  const { error } = await db.from('activity_log').insert({ text, time_str: time });
  if (error) console.error('Insert activity:', error);
}

// ── PHOTO UPLOAD ──────────────────────────────────────────
async function dbUploadPhoto(athleteId, file) {
  const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
  const path = `${athleteId}.${ext}`;

  // Remove existing file first to avoid upsert conflicts
  await db.storage.from('athlete-photos').remove([path]);

  const { error } = await db.storage
    .from('athlete-photos')
    .upload(path, file, { cacheControl: '3600', upsert: true });
  if (error) throw error;

  const { data } = db.storage.from('athlete-photos').getPublicUrl(path);
  // Add cache-busting timestamp so browser loads the new image
  return data.publicUrl + '?t=' + Date.now();
}

// ── AUTH ──────────────────────────────────────────────────
async function getSession() {
  const { data: { session } } = await db.auth.getSession();
  return session;
}

async function signIn(email, password) {
  return await db.auth.signInWithPassword({ email, password });
}

async function signOut() {
  return await db.auth.signOut();
}

async function sendPasswordReset(email) {
  return await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
}

function onAuthChange(callback) {
  return db.auth.onAuthStateChange(callback);
}
