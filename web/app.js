import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { getFirestore, collection, doc, getDoc, getDocs, setDoc } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

window.qmIntranetReady = true;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const labels = { all: 'Freigegebene Bereiche', shared: 'Verbund', security: 'Security', k9: 'K9' };
const INITIAL_ADMIN_UID = 'io63zzdfZ7ZkEcaIZIPOv23WV7l2';
const PROFILE_WATCHDOG_MS = 10000;
const state = { scope: 'all', selected: null, query: '', view: 'processes', processes: [], documents: [], areas: ['shared'] };

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

function showMessage(message = '') {
  appMessage.textContent = message;
  appMessage.hidden = !message;
}

function setLoginStatus(message, busy = false) {
  loginStatus.textContent = message;
  loginButton.disabled = busy;
  loginButton.textContent = busy ? 'Anmeldung läuft …' : 'Anmelden';
}

function withTimeout(promise, milliseconds = 12000) {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = window.setTimeout(() => reject({ code: 'firestore/timeout' }), milliseconds);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => window.clearTimeout(timeout));
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

async function loadAreaContent(area) {
  const [processesSnapshot, documentsSnapshot] = await withTimeout(Promise.all([
    getDocs(collection(db, 'areas', area, 'processes')),
    getDocs(collection(db, 'areas', area, 'documents'))
  ]));
  return {
    processes: processesSnapshot.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id, area })),
    documents: documentsSnapshot.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id, area }))
  };
}

async function openIntranet(user) {
  setLoginStatus('Firebase-Anmeldung erfolgreich. Firestore-Profil wird geladen …', true);
  const profileWatchdog = window.setTimeout(() => {
    loginError.textContent = 'Das Benutzerprofil kann nicht aus Firestore geladen werden. Bitte Firestore-Datenbank und Regeln prüfen.';
    loginError.hidden = false;
    setLoginStatus('Firestore antwortet nicht. Anmeldung wurde angehalten.');
  }, PROFILE_WATCHDOG_MS);

  try {
  const profileReference = doc(db, 'users', user.uid);
  let profileSnapshot = await withTimeout(getDoc(profileReference));
  if (!profileSnapshot.exists()) {
    await withTimeout(setDoc(profileReference, {
      displayName: user.email,
      active: true,
      roles: user.uid === INITIAL_ADMIN_UID ? ['admin'] : ['reader'],
      areas: ['all']
    }));
    profileSnapshot = await withTimeout(getDoc(profileReference));
  } else if (user.uid === INITIAL_ADMIN_UID && !(profileSnapshot.data().roles || []).includes('admin')) {
    await withTimeout(setDoc(profileReference, { roles: ['admin'], areas: ['all'], active: true }, { merge: true }));
    profileSnapshot = await withTimeout(getDoc(profileReference));
  }
  if (profileSnapshot.data().active !== true) {
    await signOut(auth);
    throw new Error('Dieses Benutzerkonto ist für das QM-Intranet nicht aktiv.');
  }
  const profile = profileSnapshot.data();
  const roles = Array.isArray(profile.roles) ? profile.roles : [];
  const grantedAreas = Array.isArray(profile.areas) ? profile.areas : [];
  state.areas = roles.includes('admin') || grantedAreas.includes('all')
    ? ['shared', 'security', 'k9']
    : ['shared', ...grantedAreas.filter(area => ['security', 'k9'].includes(area))];
  state.scope = 'all';
  state.selected = null;
  state.query = '';
  document.getElementById('account-name').textContent = roles.includes('admin') ? `${profile.displayName || user.email} · Administration` : (profile.displayName || user.email);
  showMessage('Daten werden geladen …');
  const content = await Promise.all(state.areas.map(loadAreaContent));
  state.processes = content.flatMap(item => item.processes).sort((a, b) => a.id.localeCompare(b.id, 'de'));
  state.documents = content.flatMap(item => item.documents).sort((a, b) => a.id.localeCompare(b.id, 'de'));
  loginView.hidden = true;
  appView.hidden = false;
  showMessage(state.processes.length ? '' : 'Es sind noch keine QM-Prozesse im Datenbestand hinterlegt.');
  render();
  } finally {
    window.clearTimeout(profileWatchdog);
  }
}

function errorMessage(error) {
  const messages = {
    'auth/invalid-credential': 'E-Mail-Adresse oder Passwort sind nicht korrekt.',
    'auth/unauthorized-domain': 'Diese Internetadresse ist in Firebase noch nicht für die Anmeldung freigegeben.',
    'auth/network-request-failed': 'Die Verbindung zu Firebase konnte nicht hergestellt werden.',
    'auth/too-many-requests': 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.',
    'permission-denied': 'Der Zugriff wurde durch die Berechtigungsregeln abgelehnt.',
    'firestore/timeout': 'Firestore antwortet nicht. Bitte prüfen, ob die Firestore-Regeln veröffentlicht wurden und die Datenbank erreichbar ist.'
  };
  return messages[error.code] || error.message || 'Anmeldung nicht möglich.';
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginError.hidden = true;
  setLoginStatus('Anmeldung wird geprüft …', true);
  const formData = new FormData(loginForm);
  try {
    await signInWithEmailAndPassword(auth, formData.get('email'), formData.get('password'));
    setLoginStatus('Anmeldung erfolgreich. Berechtigungen werden geladen …', true);
  } catch (error) {
    loginError.textContent = errorMessage(error);
    loginError.hidden = false;
    setLoginStatus('Anmeldung nicht möglich. Bitte Meldung oben beachten.');
  }
});

document.getElementById('logout').addEventListener('click', () => signOut(auth));
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

onAuthStateChanged(auth, async user => {
  if (!user) {
    appView.hidden = true;
    loginView.hidden = false;
    setLoginStatus('Anmeldung bereit.');
    return;
  }
  try {
    await openIntranet(user);
  } catch (error) {
    appView.hidden = true;
    loginView.hidden = false;
    loginError.textContent = errorMessage(error);
    loginError.hidden = false;
    setLoginStatus('Anmeldung nicht möglich. Bitte Meldung oben beachten.');
  }
});

window.addEventListener('error', event => {
  if (!loginView.hidden) {
    loginError.textContent = `Technischer Fehler: ${event.message || 'Anwendung konnte nicht gestartet werden.'}`;
    loginError.hidden = false;
    setLoginStatus('Anmeldung nicht möglich. Bitte Meldung oben beachten.');
  }
});
