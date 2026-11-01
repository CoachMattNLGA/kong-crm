/* ── KONG CRM — kiosk.js ─── iPad name-selection check-in ──
 * The kiosk code lives only in localStorage and is sent to the
 * same-origin /api/kiosk endpoint. No Supabase client is used here.
 * ─────────────────────────────────────────────────────────── */

'use strict';

const STORAGE_KEY = 'kong-kiosk-code';
const API_URL = '/api/kiosk';

const ROSTER_REFRESH_MS = 5 * 60 * 1000;
const CONFIRM_TIMEOUT_MS = 10 * 1000;
const RESULT_TIMEOUT_MS = 4 * 1000;
const INACTIVITY_TIMEOUT_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 12 * 1000;
const LONG_PRESS_MS = 5000;

let kioskCode = null;
let roster = [];
let rosterLoading = false;
let busy = false;
let selectedAthlete = null;

let confirmTimer = null;
let resultTimer = null;
let inactivityTimer = null;
let statusTimer = null;
let statusToken = 0;
let rosterRequestToken = 0;
let longPressTimer = null;
let lastRenderedQuery = null;

const el = {};

/* ── DOM HELPERS ──────────────────────────────────────── */
function cacheDom() {
  el.kioskApp = document.getElementById('kiosk-app');
  el.kioskBrand = document.getElementById('kiosk-brand');
  el.setupScreen = document.getElementById('setup-screen');
  el.setupInput = document.getElementById('kiosk-code');
  el.setupError = document.getElementById('setup-error');
  el.saveCodeBtn = document.getElementById('btn-save-code');
  el.rosterScreen = document.getElementById('roster-screen');
  el.searchInput = document.getElementById('athlete-search');
  el.rosterStatus = document.getElementById('roster-status');
  el.rosterScroll = document.getElementById('roster-scroll');
  el.rosterGrid = document.getElementById('roster-grid');
  el.rosterEmpty = document.getElementById('roster-empty');

  el.confirmOverlay = document.getElementById('confirm-overlay');
  el.confirmTitle = document.getElementById('confirm-title');
  el.confirmYes = document.getElementById('btn-confirm-yes');
  el.confirmCancel = document.getElementById('btn-confirm-cancel');

  el.resetOverlay = document.getElementById('reset-overlay');
  el.resetConfirm = document.getElementById('btn-reset-confirm');
  el.resetCancel = document.getElementById('btn-reset-cancel');

  el.resultOverlay = document.getElementById('result-overlay');
  el.resultCard = document.getElementById('result-card');
  el.resultIcon = document.getElementById('result-icon');
  el.resultMessage = document.getElementById('result-message');
}

function setSetupError(message) {
  el.setupError.textContent = message || '';
}

function setSetupBusy(value) {
  el.setupInput.disabled = value;
  el.saveCodeBtn.disabled = value;
  el.saveCodeBtn.textContent = value ? 'Checking…' : 'Start kiosk';
}

function setSearchEnabled(value) {
  el.searchInput.disabled = !value;
}

function setRosterStatus(message, withRetry) {
  clearTimeout(statusTimer);
  statusTimer = null;
  statusToken += 1;
  const token = statusToken;

  el.rosterStatus.textContent = '';

  if (!message) {
    return;
  }

  const text = document.createElement('span');
  text.textContent = message;
  el.rosterStatus.appendChild(text);

  if (withRetry) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn-link';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => {
      loadRoster({ initial: true });
    });
    el.rosterStatus.appendChild(retry);
  }

  return token;
}

function setTransientStatus(message, ms) {
  const token = setRosterStatus(message, false);
  statusTimer = setTimeout(() => {
    if (statusToken === token) {
      setRosterStatus('');
    }
  }, ms);
}

function setBusy(value) {
  busy = value;
  el.kioskApp.classList.toggle('is-busy', value);
  el.kioskApp.setAttribute('aria-busy', value ? 'true' : 'false');
  el.rosterGrid.querySelectorAll('.athlete-tile').forEach((tile) => {
    tile.disabled = value;
  });
}

/* ── LOCAL STORAGE ────────────────────────────────────── */
function readStoredCode() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && value.length ? value : null;
  } catch (err) {
    return null;
  }
}

function storeCode(code) {
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
    return true;
  } catch (err) {
    return false;
  }
}

function clearStoredCode() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    // Nothing else to do; the in-memory code is cleared by the caller.
  }
}

/* ── API ──────────────────────────────────────────────── */
async function kioskApi(action, payload, code) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-kiosk-code': code || '',
      },
      body: JSON.stringify({ action, ...payload }),
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });

    let data = null;
    try {
      data = await response.json();
    } catch (err) {
      data = null;
    }

    return { status: response.status, data };
  } finally {
    clearTimeout(timeoutId);
  }
}

function isConnectionError(err) {
  return (
    !navigator.onLine ||
    err.name === 'TypeError' ||
    err.name === 'AbortError'
  );
}

/* ── ROSTER ───────────────────────────────────────────── */
function normalizeRoster(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .filter(
      (row) =>
        row &&
        typeof row.id === 'string' &&
        typeof row.first_name === 'string'
    )
    .map((row) => ({
      id: row.id,
      first_name: row.first_name.trim(),
      last_initial:
        typeof row.last_initial === 'string'
          ? row.last_initial.trim().slice(0, 1).toUpperCase()
          : '',
    }))
    .filter((row) => row.first_name.length > 0)
    .sort(
      (a, b) =>
        a.first_name.localeCompare(b.first_name, 'en', {
          sensitivity: 'base',
        }) ||
        a.last_initial.localeCompare(b.last_initial, 'en', {
          sensitivity: 'base',
        })
    );
}

function displayName(athlete) {
  return athlete.last_initial
    ? `${athlete.first_name} ${athlete.last_initial}.`
    : athlete.first_name;
}

function normalizeQuery(value) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function renderRoster() {
  const query = normalizeQuery(el.searchInput.value);
  const queryChanged = query !== lastRenderedQuery;
  const previousScroll = el.rosterScroll.scrollTop;
  const matches = query
    ? roster.filter((athlete) =>
        normalizeQuery(displayName(athlete)).includes(query)
      )
    : roster;

  const fragment = document.createDocumentFragment();

  matches.forEach((athlete) => {
    const tile = document.createElement('button');
    const name = displayName(athlete);

    tile.type = 'button';
    tile.className = 'athlete-tile';
    tile.dataset.athleteId = athlete.id;
    tile.textContent = name;
    tile.setAttribute('aria-label', `Check in as ${name}`);
    tile.disabled = busy;

    fragment.appendChild(tile);
  });

  el.rosterGrid.textContent = '';
  el.rosterGrid.appendChild(fragment);

  const showEmpty = roster.length > 0 && matches.length === 0;
  el.rosterEmpty.hidden = !showEmpty;
  if (showEmpty) {
    el.rosterEmpty.textContent = 'No names match that search.';
  }

  if (queryChanged) {
    el.rosterScroll.scrollTop = 0;
  } else {
    el.rosterScroll.scrollTop = previousScroll;
  }

  lastRenderedQuery = query;
}

async function loadRoster(options) {
  const opts = options || {};

  if (!kioskCode || el.rosterScreen.hidden) {
    return;
  }

  if (rosterLoading || busy) {
    return;
  }

  rosterLoading = true;
  const requestToken = ++rosterRequestToken;
  const initial = opts.initial === true || roster.length === 0;

  if (initial) {
    setSearchEnabled(false);
    setRosterStatus('Loading names…');
  }

  try {
    const { status, data } = await kioskApi('roster', {}, kioskCode);

    // A reset, a code change, or a 401 from another request may have hidden
    // the roster while this request was in flight. Do not repopulate it with
    // a response for an older code or an older screen.
    if (
      requestToken !== rosterRequestToken ||
      !kioskCode ||
      el.rosterScreen.hidden
    ) {
      return;
    }

    if (status === 401) {
      handleUnauthorized();
      return;
    }

    if (status === 200 && data && Array.isArray(data.athletes)) {
      roster = normalizeRoster(data.athletes);
      renderRoster();

      if (roster.length > 0) {
        setSearchEnabled(true);
        setRosterStatus('');
      } else {
        setSearchEnabled(false);
        setRosterStatus('No active athletes found. Tell your coach.');
      }
      return;
    }

    if (initial) {
      setSearchEnabled(false);
      setRosterStatus(
        status === 500
          ? 'Kiosk is not set up. Tell your coach.'
          : 'Something went wrong. Please try again or tell your coach.',
        true
      );
    } else {
      setTransientStatus('Could not refresh names. Using the last list.', 5000);
    }
  } catch (err) {
    if (isConnectionError(err)) {
      if (initial) {
        setSearchEnabled(false);
        setRosterStatus('No connection. Please try again.', true);
      } else {
        setTransientStatus('No connection. Could not refresh names.', 5000);
      }
    } else if (initial) {
      setSearchEnabled(false);
      setRosterStatus(
        'Something went wrong. Please try again or tell your coach.',
        true
      );
    } else {
      setTransientStatus('Could not refresh names. Using the last list.', 5000);
    }
  } finally {
    rosterLoading = false;
  }
}

/* ── SCREENS / AUTH ───────────────────────────────────── */
function showSetup(message) {
  closeConfirm();
  closeResetConfirm();
  closeResult();

  rosterRequestToken += 1;
  kioskCode = null;
  roster = [];
  lastRenderedQuery = null;
  el.searchInput.value = '';
  setSearchEnabled(false);
  setRosterStatus('');
  renderRoster();

  el.rosterScreen.hidden = true;
  el.setupScreen.hidden = false;
  el.setupInput.value = '';
  setSetupBusy(false);
  setSetupError(message || '');

  armInactivity();
}

function showRoster() {
  el.setupScreen.hidden = true;
  el.rosterScreen.hidden = false;
  setSetupError('');
}

function handleUnauthorized() {
  clearStoredCode();
  kioskCode = null;
  roster = [];
  selectedAthlete = null;
  busy = false;
  setBusy(false);
  closeConfirm();
  closeResetConfirm();
  closeResult();
  showSetup('Kiosk code is no longer valid. Enter the staff code.');
}

async function handleSetupSubmit() {
  if (el.saveCodeBtn.disabled) {
    return;
  }

  const code = el.setupInput.value.trim();
  if (!code) {
    setSetupError('Enter the kiosk code.');
    el.setupInput.focus();
    return;
  }

  setSetupError('');
  setSetupBusy(true);

  try {
    const { status, data } = await kioskApi('roster', {}, code);

    if (status === 401) {
      clearStoredCode();
      setSetupError('Incorrect kiosk code. Try again.');
      el.setupInput.focus();
      return;
    }

    if (status === 500) {
      setSetupError('Kiosk is not set up. Tell your coach.');
      return;
    }

    if (status !== 200 || !data || !Array.isArray(data.athletes)) {
      setSetupError(
        'Something went wrong. Please try again or tell your coach.'
      );
      return;
    }

    if (!storeCode(code)) {
      setSetupError(
        'Could not save the kiosk code on this iPad. Check Safari settings and try again.'
      );
      return;
    }

    rosterRequestToken += 1;
    kioskCode = code;
    roster = normalizeRoster(data.athletes);
    el.setupInput.value = '';
    setSetupError('');
    showRoster();
    renderRoster();

    if (roster.length > 0) {
      setSearchEnabled(true);
      setRosterStatus('');
    } else {
      setSearchEnabled(false);
      setRosterStatus('No active athletes found. Tell your coach.');
    }

    armInactivity();
  } catch (err) {
    if (isConnectionError(err)) {
      setSetupError('No connection. Please try again.');
    } else {
      setSetupError(
        'Something went wrong. Please try again or tell your coach.'
      );
    }
  } finally {
    setSetupBusy(false);
  }
}

/* ── CHECK-IN CONFIRMATION ────────────────────────────── */
function openConfirm(athlete) {
  if (busy || !athlete) {
    return;
  }

  selectedAthlete = athlete;
  el.confirmTitle.textContent = `Check in as ${displayName(athlete)}?`;
  el.confirmYes.disabled = false;
  el.confirmYes.textContent = 'Yes';
  el.confirmCancel.disabled = false;
  el.confirmOverlay.hidden = false;
  armConfirmTimeout();

  setTimeout(() => {
    if (!el.confirmOverlay.hidden) {
      el.confirmYes.focus();
    }
  }, 30);
}

function closeConfirm() {
  clearTimeout(confirmTimer);
  confirmTimer = null;
  el.confirmOverlay.hidden = true;
  el.confirmTitle.textContent = 'Check in?';
  selectedAthlete = null;
  el.confirmYes.disabled = false;
  el.confirmYes.textContent = 'Yes';
  el.confirmCancel.disabled = false;
}

function armConfirmTimeout() {
  clearTimeout(confirmTimer);
  confirmTimer = null;

  if (el.confirmOverlay.hidden) {
    return;
  }

  confirmTimer = setTimeout(() => {
    if (!el.confirmOverlay.hidden) {
      closeConfirm();
    }
  }, CONFIRM_TIMEOUT_MS);
}

async function handleConfirmYes() {
  if (busy) {
    return;
  }

  const athlete = selectedAthlete;
  if (!athlete) {
    return;
  }

  if (!kioskCode) {
    handleUnauthorized();
    return;
  }

  busy = true;
  setBusy(true);
  clearTimeout(confirmTimer);
  confirmTimer = null;
  el.confirmYes.disabled = true;
  el.confirmCancel.disabled = true;
  el.confirmYes.textContent = 'Checking in…';

  const code = kioskCode;

  try {
    const { status, data } = await kioskApi(
      'check_in',
      { athlete_id: athlete.id },
      code
    );

    // A roster refresh could have received a 401 while this check-in was in
    // flight. Do not show an athlete result after the code was cleared.
    if (kioskCode !== code || el.rosterScreen.hidden) {
      return;
    }

    if (status === 401) {
      handleUnauthorized();
      return;
    }

    if (status === 200 && data && typeof data.first_name === 'string') {
      const firstName = data.first_name.trim() || athlete.first_name;
      closeConfirm();

      if (data.already_checked_in === true) {
        showResult(
          'already',
          `You're already checked in today, ${firstName}.`
        );
      } else {
        showResult('success', `Welcome, ${firstName}!`);
      }
      return;
    }

    closeConfirm();

    if (status === 403) {
      showResult('error', 'Please see your coach.');
    } else {
      showResult(
        'error',
        'Something went wrong. Please try again or tell your coach.'
      );
    }
  } catch (err) {
    closeConfirm();

    if (isConnectionError(err)) {
      showResult('error', 'No connection. Please try again.');
    } else {
      showResult(
        'error',
        'Something went wrong. Please try again or tell your coach.'
      );
    }
  }
}

/* ── RESULTS ──────────────────────────────────────────── */
function showResult(kind, message) {
  clearTimeout(resultTimer);
  resultTimer = null;

  el.resultCard.className = `result-card result-${kind}`;
  el.resultIcon.textContent = kind === 'error' ? '!' : '✓';
  el.resultMessage.textContent = message;
  el.resultOverlay.hidden = false;

  resultTimer = setTimeout(closeResult, RESULT_TIMEOUT_MS);
  armInactivity();
}

function closeResult() {
  clearTimeout(resultTimer);
  resultTimer = null;

  const wasVisible = !el.resultOverlay.hidden;

  el.resultOverlay.hidden = true;
  el.resultMessage.textContent = '';
  el.resultCard.className = 'result-card';
  el.resultIcon.textContent = '✓';

  if (!wasVisible) {
    return;
  }

  setBusy(false);
  el.searchInput.value = '';
  renderRoster();
  armInactivity();
}

/* ── STAFF RESET (hold logo 5 seconds) ────────────────── */
function openResetConfirm() {
  if (busy || !readStoredCode()) {
    return;
  }

  closeConfirm();
  el.resetOverlay.hidden = false;
  el.resetConfirm.disabled = false;
  el.resetCancel.disabled = false;

  setTimeout(() => {
    if (!el.resetOverlay.hidden) {
      el.resetCancel.focus();
    }
  }, 30);

  armInactivity();
}

function closeResetConfirm() {
  el.resetOverlay.hidden = true;
  el.resetConfirm.disabled = false;
  el.resetCancel.disabled = false;
}

function handleResetConfirm() {
  clearStoredCode();
  kioskCode = null;
  roster = [];
  selectedAthlete = null;
  busy = false;
  setBusy(false);
  closeResetConfirm();
  closeConfirm();
  closeResult();
  showSetup('Kiosk code cleared. Enter the staff code to start again.');
}

function startLongPress(event) {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }

  if (busy || !readStoredCode()) {
    return;
  }

  event.preventDefault();
  cancelLongPress();

  longPressTimer = setTimeout(() => {
    longPressTimer = null;
    openResetConfirm();
  }, LONG_PRESS_MS);
}

function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

/* ── INACTIVITY RESET ─────────────────────────────────── */
function armInactivity() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(resetIdleScreen, INACTIVITY_TIMEOUT_MS);
}

function resetIdleScreen() {
  if (busy) {
    armInactivity();
    return;
  }

  closeConfirm();
  closeResetConfirm();

  if (!el.resultOverlay.hidden) {
    closeResult();
  }

  if (!el.rosterScreen.hidden) {
    el.searchInput.value = '';
    renderRoster();
  } else {
    el.setupInput.value = '';
    setSetupError('');
  }

  armInactivity();
}

/* ── EVENTS ───────────────────────────────────────────── */
function bindEvents() {
  el.saveCodeBtn.addEventListener('click', handleSetupSubmit);
  el.setupInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSetupSubmit();
    }
  });

  el.searchInput.addEventListener('input', renderRoster);
  el.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      el.searchInput.blur();
    }
  });

  el.rosterGrid.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const tile = target.closest('.athlete-tile');
    if (!tile || busy) {
      return;
    }

    const athlete = roster.find(
      (item) => item.id === tile.dataset.athleteId
    );

    if (athlete) {
      openConfirm(athlete);
    }
  });

  el.rosterGrid.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  el.rosterGrid.addEventListener('dragstart', (event) => {
    event.preventDefault();
  });

  el.confirmYes.addEventListener('click', handleConfirmYes);
  el.confirmCancel.addEventListener('click', closeConfirm);
  el.confirmOverlay.addEventListener('pointerdown', armConfirmTimeout);
  el.confirmOverlay.addEventListener('keydown', armConfirmTimeout);

  el.resetCancel.addEventListener('click', closeResetConfirm);
  el.resetConfirm.addEventListener('click', handleResetConfirm);

  el.kioskBrand.addEventListener('pointerdown', startLongPress);
  el.kioskBrand.addEventListener('pointerup', cancelLongPress);
  el.kioskBrand.addEventListener('pointercancel', cancelLongPress);
  el.kioskBrand.addEventListener('pointerleave', cancelLongPress);
  el.kioskBrand.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
  window.addEventListener('pointerup', cancelLongPress);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }

    if (!el.resetOverlay.hidden) {
      closeResetConfirm();
      return;
    }

    if (!el.confirmOverlay.hidden) {
      closeConfirm();
    }
  });

  document.addEventListener('pointerdown', armInactivity, { passive: true });
  document.addEventListener('keydown', armInactivity);
  document.addEventListener('input', armInactivity, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      return;
    }

    armInactivity();

    if (kioskCode && !el.rosterScreen.hidden && !busy) {
      loadRoster({ initial: roster.length === 0 });
    }
  });

  window.addEventListener('online', () => {
    if (kioskCode && !el.rosterScreen.hidden && !busy) {
      loadRoster({ initial: roster.length === 0 });
    }
  });
}

function startRosterRefreshTimer() {
  setInterval(() => {
    if (!document.hidden && kioskCode && !el.rosterScreen.hidden && !busy) {
      loadRoster({ initial: false });
    }
  }, ROSTER_REFRESH_MS);
}

function init() {
  cacheDom();
  bindEvents();

  kioskCode = readStoredCode();

  if (!kioskCode) {
    showSetup('');
  } else {
    showRoster();
    setSearchEnabled(false);
    setRosterStatus('Loading names…');
    loadRoster({ initial: true });
  }

  armInactivity();
  startRosterRefreshTimer();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
