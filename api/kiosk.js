// api/kiosk.js
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KIOSK_CODE = process.env.KIOSK_CODE;

const MAX_BODY_BYTES = 2048;
const UNAUTHORIZED_DELAY_MS = 700;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sendJson(res, status, payload) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(status).json(payload);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timingSafeCodeEqual(provided, expected) {
  const providedHash = crypto
    .createHash('sha256')
    .update(typeof provided === 'string' ? provided : '', 'utf8')
    .digest();
  const expectedHash = crypto
    .createHash('sha256')
    .update(typeof expected === 'string' ? expected : '', 'utf8')
    .digest();

  return crypto.timingSafeEqual(providedHash, expectedHash);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function bodyTooLarge(req) {
  const rawLength = req.headers['content-length'];

  if (rawLength !== undefined) {
    const length = Number(rawLength);
    if (!Number.isFinite(length) || length < 0 || length > MAX_BODY_BYTES) {
      return true;
    }
  }

  try {
    return Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8') > MAX_BODY_BYTES;
  } catch (err) {
    return true;
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }

    if (typeof KIOSK_CODE !== 'string' || KIOSK_CODE.length < 24) {
      sendJson(res, 500, { error: 'kiosk not configured' });
      return;
    }

    const providedCode =
      typeof req.headers['x-kiosk-code'] === 'string'
        ? req.headers['x-kiosk-code']
        : '';

    if (!timingSafeCodeEqual(providedCode, KIOSK_CODE)) {
      await delay(UNAUTHORIZED_DELAY_MS);
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    if (bodyTooLarge(req)) {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }

    const body = req.body;
    if (!isPlainObject(body) || typeof body.action !== 'string') {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error('kiosk: missing Supabase environment variables');
      sendJson(res, 500, { error: 'server_error' });
      return;
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (body.action === 'roster') {
      const { data, error } = await admin.rpc('kiosk_roster');

      if (error || !Array.isArray(data)) {
        console.error(
          'kiosk roster failed:',
          error && error.code ? error.code : 'unexpected response'
        );
        sendJson(res, 502, { error: 'server_error' });
        return;
      }

      const athletes = data
        .filter((row) => row && typeof row.athlete_id === 'string')
        .map((row) => ({
          id: row.athlete_id,
          first_name: typeof row.first_name === 'string' ? row.first_name : '',
          last_initial:
            typeof row.last_initial === 'string' ? row.last_initial : '',
        }));

      sendJson(res, 200, { athletes });
      return;
    }

    if (body.action === 'check_in') {
      if (
        typeof body.athlete_id !== 'string' ||
        !UUID_RE.test(body.athlete_id)
      ) {
        sendJson(res, 400, { error: 'bad_request' });
        return;
      }

      const { data, error } = await admin.rpc('kiosk_check_in', {
        p_athlete_id: body.athlete_id,
      });

      if (error) {
        const message = typeof error.message === 'string' ? error.message : '';

        if (message.startsWith('ATHLETE_NOT_FOUND')) {
          sendJson(res, 404, { error: 'not_found' });
          return;
        }

        if (message.startsWith('INACTIVE_ATHLETE')) {
          sendJson(res, 403, { error: 'inactive' });
          return;
        }

        console.error('kiosk check-in failed:', error.code || 'rpc_error');
        sendJson(res, 502, { error: 'server_error' });
        return;
      }

      let row = null;
      if (Array.isArray(data)) {
        row = data[0];
      } else if (data && typeof data === 'object') {
        row = data;
      }

      if (!row || typeof row.first_name !== 'string') {
        console.error('kiosk check-in failed: unexpected response');
        sendJson(res, 502, { error: 'server_error' });
        return;
      }

      sendJson(res, 200, {
        first_name: row.first_name,
        already_checked_in: row.already_checked_in === true,
      });
      return;
    }

    sendJson(res, 400, { error: 'bad_request' });
  } catch (err) {
    console.error(
      'kiosk endpoint error:',
      err && err.name ? err.name : 'unknown'
    );

    if (!res.headersSent) {
      sendJson(res, 500, { error: 'server_error' });
    }
  }
};
