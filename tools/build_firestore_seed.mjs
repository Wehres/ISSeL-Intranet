import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'data.js' });

const sourceData = sandbox.window.QM_DATA;
if (!sourceData?.documents || !sourceData?.processes) throw new Error('QM_DATA konnte nicht gelesen werden.');

const areas = ['shared', 'security', 'k9'];
const cleanDocument = documentData => ({
  id: documentData.id,
  title: documentData.title,
  type: documentData.type,
  sourceFile: documentData.file || '',
  href: ''
});
const cleanProcess = process => ({
  id: process.id,
  title: process.title,
  group: process.group,
  description: process.description,
  flow: process.flow || [],
  documentIds: (process.documents || []).map(documentData => documentData.id)
});

const seed = Object.fromEntries(areas.map(area => [area, {
  documents: sourceData.documents.filter(documentData => documentData.area === area).map(cleanDocument),
  processes: sourceData.processes.filter(process => process.area === area).map(cleanProcess)
}]));

const outputDirectory = path.join(root, '.private');
fs.mkdirSync(outputDirectory, { recursive: true });
const output = path.join(outputDirectory, 'firestore-seed.json');
fs.writeFileSync(output, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
console.log(`Seed-Datei erstellt: ${output}`);
