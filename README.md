# KONG CRM — Developer Handoff

## Project Overview
Custom athlete management CRM for No Limits Grappling Academy (NLGA).
Built for one coach, one gym. Frontend is fully complete.

## Files
- `index.html` — Full application markup, all pages and modals
- `styles.css`  — All styles, CSS variables, responsive layout
- `app.js`      — All application logic, data structures, localStorage persistence
- `assets/`     — Place gorilla logo PNG here as `gorilla.png`

## What's Built (Frontend — Complete)
- Dashboard with stats, roster, attendance bars, event calendar, win/loss, activity log
- Athletes page with active/inactive filter tabs and search
- Athlete profiles with photo upload, belt promotion, rank history
- Contact info (email, phone, full address, age, weight, weight class)
- Time at NLGA — auto-calculated from sinceISO field
- Attendance logging with session type and athlete checklist
- Competition records (gold/silver/bronze/loss)
- Events management
- Coach notes with add, edit, delete
- Inactive status system with reasons: Injury, Moved away, Quit, School, Sports Season
- Reactivation from inactive

## What Needs to Be Built (Backend)
See full developer brief PDF for complete schema.

### 1. Supabase Auth
- Email/password login only
- Protected routes — redirect to login if no session
- Persist session across browser refreshes

### 2. Supabase Database Tables

**athletes**
```
id, first_name, last_name, belt, background, email, phone,
street, city, statzip, age, weight, wclass,
since (display string), since_iso (YYYY-MM-DD for time calculation),
photo_url, sessions, wins, losses, status,
inactive_reason, inactive_notes, inactive_since,
history (jsonb), notes (jsonb), skills (jsonb),
created_at
```

**att_log (attendance)**
```
id, session_date, session_date_raw (ISO), session_type,
athlete_ids (integer[]), created_at
```

**comps (competition results)**
```
id, event_name, athlete_id (FK), division,
result_date, place (1/2/3/loss), created_at
```

**events**
```
id, event_name, event_date, location, created_at
```

**act_log (activity log)**
```
id, text, time_str, created_at
```

### 3. Storage
- Athlete profile photos → Supabase Storage bucket `athlete-photos`
- Store public URL in athletes.photo_url
- Replace base64 photo storage in app.js with URL references

### 4. Deployment
- Deploy to Vercel
- Connect domain: kongcrm.com (DNS managed in Cloudflare)
- Set environment variables: SUPABASE_URL, SUPABASE_ANON_KEY

## Migration Notes
In `app.js`, the `S.get()` / `S.set()` storage calls are clearly marked.
Replace these with Supabase queries. All data structures are documented
in the DEFAULT DATA section of app.js.

The `timeAtNLGA(sinceISO)` function (line ~100 of app.js) calculates
time display from the ISO date field — no changes needed, just ensure
`since_iso` is saved to the database and passed back correctly.

## Colors
- Purple: #B549B6
- Background: #f4f4f4
- Sidebar: #0d0d0d
- Cards: #ffffff

## Fonts (Google Fonts — already linked in index.html)
- Bebas Neue (headers)
- Barlow (body)
- Barlow Condensed (labels, nav)

## Questions
Contact Matt Marcinek via Fiverr message thread.
