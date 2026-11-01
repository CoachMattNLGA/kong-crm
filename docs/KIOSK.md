# KONG iPad Check-In Kiosk

The kiosk is a shared iPad page where an athlete searches for their name and taps
it to check in. It does not use a coach or athlete login. The iPad talks only to
the same-origin serverless endpoint `POST /api/kiosk`; that endpoint holds the
Supabase service role key and calls the `kiosk_roster()` and
`kiosk_check_in(p_athlete_id uuid)` RPCs.

The database decides the gym date. The page and the endpoint never calculate or
send a date.

## Files

| File | Purpose |
| --- | --- |
| `api/kiosk.js` | Same-origin endpoint. Validates `x-kiosk-code`, calls the two service-role-only RPCs, and maps errors. |
| `kiosk.html` | Kiosk page markup. Contains no secrets and no athlete data. |
| `kiosk.js` | Kiosk UI logic (setup, roster, search, confirmation, result, reset). |
| `kiosk.css` | Kiosk-only styles and iPad layout. |
| `docs/KIOSK.md` | This document. |

Routes:

- `/kiosk` and `/kiosk.html` serve the page (see `vercel.json`).
- `POST /api/kiosk` is the only endpoint action.

## Environment Variables

Set these in Vercel (Production, and Preview if you test there) and in an
untracked `.env.local` for local testing:

| Variable | Required by | Notes |
| --- | --- | --- |
| `KIOSK_CODE` | `api/kiosk.js` | Shared staff secret. Minimum 24 characters. Generate a fresh random value. Never put it in HTML, JS, a URL, a screenshot, or git. |
| `SUPABASE_URL` | `api/kiosk.js` | The Supabase project URL, for example `https://<project-ref>.supabase.co`. Use the **test** project locally. |
| `SUPABASE_SERVICE_ROLE_KEY` | `api/kiosk.js` | Server-only service role key. Never expose it to the browser. Use the **test** project locally. |

The kiosk page itself does not need `SUPABASE_ANON_KEY`; the endpoint uses the
service role key. The dashboard and athlete portal have their own existing
configuration.

If `KIOSK_CODE` is missing or shorter than 24 characters, the endpoint refuses
every POST with HTTP 500 `{ "error": "kiosk not configured" }`. It never runs
open. A wrong or missing `x-kiosk-code` returns HTTP 401 after about 700 ms with
no detail.

`.env.local` is covered by `.gitignore`. Never commit it, and never commit a real
`KIOSK_CODE`.

## Generate a Kiosk Code

Run this once for test and once for production. Do not reuse the same value.

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

The output is a 32-character base64url string. It is long enough for the
endpoint's 24-character minimum. Treat it like a password. Do not add spaces or
newlines around the value when pasting it into Vercel or `.env.local`; the
comparison is exact and case-sensitive.

## Local Testing Against a TEST Supabase Project

Do not test against production keys. Use a separate Supabase project with
migration 9 (`20261031140000_kiosk_check_in.sql`) applied.

> The repository may already contain an untracked `.env.local` with production
> values. Do not overwrite it blindly. The safest approach is a separate clone or
> worktree for testing, with its own `.env.local`. If you must reuse this
> checkout, back up the existing file outside the repo first and restore it
> afterwards.

Create or edit `.env.local` in the project root:

```dotenv
SUPABASE_URL=https://<test-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<test-service-role-key>
KIOSK_CODE=<test-kiosk-code>
```

Start the Vercel dev server from the repository root:

```powershell
npx vercel dev
```

If the CLI is not linked to a project yet, run `npx vercel link` first and
choose the **test** project. Do not run `vercel dev` in a checkout linked to the
production project. If port 3000 is busy:

```powershell
npx vercel dev --listen 3001
```

Open:

```text
http://localhost:3000/kiosk
```

`vercel dev` loads `.env.local` and serves both the static page and
`/api/kiosk`. The plain `npm run dev` command (`http-server`) does **not** serve
the serverless endpoint, so use `vercel dev` for kiosk testing.

On Windows, if PowerShell blocks `npx.ps1`, use:

```powershell
npx.cmd vercel dev
```

or run it from Command Prompt:

```bat
npx vercel dev
```

Stop the server with `Ctrl+C`.

### Endpoint Test Helper (PowerShell)

These snippets use a placeholder code. Replace `<KIOSK_CODE_PLACEHOLDER>` only
in your local terminal; never paste a real code into a commit, ticket, or chat.

```powershell
$BaseUrl = 'http://localhost:3000'

function Invoke-Kiosk {
    param(
        [Parameter(Mandatory = $true)][string]$Action,
        [string]$AthleteId,
        [string]$KioskCode = '<KIOSK_CODE_PLACEHOLDER>',
        [switch]$NoCode
    )

    $headers = @{}
    if (-not $NoCode) {
        $headers['x-kiosk-code'] = $KioskCode
    }

    $payload = @{ action = $Action }
    if ($AthleteId) {
        $payload['athlete_id'] = $AthleteId
    }

    try {
        $result = Invoke-RestMethod `
            -Uri "$BaseUrl/api/kiosk" `
            -Method Post `
            -Headers $headers `
            -ContentType 'application/json' `
            -Body ($payload | ConvertTo-Json -Compress) `
            -ErrorAction Stop

        Write-Output 'HTTP 200'
        $result | ConvertTo-Json -Depth 6
    }
    catch {
        $status = [int]$_.Exception.Response.StatusCode
        $body = $_.ErrorDetails.Message
        if (-not $body) {
            $body = $_.Exception.Message
        }
        Write-Output "HTTP $status"
        Write-Output $body
    }
}
```

Run the endpoint cases:

```powershell
# Roster (valid code)
Invoke-Kiosk -Action roster -KioskCode '<KIOSK_CODE_PLACEHOLDER>'

# Wrong code (expect 401 after ~700 ms)
Invoke-Kiosk -Action roster -KioskCode 'definitely-wrong'

# No code (expect 401 after ~700 ms)
Invoke-Kiosk -Action roster -NoCode

# Unknown action (expect 400)
Invoke-Kiosk -Action nonsense -KioskCode '<KIOSK_CODE_PLACEHOLDER>'

# Invalid UUID (expect 400, no RPC call)
Invoke-Kiosk -Action check_in -AthleteId 'not-a-uuid' -KioskCode '<KIOSK_CODE_PLACEHOLDER>'

# First check-in for an active test athlete (expect already_checked_in = false)
Invoke-Kiosk -Action check_in -AthleteId '<ACTIVE_ATHLETE_UUID>' -KioskCode '<KIOSK_CODE_PLACEHOLDER>'

# Same athlete again (expect already_checked_in = true; UI shows amber)
Invoke-Kiosk -Action check_in -AthleteId '<ACTIVE_ATHLETE_UUID>' -KioskCode '<KIOSK_CODE_PLACEHOLDER>'

# Inactive test athlete (expect 403 inactive)
Invoke-Kiosk -Action check_in -AthleteId '<INACTIVE_ATHLETE_UUID>' -KioskCode '<KIOSK_CODE_PLACEHOLDER>'

# Valid UUID that does not exist (expect 404 not_found)
Invoke-Kiosk -Action check_in -AthleteId '11111111-1111-4111-8111-111111111111' -KioskCode '<KIOSK_CODE_PLACEHOLDER>'
```

Additional endpoint checks:

```powershell
# GET is not allowed (expect 405)
try {
    Invoke-RestMethod -Uri "$BaseUrl/api/kiosk" -Method Get -ErrorAction Stop
}
catch {
    "HTTP $([int]$_.Exception.Response.StatusCode) $($_.ErrorDetails.Message)"
}

# Malformed JSON (expect 400)
try {
    Invoke-RestMethod -Uri "$BaseUrl/api/kiosk" -Method Post `
        -Headers @{ 'x-kiosk-code' = '<KIOSK_CODE_PLACEHOLDER>' } `
        -ContentType 'application/json' `
        -Body '{not-json' `
        -ErrorAction Stop
}
catch {
    "HTTP $([int]$_.Exception.Response.StatusCode) $($_.ErrorDetails.Message)"
}

# Oversized body (expect 400)
$big = '{"action":"roster","padding":"' + ('x' * 3000) + '"}'
try {
    Invoke-RestMethod -Uri "$BaseUrl/api/kiosk" -Method Post `
        -Headers @{ 'x-kiosk-code' = '<KIOSK_CODE_PLACEHOLDER>' } `
        -ContentType 'application/json' `
        -Body $big `
        -ErrorAction Stop
}
catch {
    "HTTP $([int]$_.Exception.Response.StatusCode) $($_.ErrorDetails.Message)"
}
```

To check response headers (PowerShell 7+):

```powershell
$r = Invoke-WebRequest -Uri "$BaseUrl/api/kiosk" -Method Post `
    -Headers @{ 'x-kiosk-code' = '<KIOSK_CODE_PLACEHOLDER>' } `
    -ContentType 'application/json' `
    -Body '{"action":"roster"}' `
    -SkipHttpErrorCheck

$r.Headers['Cache-Control']            # should be no-store
$r.Headers['Access-Control-Allow-Origin']  # should be empty
```

## iPad Setup

1. Connect the iPad to the gym Wi-Fi and keep it on the charger.
2. Open Safari and go to `https://<production-domain>/kiosk`.
3. Enter the kiosk code on the staff setup screen. The page validates it by
   loading the roster; on success the code is stored in `localStorage` under
   `kong-kiosk-code`.
4. Tap **Share** → **Add to Home Screen**. Name it **KONG Check-In**.
5. Open the kiosk from the new home-screen icon (standalone mode).
6. Enable Guided Access:
   - **Settings → Accessibility → Guided Access → On**.
   - Set a Guided Access passcode.
   - Open the kiosk, then triple-click the side button (or home button) to start
     Guided Access.
   - Optionally disable hardware buttons and set **Display Auto-Lock** to
     **Never** in Guided Access options.
7. Set **Settings → Display & Brightness → Auto-Lock → Never** while the iPad
   is charging. Guided Access can also enforce this.
8. Consider enabling Do Not Disturb / a Focus mode so notifications do not cover
   the kiosk.

Guided Access is the real device lock. The kiosk code is a shared staff secret,
not a substitute for device security.

### Staff Reset on the iPad

Press and hold the KONG logo in the header for **5 seconds**, then confirm
**Reset kiosk**. This removes the saved code from `localStorage` and returns to
the staff setup screen. It does not change the server-side `KIOSK_CODE`.

## Rotating the Code

1. Generate a new code with the `node` command above.
2. In Vercel: **Project → Settings → Environment Variables → `KIOSK_CODE`**.
   Update the Production value (and Preview if used).
3. Redeploy. Vercel environment variable changes apply to new deployments; an
   existing deployment keeps the old value until redeployed.
4. On each iPad, the next roster refresh or check-in receives HTTP 401. The page
   clears the stored code and returns to the staff setup screen. Enter the new
   code once per iPad.
5. To force the change immediately, reload the kiosk page after the redeploy.

If an iPad is lost or stolen:

- Rotate `KIOSK_CODE` immediately and redeploy. The old code stops working on
  the next request.
- Use Find My / your MDM to lock or erase the device.
- Remove it from the gym Wi-Fi / MDM if applicable.
- An offline iPad cannot check anyone in, but it may still show the last roster
  in memory until it is reloaded or the page is closed.
- The kiosk endpoint exposes only active athlete first names and last initials
  and can only create check-ins. It does not expose contact details, notes,
  payments, or the dashboard. Rotate the code anyway.

## Production Checklist

- [ ] Apply database migration 9 to the **production** Supabase project first.
      The migration is `supabase/migrations/20261031140000_kiosk_check_in.sql`
      in the mobile repository. It creates `kiosk_roster()` and
      `kiosk_check_in(uuid)` and grants execute only to `service_role`.
- [ ] Confirm the production Supabase project has `SUPABASE_URL` and
      `SUPABASE_SERVICE_ROLE_KEY` set in Vercel.
- [ ] Generate a production-only `KIOSK_CODE` (at least 24 characters) and set
      it in Vercel Production.
- [ ] Deploy the web repo (`vercel --prod`, or push the production branch).
- [ ] Open `/kiosk` in Safari and enter the code.
- [ ] Test with one real athlete, with their knowledge: tap their name, confirm,
      verify the green welcome screen, and verify the check-in appears in the
      coach dashboard.
- [ ] Tap the same athlete again the same day and verify the calm amber
      "already checked in" screen.
- [ ] Add to Home Screen, enable Guided Access, set Auto-Lock to Never while
      charging, and confirm the page works in landscape and portrait.
- [ ] Keep a copy of the current code in your password manager, not in the repo.

## Manual Test Table

| # | Case | How | Expected |
| --- | --- | --- | --- |
| 1 | Wrong kiosk code | `Invoke-Kiosk -Action roster -KioskCode 'wrong'` | HTTP 401 `{ "error": "unauthorized" }` after about 700 ms; no detail. |
| 2 | Missing kiosk code | `Invoke-Kiosk -Action roster -NoCode` | HTTP 401 `{ "error": "unauthorized" }` after about 700 ms. |
| 3 | Bad action | `Invoke-Kiosk -Action nonsense ...` | HTTP 400 `{ "error": "bad_request" }`. |
| 4 | Invalid UUID | `Invoke-Kiosk -Action check_in -AthleteId 'not-a-uuid' ...` | HTTP 400 `{ "error": "bad_request" }`; RPC is not called. |
| 5 | Malformed JSON | Post `{not-json` | HTTP 400 fixed JSON error. |
| 6 | Wrong method | `GET /api/kiosk` | HTTP 405 fixed JSON error; `Allow: POST`. |
| 7 | Oversized body | Send more than 2048 bytes | HTTP 400 `{ "error": "bad_request" }`. |
| 8 | Roster | `Invoke-Kiosk -Action roster ...` | HTTP 200 `{ "athletes": [...] }`; only `id`, `first_name`, `last_initial`; active athletes only. |
| 9 | First check-in | Check in an active test athlete | HTTP 200 `{ "first_name": "...", "already_checked_in": false }`; green "Welcome, ...!" screen; dashboard attendance updated. |
| 10 | Second check-in same day | Repeat the same check-in | HTTP 200 `already_checked_in: true`; calm amber "You're already checked in today, ..." screen. Not an error. |
| 11 | Inactive athlete | Use an inactive athlete UUID | HTTP 403 `{ "error": "inactive" }`; UI "Please see your coach." |
| 12 | Unknown athlete | Use a valid but unknown UUID | HTTP 404 `{ "error": "not_found" }`; UI generic error. |
| 13 | Offline | Stop `vercel dev`, turn off Wi-Fi, or use airplane mode, then tap a tile and Yes | UI "No connection. Please try again." No technical detail. |
| 14 | 401 at any time | Rotate the code, or corrupt the stored code, then refresh/check in | Stored code is cleared; page returns to staff setup. |
| 15 | Setup: wrong code | Enter a wrong code on the setup screen | Stays on setup; "Incorrect kiosk code. Try again." No athlete data shown. |
| 16 | Setup: correct code | Enter the valid code | Grid appears; code stored in `localStorage`; no code in the URL or HTML. |
| 17 | Search | Type part of a first name or "First L." | Tiles filter immediately; empty state appears when nothing matches. |
| 18 | Confirmation timeout | Open a tile and wait 10 seconds | Confirmation closes by itself; no check-in is sent. |
| 19 | 60-second inactivity | Open a confirmation or type a search, then wait 60 seconds | Search is cleared and any confirmation is closed; the grid returns to the full roster. |
| 20 | Roster refresh | Leave the kiosk open for 5 minutes, or switch away and back | Roster refreshes; search stays usable; old list is kept if refresh fails. |
| 21 | Double-tap Yes | Tap Yes twice quickly | Only one `check_in` request; tiles and Yes are disabled while busy. |
| 22 | Long-press reset | Hold the KONG logo 5 seconds, confirm | Stored code is removed; setup screen appears. |
| 23 | Result duration | Complete a check-in or trigger an error | Result screen shows for about 4 seconds, then returns to the grid with the search cleared. |
| 24 | Landscape / portrait | Rotate the iPad | Layout remains usable; search and tiles fit; no horizontal scrolling. |
| 25 | No-store / no CORS | Inspect endpoint headers | `Cache-Control: no-store`; no `Access-Control-Allow-Origin` wildcard. |
| 26 | Missing config | Remove or shorten `KIOSK_CODE`, redeploy/test | Every POST returns HTTP 500 `{ "error": "kiosk not configured" }`; no roster or check-in data. |

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| HTTP 500 `kiosk not configured` | `KIOSK_CODE` is missing or shorter than 24 characters. | Set a new value in Vercel and redeploy. For local testing, set it in `.env.local` and restart `vercel dev`. |
| HTTP 401 on every request | Wrong code, rotated code, or the iPad has an old stored code. | Re-enter the current code. If it was just rotated, reload after the redeploy. |
| HTTP 502 `server_error` | Supabase URL/service role key missing or wrong, migration not applied, or RPC/grant problem. | Check Vercel logs (no secrets are logged), confirm migration 9 is applied, and confirm the functions are granted to `service_role` only. |
| HTTP 404 `not_found` | Roster is stale or the athlete was deleted/unknown. | Refresh the roster; the next 5-minute refresh or page visibility refresh will update it. |
| HTTP 403 `inactive` | The athlete is inactive in the database. | Reactivate them in the dashboard if appropriate. |
| "No connection" on the iPad | Wi-Fi/Vercel/API unreachable, or the request timed out. | Check Wi-Fi and the deployment; tap Try again or reload. |
| `/kiosk` returns the dashboard or 404 | Route rewrite missing or the deployment is old. | Confirm `vercel.json` has the `/kiosk` rewrites and redeploy. `/kiosk.html` also works. |
| Blank grid with "No active athletes found" | No active athletes, or the test project has no data. | Check the roster in the test project. |
| Setup loops after entering the code | Safari storage is blocked (for example Private Browsing), or the code is wrong. | Use normal Safari, allow website data, and re-enter the code. |
| Add to Home Screen opens the wrong page | The home-screen shortcut points at an old URL. | Delete the icon and add `https://<domain>/kiosk` again. |
| iPad sleeps or shows notifications | Auto-Lock / notifications are not controlled. | Set Auto-Lock to Never while charging, enable Guided Access, and use Do Not Disturb / Focus. |
| `npx` is blocked by PowerShell | Execution policy blocks `npx.ps1`. | Use `npx.cmd vercel dev` or run from Command Prompt. |
| `vercel dev` serves the page but `/api/kiosk` is 404 | Wrong working directory or the function file is missing. | Run from the repo root and confirm `api/kiosk.js` exists. |
| Fonts look different | Google Fonts blocked or offline. | The page falls back to system fonts; connect the iPad to the network for the intended look. |

## Security Notes

- The service role key never reaches the browser. The kiosk page calls only
  `/api/kiosk`.
- No wildcard CORS headers are sent. Serve the page from the same Vercel origin.
- The endpoint returns only athlete `id`, `first_name`, `last_initial`, and
  check-in status. It never returns raw Supabase errors.
- Wrong/missing codes are compared with SHA-256 plus `crypto.timingSafeEqual`
  and delayed by about 700 ms. There is no in-memory rate limiter because
  serverless functions are stateless.
- Responses use `Cache-Control: no-store`.
- The kiosk page has no links to the dashboard or portal, has `noindex`, and
  disables zoom, text selection on tiles, and the tile context menu.
- `localStorage` holds the kiosk code on the iPad. Clearing website data or using
  the staff reset removes it. Rotate the code if the iPad is lost or stolen.
- The database functions are callable only by `service_role`; do not grant them
  to `anon` or `authenticated`.
