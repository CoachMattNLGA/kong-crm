// api/stripe-webhook.js
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

function getRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

function toDateString(epochSeconds) {
    if (!epochSeconds) return null;
    return new Date(epochSeconds * 1000).toISOString().split('T')[0];
}

const handler = async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !process.env.STRIPE_SECRET_KEY || !WEBHOOK_SECRET) {
        res.status(500).send('Server is missing required environment variables.');
        return;
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const rawBody = await getRawBody(req);
    const signature = req.headers['stripe-signature'];

    let event;
    try {
        event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        res.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    // Idempotency — Stripe may redeliver the same event.
    const { error: dupeErr } = await admin
        .from('stripe_webhook_events')
        .insert({ event_id: event.id });

    if (dupeErr) {
        if (dupeErr.code === '23505') {
            // Postgres unique_violation — this event was genuinely already processed.
            res.status(200).json({ received: true, duplicate: true });
            return;
        }
        // Any other error (bad service role key, RLS denial, network issue, etc.)
        // is a real failure — log it loudly and tell Stripe to retry, don't
        // silently pretend success.
        console.error('stripe_webhook_events insert failed (not a duplicate):', dupeErr);
        res.status(500).json({ error: 'Could not record webhook event.', detail: dupeErr.message });
        return;
    }

    try {
        switch (event.type) {

            case 'checkout.session.completed': {
                const session = event.data.object;
                const athleteId = session.metadata && session.metadata.athlete_id;
                if (athleteId) {
                    await admin.from('athletes').update({
                        stripe_customer_id: session.customer,
                        stripe_subscription_id: session.subscription,
                        payment_status: 'active',
                        last_payment_date: toDateString(Math.floor(Date.now() / 1000)),
                    }).eq('id', athleteId);
                }
                break;
            }

            case 'invoice.payment_succeeded': {
                const invoice = event.data.object;
                const customerId = invoice.customer;
                const periodEnd = invoice.lines && invoice.lines.data && invoice.lines.data[0]
                    ? invoice.lines.data[0].period.end
                    : null;
                await admin.from('athletes').update({
                    payment_status: 'active',
                    last_payment_date: toDateString(invoice.status_transitions?.paid_at || Math.floor(Date.now() / 1000)),
                    next_payment_due: toDateString(periodEnd),
                }).eq('stripe_customer_id', customerId);
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                await admin.from('athletes').update({
                    payment_status: 'overdue',
                }).eq('stripe_customer_id', invoice.customer);
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                await admin.from('athletes').update({
                    payment_status: 'cancelled',
                }).eq('stripe_customer_id', subscription.customer);
                break;
            }

            default:
                // Unhandled event type — acknowledged, no action taken.
                break;
        }

        res.status(200).json({ received: true });
    } catch (err) {
        console.error('Webhook processing error:', err);
        res.status(500).json({ error: 'Webhook processing failed.' });
    }
};

handler.config = { api: { bodyParser: false } };
module.exports = handler;