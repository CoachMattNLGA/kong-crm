// api/create-checkout-session.js
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL = process.env.SITE_URL;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const PRICE_ID = process.env.STRIPE_PRICE_ID;

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SITE_URL || !process.env.STRIPE_SECRET_KEY || !PRICE_ID) {
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
        res.status(403).json({ error: 'Only coaches can create payment links.' });
        return;
    }

    const { data: athlete, error: athleteErr } = await admin
        .from('athletes')
        .select('id, first, last, email, stripe_customer_id')
        .eq('id', athleteId)
        .single();

    if (athleteErr || !athlete) {
        res.status(404).json({ error: 'Athlete not found.' });
        return;
    }

    if (!athlete.email) {
        res.status(400).json({ error: `${athlete.first} ${athlete.last} has no email on file. Add one before sending a payment link.` });
        return;
    }

    try {
        const sessionParams = {
            mode: 'subscription',
            line_items: [{ price: PRICE_ID, quantity: 1 }],
            client_reference_id: athlete.id,
            metadata: { athlete_id: athlete.id },
            subscription_data: { metadata: { athlete_id: athlete.id } },
            success_url: `${SITE_URL}/?billing=success`,
            cancel_url: `${SITE_URL}/?billing=cancelled`,
        };

        if (athlete.stripe_customer_id) {
            sessionParams.customer = athlete.stripe_customer_id;
        } else {
            sessionParams.customer_email = athlete.email;
        }

        const checkoutSession = await stripe.checkout.sessions.create(sessionParams);

        res.status(200).json({ url: checkoutSession.url });
    } catch (err) {
        console.error('Stripe checkout session error:', err);
        res.status(500).json({ error: err.message || 'Could not create checkout session.' });
    }
};