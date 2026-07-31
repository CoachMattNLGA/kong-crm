import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = process.env.SUPABASE_URL || 'https://huguxargfxryyhavjxqy.supabase.co';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_aN3U9D-AYzcqXIDoTEwNHw_BSZow8Ah';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY missing in server environment' });
  }

  // Client to verify coach caller
  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: { user }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !user) {
    return res.status(401).json({ error: 'Unauthorized caller' });
  }

  // Check coach status: user must NOT be in athlete_accounts
  const { data: isAthlete } = await callerClient
    .from('athlete_accounts')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (isAthlete) {
    return res.status(403).json({ error: 'Only coaches can invite athletes' });
  }

  const { email, athleteId } = req.body || {};
  if (!email || !athleteId) {
    return res.status(400).json({ error: 'Email and athleteId are required' });
  }

  // Admin client to trigger invite & update database
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const origin = req.headers.origin || 'https://kongcrm.com';
  const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/portal`
  });

  if (inviteErr) {
    return res.status(400).json({ error: inviteErr.message });
  }

  const invitedUserId = inviteData.user.id;

  const { error: linkErr } = await adminClient
    .from('athlete_accounts')
    .insert({
      auth_user_id: invitedUserId,
      athlete_id: athleteId
    });

  if (linkErr) {
    return res.status(500).json({ error: 'User invited but failed to create athlete link: ' + linkErr.message });
  }

  return res.status(200).json({ success: true, userId: invitedUserId });
}
