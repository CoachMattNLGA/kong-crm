/* ── portal-supabase.js — Lean Supabase layer for Athlete Portal ── */

const SUPABASE_URL = 'https://huguxargfxryyhavjxqy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_aN3U9D-AYzcqXIDoTEwNHw_BSZow8Ah';

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storageKey: 'kong-portal-auth' }
});

async function portalSignIn(email, password) {
  return await db.auth.signInWithPassword({ email, password });
}

async function portalGetSession() {
  const { data: { session } } = await db.auth.getSession();
  return session;
}

async function portalSignOut() {
  return await db.auth.signOut();
}

function portalOnAuthChange(cb) {
  return db.auth.onAuthStateChange(cb);
}

async function portalSendPasswordReset(email) {
  return await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/portal',
  });
}

async function resolveMyAthleteId() {
  const { data, error } = await db
    .from('athlete_accounts')
    .select('athlete_id')
    .single();
  if (error) throw error;
  return data.athlete_id;
}

async function loadPortalData(athleteId) {
  const [athleteRes, compsRes, attRes] = await Promise.all([
    db.from('athlete_portal_view').select('*').eq('id', athleteId).single(),
    db.from('competition_results').select('*').eq('athlete_id', athleteId).order('result_date'),
    db.rpc('get_my_attendance'),
  ]);

  if (athleteRes.error) throw athleteRes.error;

  return {
    athlete: athleteRes.data,
    comps: compsRes.data || [],
    attendance: attRes.data || [],
  };
}
