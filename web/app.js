import { firebaseConfig } from './firebase-config.js';
import { qmContent } from './content-data.js';

window.qmIntranetReady = true;

const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
const AUTH_BASE_URL = 'https://identitytoolkit.googleapis.com/v1';
const TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
const SESSION_KEY = 'issel-qm-session';
const labels = { all: 'Freigegebene Bereiche', shared: 'Verbund', security: 'Security', k9: 'K9' };
const INITIAL_ADMIN_UID = 'io63zzdfZ7ZkEcaIZIPOv23WV7l2';
const PROFILE_WATCHDOG_MS = 10000;
const baselineProcesses = qmContent.processes.map(process => ({ ...process }));
const baselineDocuments = qmContent.documents.map(documentData => ({ ...documentData }));
const state = { scope: 'all', selected: null, query: '', view: 'processes', processes: baselineProcesses, documents: baselineDocuments, areas: ['shared', 'security', 'k9'] };
const isLocalPreview = window.location.protocol === 'file:';
let activeUiUserId = null;

const loginView = document.getElementById('login-view');
const appView = document.getElementById('app');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginStatus = document.getElementById('login-status');
const loginButton = loginForm.querySelector('button[type="submit"]');
const processNav = document.getElementById('process-nav');
const processNavTitle = document.getElementById('process-nav-title');
const processView = document.getElementById('process-view');
const libraryView = document.getElementById('library-view');
const library = document.getElementById('library');
const libraryCount = document.getElementById('library-count');
const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');
const searchWrap = document.getElementById('search-wrap');
const appMessage = document.getElementById('app-message');

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
const safeUrl = value => /^https:\/\//i.test(value || '') ? value : '';
const visibleForScope = item => state.scope === 'all' || item.area === 'shared' || item.area === state.scope;
const matches = item => `${item.id} ${item.title} ${item.type}`.toLocaleLowerCase('de').includes(state.query);
const visibleProcesses = () => state.processes.filter(visibleForScope);

function mergeByAreaAndId(baseline, remote) {
  const merged = new Map(baseline.map(item => [`${item.area}/${item.id}`, item]));
  remote.forEach(item => {
    const key = `${item.area}/${item.id}`;
    merged.set(key, { ...(merged.get(key) || {}), ...item });
  });
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id, 'de'));
}

function showMessage(message = '') {
  appMessage.textContent = message;
  appMessage.hidden = !message;
}

function setLoginStatus(message, busy = false) {
  loginStatus.textContent = message;
  loginButton.disabled = busy;
  loginButton.textContent = busy ? 'Anmeldung läuft …' : 'Anmelden';
}

function normalizeAuthError(rawCode = '') {
  const code = rawCode.split(' : ')[0];
  const codes = {
    EMAIL_NOT_FOUND: 'auth/invalid-credential',
    INVALID_PASSWORD: 'auth/invalid-credential',
    INVALID_LOGIN_CREDENTIALS: 'auth/invalid-credential',
    USER_DISABLED: 'auth/user-disabled',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'auth/too-many-requests',
    TOKEN_EXPIRED: 'auth/session-expired',
    INVALID_REFRESH_TOKEN: 'auth/session-expired',
    USER_NOT_FOUND: 'auth/session-expired'
  };
  return codes[code] || `auth/${code.toLocaleLowerCase('en').replaceAll('_', '-')}`;
}

function xhrJson(url, options = {}, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(options.method || 'GET', url, true);
    request.timeout = timeoutMs;
    Object.entries(options.headers || {}).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.onload = () => {
      if (request.status === 0) {
        reject({ code: 'xhr/network' });
        return;
      }
      let payload = {};
      try {
        payload = request.responseText ? JSON.parse(request.responseText) : {};
      } catch {
        payload = {};
      }
      resolve({ ok: request.status >= 200 && request.status < 300, status: request.status, payload });
    };
    request.onerror = () => reject({ code: 'xhr/network' });
    request.ontimeout = () => reject({ code: 'xhr/timeout' });
    const body = options.body instanceof URLSearchParams ? options.body.toString() : (options.body || null);
    request.send(body);
  });
}

async function xhrJsonWithRetry(url, options = {}, timeoutMs = 12000) {
  try {
    return await xhrJson(url, options, timeoutMs);
  } catch (error) {
    // Firmen-Proxys und Virenscanner lassen häufig nur den ersten Aufruf hängen; ein zweiter Versuch gelingt dann.
    if (error?.code !== 'xhr/timeout' && error?.code !== 'xhr/network') throw error;
    return xhrJson(url, options, timeoutMs);
  }
}

async function fetchJson(url, options = {}, timeoutMs = 12000) {
  try {
    const response = await xhrJsonWithRetry(url, options, timeoutMs);
    if (!response.ok) {
      const error = new Error(response.payload?.error?.message || `HTTP-Fehler ${response.status}`);
      error.code = normalizeAuthError(response.payload?.error?.message || `HTTP_${response.status}`);
      throw error;
    }
    return response.payload;
  } catch (error) {
    if (error?.code && !error.code.startsWith('xhr/')) throw error;
    const networkError = new Error('Die verschlüsselte Verbindung zu Firebase konnte nicht hergestellt werden.');
    networkError.code = 'auth/network-request-failed';
    throw networkError;
  }
}

function storeSession(user) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  } catch {
    // Die aktuelle Anmeldung funktioniert auch ohne Sitzungswiederherstellung.
  }
}

function readSession() {
  try {
    const value = window.sessionStorage.getItem(SESSION_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Keine weitere Aktion erforderlich.
  }
}

async function getValidIdToken(user) {
  if (user.idToken && user.expiresAt > Date.now() + 60000) return user.idToken;
  if (!user.refreshToken) throw { code: 'auth/session-expired' };
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: user.refreshToken });
  const payload = await fetchJson(`${TOKEN_URL}?key=${encodeURIComponent(firebaseConfig.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  user.uid = payload.user_id || user.uid;
  user.idToken = payload.id_token;
  user.refreshToken = payload.refresh_token || user.refreshToken;
  user.expiresAt = Date.now() + (Number(payload.expires_in || 3600) * 1000);
  storeSession(user);
  return user.idToken;
}

function signOutCurrentUser() {
  clearSession();
  activeUiUserId = null;
  appView.hidden = true;
  loginView.hidden = false;
  loginForm.reset();
  loginError.hidden = true;
  resetLoginLog();
  document.getElementById('import-link').hidden = true;
  setLoginStatus('Anmeldung bereit.');
}

function decodeFirestoreValue(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue.fields || {});
  return null;
}

function decodeFirestoreFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function encodeFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: String(value) };
  if (typeof value === 'number') return { doubleValue: value };
  if (typeof value === 'object') return { mapValue: { fields: encodeFirestoreFields(value) } };
  return { stringValue: String(value ?? '') };
}

function encodeFirestoreFields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encodeFirestoreValue(value)]));
}

async function firestoreRequest(user, relativePath, options = {}) {
  try {
    const token = await getValidIdToken(user);
    const response = await xhrJsonWithRetry(`${FIRESTORE_BASE_URL}/${relativePath}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const error = new Error(response.payload?.error?.message || `Firestore-Fehler ${response.status}`);
      error.code = response.status === 403 ? 'permission-denied'
        : response.status === 404 ? 'not-found'
        : `firestore/http-${response.status}`;
      throw error;
    }
    return response.payload;
  } catch (error) {
    if (error?.code === 'xhr/timeout') throw { code: 'firestore/timeout' };
    if (error?.code === 'xhr/network') throw { code: 'firestore/network' };
    if (error?.code) throw error;
    const networkError = new Error('Die Firestore-HTTPS-Verbindung konnte nicht hergestellt werden.');
    networkError.code = 'firestore/network';
    throw networkError;
  }
}

async function readFirestoreDocument(user, relativePath) {
  try {
    const documentData = await firestoreRequest(user, relativePath);
    return decodeFirestoreFields(documentData.fields || {});
  } catch (error) {
    if (error.code === 'not-found') return null;
    throw error;
  }
}

async function writeFirestoreDocument(user, relativePath, data) {
  await firestoreRequest(user, relativePath, {
    method: 'PATCH',
    body: JSON.stringify({ fields: encodeFirestoreFields(data) })
  });
  return data;
}

async function listFirestoreCollection(user, relativePath) {
  const payload = await firestoreRequest(user, `${relativePath}?pageSize=1000`);
  return (payload.documents || []).map(documentData => ({
    ...decodeFirestoreFields(documentData.fields || {}),
    id: documentData.name.split('/').pop()
  }));
}

function documentLink(documentData) {
  const url = safeUrl(documentData.href);
  const title = escapeHtml(documentData.title);
  return url
    ? `<a class="doc-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${title}</a>`
    : `<span class="doc-link">${title}</span><div class="doc-detail">Link zum freigegebenen Originaldokument wird noch hinterlegt.</div>`;
}

function renderNav() {
  const processes = visibleProcesses();
  processNav.innerHTML = processes.map(process => `<button type="button" class="nav-process ${process.id === state.selected ? 'active' : ''}" data-process="${escapeHtml(process.id)}"><strong>${escapeHtml(process.id)}</strong> · ${escapeHtml(process.title)}</button>`).join('');
  processNav.querySelectorAll('[data-process]').forEach(button => button.addEventListener('click', () => {
    state.selected = button.dataset.process;
    render();
  }));
}

function renderProcess() {
  const processes = visibleProcesses();
  const process = processes.find(item => item.id === state.selected) || processes[0];
  if (!process) {
    processView.innerHTML = '<p class="empty">Für diesen Bereich sind noch keine Prozesse freigegeben.</p>';
    return;
  }
  state.selected = process.id;
  const docs = (process.documentIds || []).map(id => state.documents.find(documentData => documentData.id === id)).filter(Boolean);
  const documentsHtml = docs.length
    ? docs.map(documentData => `<div class="document"><div class="doc-code">${escapeHtml(documentData.id)}</div><div>${documentLink(documentData)}<div class="doc-detail">${escapeHtml(documentData.type)} · ${escapeHtml(labels[documentData.area] || documentData.area)}</div></div></div>`).join('')
    : '<p class="empty">Für diesen Prozess ist noch kein Dokument verknüpft.</p>';
  const flowHtml = (process.flow || []).map(step => `<div class="flow-step">${escapeHtml(step)}</div>`).join('');
  const badgeClass = process.area === 'k9' ? 'badge k9' : 'badge';
  processView.innerHTML = `<section class="panel"><h2>${escapeHtml(process.id)} · ${escapeHtml(process.title)}</h2><div class="process-meta"><span class="${badgeClass}">${escapeHtml(process.group || 'Prozess')}</span><span class="badge">${escapeHtml(labels[process.area] || process.area)}</span></div></section><div class="process-grid"><section class="panel"><h3>Zugehörige Dokumente</h3><div class="document-list">${documentsHtml}</div></section><section class="panel"><h3>Flussdiagramm</h3><div class="flow" role="img" aria-label="Ablauf für ${escapeHtml(process.title)}">${flowHtml}</div><div class="process-description"><h3>Prozessbeschreibung</h3><p class="muted">${escapeHtml(process.description)}</p></div></section></div>`;
}

function renderLibrary() {
  const documents = state.documents.filter(documentData => visibleForScope(documentData) && matches(documentData));
  libraryCount.textContent = `${documents.length} Dokumente in ${labels[state.scope]}`;
  library.innerHTML = documents.length
    ? documents.map(documentData => `<article class="library-item"><span class="badge ${documentData.area === 'k9' ? 'k9' : ''}">${escapeHtml(labels[documentData.area] || documentData.area)}</span><h3>${documentLink(documentData)}</h3><p class="muted">${escapeHtml(documentData.id)} · ${escapeHtml(documentData.type)}</p></article>`).join('')
    : '<p class="empty">Keine passenden Dokumente gefunden.</p>';
}

function renderScopeControls() {
  document.querySelectorAll('[data-scope]').forEach(button => {
    const scope = button.dataset.scope;
    button.hidden = scope !== 'all' && !state.areas.includes(scope);
    button.classList.toggle('active', state.scope === scope);
  });
}

function render() {
  const isLibrary = state.view === 'library';
  pageTitle.textContent = isLibrary ? `Dokumentenbibliothek · ${labels[state.scope]}` : `QM-Prozesse · ${labels[state.scope]}`;
  pageSubtitle.textContent = isLibrary ? 'Gelenkte Dokumentinformationen und Links zu den freigegebenen Originalen.' : 'Prozesse, Nachweise und gelenkte Dokumentinformationen.';
  processView.hidden = isLibrary;
  libraryView.hidden = !isLibrary;
  searchWrap.hidden = !isLibrary;
  processNav.hidden = isLibrary;
  processNavTitle.hidden = isLibrary;
  renderScopeControls();
  if (isLibrary) renderLibrary();
  else { renderNav(); renderProcess(); }
}

async function loadAreaContent(user, area) {
  const [processes, documents] = await Promise.all([
    listFirestoreCollection(user, `areas/${area}/processes`),
    listFirestoreCollection(user, `areas/${area}/documents`)
  ]);
  return {
    processes: processes.map(process => ({ ...process, area })),
    documents: documents.map(documentData => ({ ...documentData, area }))
  };
}

function showAuthenticatedShell(user) {
  state.areas = ['shared', 'security', 'k9'];
  state.scope = 'all';
  state.selected = null;
  state.query = '';
  state.processes = baselineProcesses;
  state.documents = baselineDocuments;
  document.getElementById('account-name').textContent = user.uid === INITIAL_ADMIN_UID
    ? `${user.email} · Administration`
    : user.email;
  loginError.hidden = true;
  loginView.hidden = true;
  appView.hidden = false;
  showMessage('Anmeldung erfolgreich. Prozesslandschaft und Dokumentverknüpfungen werden geladen …');
  render();
}

async function openIntranet(user) {
  showMessage('Benutzerprofil wird aus Firestore geladen …');
  const profileWatchdog = window.setTimeout(() => {
    showMessage('Anmeldung erfolgreich, aber Firestore antwortet nicht. Bitte Datenbank und Regeln prüfen.');
  }, PROFILE_WATCHDOG_MS);

  try {
  const profilePath = `users/${encodeURIComponent(user.uid)}`;
  let profile = await readFirestoreDocument(user, profilePath);
  if (!profile) {
    profile = await writeFirestoreDocument(user, profilePath, {
      displayName: user.email,
      active: true,
      roles: user.uid === INITIAL_ADMIN_UID ? ['admin'] : ['reader'],
      areas: ['all']
    });
  } else if (user.uid === INITIAL_ADMIN_UID && !(profile.roles || []).includes('admin')) {
    profile = await writeFirestoreDocument(user, profilePath, {
      ...profile,
      displayName: profile.displayName || user.email,
      roles: ['admin'],
      areas: ['all'],
      active: true
    });
  }
  if (profile.active !== true) {
    signOutCurrentUser();
    throw new Error('Dieses Benutzerkonto ist für das QM-Intranet nicht aktiv.');
  }
  const roles = Array.isArray(profile.roles) ? profile.roles : [];
  const grantedAreas = Array.isArray(profile.areas) ? profile.areas : [];
  state.areas = roles.includes('admin') || grantedAreas.includes('all')
    ? ['shared', 'security', 'k9']
    : ['shared', ...grantedAreas.filter(area => ['security', 'k9'].includes(area))];
  state.scope = 'all';
  state.selected = null;
  state.query = '';
  document.getElementById('account-name').textContent = roles.includes('admin') ? `${profile.displayName || user.email} · Administration` : (profile.displayName || user.email);
  document.getElementById('import-link').hidden = !roles.includes('admin');
  showMessage('Daten werden geladen …');
  const content = await Promise.all(state.areas.map(area => loadAreaContent(user, area)));
  state.processes = mergeByAreaAndId(baselineProcesses, content.flatMap(item => item.processes));
  state.documents = mergeByAreaAndId(baselineDocuments, content.flatMap(item => item.documents));
  loginView.hidden = true;
  appView.hidden = false;
  const linkedDocuments = state.documents.filter(documentData => safeUrl(documentData.href)).length;
  showMessage(linkedDocuments
    ? ''
    : 'Prozesse, Flussdiagramme und Dokumentzuordnungen sind verfügbar. Freigegebene Downloadlinks werden noch in Firestore hinterlegt.');
  render();
  } finally {
    window.clearTimeout(profileWatchdog);
  }
}

async function activateAuthenticatedUser(user) {
  if (activeUiUserId === user.uid) return;
  activeUiUserId = user.uid;
  showAuthenticatedShell(user);
  try {
    await openIntranet(user);
  } catch (error) {
    loginView.hidden = true;
    appView.hidden = false;
    showMessage(`Anmeldung erfolgreich, aber QM-Daten konnten nicht geladen werden: ${errorMessage(error)}`);
  }
}

function errorMessage(error) {
  const messages = {
    'auth/invalid-credential': 'E-Mail-Adresse oder Passwort sind nicht korrekt.',
    'auth/unauthorized-domain': 'Diese Internetadresse ist in Firebase noch nicht für die Anmeldung freigegeben.',
    'auth/network-request-failed': 'Die Verbindung zu Firebase konnte nicht hergestellt werden. Bitte den Verbindungstest unter dem Anmeldebutton öffnen.',
    'auth/too-many-requests': 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.',
    'auth/user-disabled': 'Dieses Benutzerkonto wurde in Firebase deaktiviert.',
    'auth/session-expired': 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.',
    'permission-denied': 'Der Zugriff wurde durch die Berechtigungsregeln abgelehnt. Bitte prüfen, ob die aktuellen Firestore-Regeln veröffentlicht sind und das Konto für das QM-Intranet freigegeben ist.',
    'firestore/timeout': 'Firestore antwortet nicht. Bitte prüfen, ob die Firestore-Regeln veröffentlicht wurden und die Datenbank erreichbar ist.',
    'firestore/network': 'Die Firestore-HTTPS-Verbindung konnte nicht hergestellt werden.'
  };
  return messages[error.code] || error.message || 'Anmeldung nicht möglich.';
}

const loginLog = document.getElementById('login-log');
let loginTicker = null;
let loginStartedAt = 0;

function resetLoginLog() {
  loginLog.textContent = '';
  loginLog.hidden = true;
}

function logLoginStep(text) {
  const line = document.createElement('div');
  line.textContent = `${((Date.now() - loginStartedAt) / 1000).toFixed(1)} s · ${text}`;
  loginLog.appendChild(line);
  loginLog.hidden = false;
}

function stopLoginTicker() {
  if (loginTicker) {
    window.clearInterval(loginTicker);
    loginTicker = null;
  }
}

function failLogin(message) {
  stopLoginTicker();
  loginError.textContent = message;
  loginError.hidden = false;
  setLoginStatus('Anmeldung nicht möglich. Bitte Meldung oben beachten.');
}

// Bewusst derselbe Aufbau wie der funktionierende Anmeldetest der Diagnoseseite:
// klassischer XMLHttpRequest mit Rückrufen statt einer Promise-Kette, damit die
// Anmeldung und der Test denselben Codeweg nehmen.
function directSignIn(email, password, attempt) {
  const retryOrFail = reason => {
    logLoginStep(`${reason}.`);
    if (attempt === 1) directSignIn(email, password, 2);
    else failLogin('Die Verbindung zu Firebase konnte nicht hergestellt werden. Bitte den Verbindungstest unter dem Anmeldebutton öffnen.');
  };
  logLoginStep(attempt === 1 ? 'Anmeldeanfrage wird gesendet …' : 'Zweiter Versuch wird gesendet …');
  const request = new XMLHttpRequest();
  request.open('POST', `${AUTH_BASE_URL}/accounts:signInWithPassword?key=${encodeURIComponent(firebaseConfig.apiKey)}`, true);
  request.timeout = 12000;
  request.setRequestHeader('Content-Type', 'application/json');
  request.onload = () => {
    if (request.status === 0) return retryOrFail('Verbindung blockiert');
    let payload = {};
    try {
      payload = JSON.parse(request.responseText || '{}');
    } catch {
      payload = {};
    }
    if (request.status !== 200) {
      logLoginStep(`Firebase lehnt ab (HTTP ${request.status}).`);
      const error = new Error(payload?.error?.message || `HTTP-Fehler ${request.status}`);
      error.code = normalizeAuthError(payload?.error?.message || `HTTP_${request.status}`);
      failLogin(errorMessage(error));
      return;
    }
    if (!payload.idToken) {
      logLoginStep('Antwort ohne Sicherheitstoken empfangen.');
      failLogin('Die Firebase-Antwort war unvollständig. Vermutlich verändert ein Sicherheitsprogramm die Antwort.');
      return;
    }
    logLoginStep(`Antwort mit Sicherheitstoken empfangen (HTTP 200, ${(request.responseText || '').length} Zeichen).`);
    stopLoginTicker();
    const user = {
      uid: payload.localId,
      email: payload.email,
      idToken: payload.idToken,
      refreshToken: payload.refreshToken,
      expiresAt: Date.now() + (Number(payload.expiresIn || 3600) * 1000)
    };
    storeSession(user);
    logLoginStep('Anmeldung erfolgreich. Intranet wird geöffnet …');
    activateAuthenticatedUser(user).catch(error => failLogin(errorMessage(error)));
  };
  request.onerror = () => retryOrFail('Netzwerkfehler');
  request.ontimeout = () => retryOrFail('Keine Antwort innerhalb von 12 Sekunden');
  request.send(JSON.stringify({ email, password, returnSecureToken: true }));
}

loginForm.addEventListener('submit', event => {
  event.preventDefault();
  loginError.hidden = true;
  resetLoginLog();
  loginStartedAt = Date.now();
  setLoginStatus('Direkte HTTPS-Anmeldung wird geprüft … (0 s)', true);
  stopLoginTicker();
  loginTicker = window.setInterval(() => {
    if (!loginButton.disabled || !appView.hidden) {
      stopLoginTicker();
      return;
    }
    loginStatus.textContent = `Direkte HTTPS-Anmeldung wird geprüft … (${Math.round((Date.now() - loginStartedAt) / 1000)} s)`;
  }, 1000);
  const formData = new FormData(loginForm);
  directSignIn(String(formData.get('email') || '').trim(), String(formData.get('password') || ''), 1);
});

window.addEventListener('unhandledrejection', event => {
  if (!loginView.hidden) {
    const reason = event.reason || {};
    failLogin(`Technischer Fehler: ${reason.message || reason.code || 'Unbekannter Fehler in der Anmeldung.'}`);
  }
});

document.getElementById('logout').addEventListener('click', signOutCurrentUser);
document.querySelectorAll('[data-scope]').forEach(button => button.addEventListener('click', () => {
  state.scope = button.dataset.scope;
  state.selected = null;
  render();
}));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item === button));
  render();
}));
document.getElementById('search').addEventListener('input', event => {
  state.query = event.target.value.trim().toLocaleLowerCase('de');
  renderLibrary();
});

async function initializeSession() {
  if (isLocalPreview) {
    appView.hidden = true;
    loginView.hidden = false;
    loginError.textContent = 'Lokale Datei erkannt. Bitte ausschließlich die veröffentlichte GitHub-Seite verwenden.';
    loginError.hidden = false;
    setLoginStatus('Anmeldung in der lokalen Vorschau deaktiviert.');
    return;
  }
  const user = readSession();
  if (!user) {
    activeUiUserId = null;
    appView.hidden = true;
    loginView.hidden = false;
    setLoginStatus('Anmeldung bereit.');
    return;
  }
  try {
    await getValidIdToken(user);
    await activateAuthenticatedUser(user);
  } catch (error) {
    clearSession();
    activeUiUserId = null;
    appView.hidden = true;
    loginView.hidden = false;
    loginError.textContent = errorMessage(error);
    loginError.hidden = false;
    setLoginStatus('Bitte erneut anmelden.');
  }
}

initializeSession();

window.addEventListener('error', event => {
  if (!loginView.hidden) {
    loginError.textContent = `Technischer Fehler: ${event.message || 'Anwendung konnte nicht gestartet werden.'}`;
    loginError.hidden = false;
    setLoginStatus('Anmeldung nicht möglich. Bitte Meldung oben beachten.');
  }
});
