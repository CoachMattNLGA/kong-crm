// api/invite-athlete.js
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL = process.env.SITE_URL;
const ANON_KEY = 'sb_publishable_aN3U9D-AYzcqXIDoTEwNHw_BSZow8Ah';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SITE_URL) {
    res.status(500).json({ error: 'Server is missing required environment variables.' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Missing Authorization header.' });
    return;
  }

  const { athleteId } = req.body || {};
  if (!athleteId) {
    res.status(400).json({ error: 'athleteId is required.' });
    return;
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const redirectTo = `${SITE_URL}/portal`;

  const { data: callerData, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !callerData || !callerData.user) {
    res.status(401).json({ error: 'Invalid or expired session.' });
    return;
  }

  const { data: callerLink } = await admin
    .from('athlete_accounts')
    .select('id')
    .eq('auth_user_id', callerData.user.id)
    .maybeSingle();

  if (callerLink) {
    res.status(403).json({ error: 'Only coaches can send portal invites.' });
    return;
  }

  const { data: athlete, error: athleteErr } = await admin
    .from('athletes')
    .select('id, first, last, email')
    .eq('id', athleteId)
    .single();

  if (athleteErr || !athlete) {
    res.status(404).json({ error: 'Athlete not found.' });
    return;
  }

  if (!athlete.email) {
    res.status(400).json({ error: `${athlete.first} ${athlete.last} has no email on file. Add one before sending a portal invite.` });
    return;
  }

  const { data: existingLink } = await admin
    .from('athlete_accounts')
    .select('id')
    .eq('athlete_id', athleteId)
    .maybeSingle();

  // ── Already linked: resend a fresh sign-in/password-set link ──
  if (existingLink) {
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { error: resendErr } = await anon.auth.resetPasswordForEmail(athlete.email, { redirectTo });

    if (resendErr) {
      res.status(500).json({ error: resendErr.message });
      return;
    }

    res.status(200).json({ success: true, resent: true, email: athlete.email });
    return;
  }

  // ── First-time invite ──
  const { data: inviteData, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    athlete.email,
    { redirectTo }
  );

  if (inviteErr || !inviteData || !inviteData.user) {
    const msg = inviteErr ? inviteErr.message : 'Could not send invite email.';
    if (/already registered|already exists/i.test(msg)) {
      res.status(409).json({
        error: `An account for ${athlete.email} already exists but isn't linked to this athlete. In Supabase → Authentication → Users, find and delete that user, then try inviting again.`,
      });
      return;
    }
    res.status(500).json({ error: msg });
    return;
  }

  const { error: linkErr } = await admin
    .from('athlete_accounts')
    .insert({ auth_user_id: inviteData.user.id, athlete_id: athleteId });

  if (linkErr) {
    res.status(500).json({
      error: 'Invite email was sent, but linking the account failed. Contact support — do not send another invite.',
      detail: linkErr.message,
    });
    return;
  }

  res.status(200).json({ success: true, resent: false, email: athlete.email });
};