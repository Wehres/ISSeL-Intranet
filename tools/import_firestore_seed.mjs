import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, writeBatch } from 'firebase/firestore';
import { firebaseConfig } from '../web/firebase-config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedFile = path.join(root, '.private', 'firestore-seed.json');
const apply = process.argv.includes('--apply');
const email = process.env.QM_ADMIN_EMAIL;
const password = process.env.QM_ADMIN_PASSWORD;

if (!apply) throw new Error('Sicherheitsstopp: Zum Import bitte zusätzlich --apply angeben.');
if (!email || !password) throw new Error('QM_ADMIN_EMAIL und QM_ADMIN_PASSWORD müssen lokal gesetzt sein.');
if (!fs.existsSync(seedFile)) throw new Error('Seed-Datei fehlt. Zuerst npm run seed:build ausführen.');

const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const credential = await signInWithEmailAndPassword(auth, email, password);
const profile = await getDoc(doc(db, 'users', credential.user.uid));

if (!profile.exists() || profile.data().active !== true || !(profile.data().roles || []).includes('qmb')) {
  throw new Error('Das verwendete Konto ist nicht als aktiver QMB in users/{UID} freigegeben.');
}

const writes = [];
for (const [area, content] of Object.entries(seed)) {
  for (const documentData of content.documents) {
    const { id, ...data } = documentData;
    writes.push([doc(db, 'areas', area, 'documents', id), data]);
  }
  for (const processData of content.processes) {
    const { id, ...data } = processData;
    writes.push([doc(db, 'areas', area, 'processes', id), data]);
  }
}

for (let offset = 0; offset < writes.length; offset += 400) {
  const batch = writeBatch(db);
  writes.slice(offset, offset + 400).forEach(([reference, data]) => batch.set(reference, data));
  await batch.commit();
}

console.log(`${writes.length} Firestore-Datensätze wurden importiert.`);
