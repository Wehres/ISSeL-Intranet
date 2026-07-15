import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'data.js' });

const sourceData = sandbox.window.QM_DATA;
if (!sourceData?.documents || !sourceData?.processes) {
  throw new Error('QM_DATA konnte nicht gelesen werden.');
}

const documents = sourceData.documents.map(documentData => ({
  id: documentData.id,
  title: documentData.title,
  type: documentData.type,
  area: documentData.area,
  sourceFile: documentData.file || '',
  href: ''
}));

const processes = sourceData.processes.map(process => ({
  id: process.id,
  title: process.title,
  group: process.group,
  area: process.area,
  description: process.description,
  flow: process.flow || [],
  documentIds: (process.documents || []).map(documentData => documentData.id)
}));

const output = path.join(root, 'web', 'content-data.js');
const content = `// Automatisch aus dem lokal gepflegten QM-Datenbestand erzeugt.\nexport const qmContent = ${JSON.stringify({ documents, processes }, null, 2)};\n`;
fs.writeFileSync(output, content, 'utf8');
console.log(`${processes.length} Prozesse und ${documents.length} Dokumentverweise wurden nach ${output} geschrieben.`);
