const express = require('express');
const bodyParser = require('body-parser');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('Please create config.json (see config.json.example)');
  process.exit(1);
}
const config = require(configPath);

const app = express();
app.use(bodyParser.json());

function log(event, data = {}, level='info') {
  try { console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...data })); } catch(e){ console.log(`[log-fallback] ${event}`); }
}

// Generate human-readable patient ID
function generatePatientId() {
  return `PT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
}

const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const defaultData = { patients: [] };
const db = new Low(adapter, defaultData);

async function initDB() {
  await db.read();
  db.data ||= { patients: [] };
  await db.write();
}
initDB();

function localToCanonicalGender(localVal) {
  const map = {};
  for (const [canon, local] of Object.entries(config.localGender)) {
    map[String(local)] = canon;
  }
  return map[localVal] || map[String(localVal)] || 'unknown';
}

function canonicalToLocalGender(canonical) {
  return config.localGender[canonical] ?? config.localGender['unknown'] ?? canonical;
}

app.post('/ingest', async (req, res) => {
  const p = req.body;
  if (!p || !p.name) return res.status(400).json({ error: 'missing name' });
  await db.read();
  const exists = db.data.patients.find(x => x.name && x.name.toLowerCase() === p.name.toLowerCase() && x.birthDate === (p.birthDate || null));
  if (exists) {
    log('hospitalB.patient.dedup', { existingId: exists.id });
    return res.json({ ok: true, stored: false, duplicateOf: exists.id });
  }
  const newP = {
    id: generatePatientId(),
    localId: p.localId || `L-${Date.now()}`,
    name: p.name,
    gender_local: p.gender || config.localGender.unknown,
    gender_canonical: localToCanonicalGender(p.gender),
    birthDate: p.birthDate || null,
    source: config.name,
    createdAt: new Date().toISOString(),
    status: 'active'
  };
  db.data.patients.push(newP);
  await db.write();
  log('hospitalB.patient.created', { id: newP.id });

  const fhirPatient = {
    resourceType: "Patient",
    id: newP.id,
    name: [{ text: newP.name }],
    gender: newP.gender_canonical,
    birthDate: newP.birthDate,
    meta: { sourceLocalId: newP.localId, sourceHospital: config.name }
  };

  const axios = require('axios');
  axios.post(`${config.hieUrl}/fhir/Patient`, fhirPatient).catch(err => {
    console.error('Failed to notify HIE:', err.message);
  });

  res.json({ ok: true, patient: newP });
});

app.post('/notify', async (req, res) => {
  const p = req.body;
  if (!p || p.resourceType !== 'Patient') return res.status(400).json({ error: 'invalid patient' });
  const localGender = canonicalToLocalGender(p.gender || 'unknown');
  const record = {
    id: p.id || uuidv4(),
    remote: true,
    name: (p.name && p.name[0] && p.name[0].text) || 'Unknown',
    gender_local: localGender,
    gender_canonical: p.gender || 'unknown',
    birthDate: p.birthDate || null,
    source: p.meta && p.meta.sourceHospital ? p.meta.sourceHospital : 'HIE',
    receivedAt: new Date().toISOString()
  };
  await db.read();
  const exists = db.data.patients.find(x => x.id === record.id);
  if (!exists) {
    db.data.patients.push(record);
    await db.write();
  }
  res.json({ ok: true, stored: !exists });
});

app.get('/fhir/Patient/:id', async (req, res) => {
  await db.read();
  const p = db.data.patients.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const out = {
    resourceType: 'Patient',
    id: p.id,
    name: [{ text: p.name }],
    gender_local: p.gender_local,
    gender: p.gender_canonical,
    birthDate: p.birthDate,
    meta: { source: p.source }
  };
  res.json(out);
});

app.get('/patients', async (req, res) => {
  await db.read();
  let results = [...db.data.patients];
  const { name, gender, status, since } = req.query;
  if (name) { const n = String(name).toLowerCase(); results = results.filter(p => p.name && p.name.toLowerCase().includes(n)); }
  if (gender) { const g = String(gender).toLowerCase(); results = results.filter(p => (p.gender_canonical||'').toLowerCase()===g || (p.gender_local||'').toLowerCase()===g); }
  if (status) { results = results.filter(p => p.status === status); }
  if (since) { const t=Date.parse(since); if(!isNaN(t)) results = results.filter(p => Date.parse(p.createdAt) >= t); }
  res.json({ total: results.length, patients: results });
});

app.listen(config.port, () => {
  console.log(`${config.name} listening on ${config.port}`);
});
