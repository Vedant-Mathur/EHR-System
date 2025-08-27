const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const axios = require('axios');

// Generate human-readable patient ID in format PT-YYYYMMDD-XXXXXX
function generatePatientId() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  return `PT-${year}${month}${day}-${random}`;
}

const app = express();
app.use(bodyParser.json());

// Simple structured logger
function log(event, data = {}, level = 'info') {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }));
  } catch (e) {
    console.log(`[log-fallback] ${event} ${JSON.stringify(data)}`);
  }
}

const HOSPITALS = [
  { name: "Hospital-A", notifyUrl: "http://localhost:3001/notify", mapping: { male: "M", female: "W", other: "O", unknown: "U" } },
  { name: "Hospital-B", notifyUrl: "http://localhost:3002/notify", mapping: { male: "1", female: "0", other: "9", unknown: "8" } },
  { name: "Hospital-C", notifyUrl: "http://localhost:3003/notify", mapping: { male: "male", female: "female", other: "other", unknown: "unknown" } }
];

const DBFILE = path.join(__dirname, 'hie-db.json');
const adapter = new JSONFile(DBFILE);
const defaultData = { patients: [] };
const db = new Low(adapter, defaultData);

async function initDB() {
  await db.read();
  db.data ||= { patients: [] };
  await db.write();
  log('hie.db.init', { count: db.data.patients.length });
}
initDB();

function canonicalToLocalForHospital(hospital, canonicalGender) {
  return hospital.mapping[canonicalGender] ?? hospital.mapping['unknown'] ?? canonicalGender;
}

// Create (or deduplicate) Patient
app.post('/fhir/Patient', async (req, res) => {
  const p = req.body;
  if (!p || p.resourceType !== 'Patient') return res.status(400).json({ error: 'invalid patient resource' });

  await db.read();
  const incomingName = (p.name && p.name[0] && p.name[0].text) ? String(p.name[0].text).trim() : 'Unknown';
  const incomingBirthDate = p.birthDate || null;

  // Dedup key: lowercased name + birthDate
  const duplicate = db.data.patients.find(x => x.birthDate && x.name && x.name.toLowerCase() === incomingName.toLowerCase() && x.birthDate === incomingBirthDate);
  if (duplicate) {
    log('hie.patient.dedup', { existingId: duplicate.id, name: incomingName, birthDate: incomingBirthDate });
    return res.json({ ok: true, stored: false, duplicateOf: duplicate.id });
  }

  const rec = {
    id: p.id || generatePatientId(),
    name: incomingName,
    gender: p.gender || 'unknown',
    birthDate: incomingBirthDate,
    meta: p.meta || {},
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.data.patients.push(rec);
  await db.write();
  log('hie.patient.created', { id: rec.id, name: rec.name });

  // Fan out notification
  for (const h of HOSPITALS) {
    const payload = {
      resourceType: "Patient",
      id: rec.id,
      name: [{ text: rec.name }],
      gender: rec.gender,
      birthDate: rec.birthDate,
      meta: { sourceHospital: rec.meta.sourceHospital || 'Unknown', sourceLocalId: rec.meta.sourceLocalId || null, status: rec.status }
    };
    axios.post(h.notifyUrl, payload).then(() => {
      log('hie.notify.success', { hospital: h.name, id: rec.id });
    }).catch(err => {
      log('hie.notify.failure', { hospital: h.name, id: rec.id, error: err.message }, 'error');
    });
  }

  res.json({ ok: true, stored: true, id: rec.id });
});

// Soft delete (mark inactive)
async function softDeletePatient(id) {
  await db.read();
  const p = db.data.patients.find(x => x.id === id);
  if (!p) return null;
  if (p.status === 'inactive') return p;
  p.status = 'inactive';
  p.deletedAt = new Date().toISOString();
  p.updatedAt = new Date().toISOString();
  await db.write();
  log('hie.patient.softDelete', { id });
  // Notify hospitals of status change
  for (const h of HOSPITALS) {
    const payload = {
      resourceType: 'Patient',
      id: p.id,
      name: [{ text: p.name }],
      gender: p.gender,
      birthDate: p.birthDate,
      meta: { sourceHospital: p.meta.sourceHospital || 'Unknown', sourceLocalId: p.meta.sourceLocalId || null, status: p.status, action: 'soft-delete', deletedAt: p.deletedAt }
    };
    axios.post(h.notifyUrl, payload).then(() => {
      log('hie.notify.delete.success', { hospital: h.name, id: p.id });
    }).catch(err => {
      log('hie.notify.delete.failure', { hospital: h.name, id: p.id, error: err.message }, 'error');
    });
  }
  return p;
}

app.delete('/patients/:id', async (req, res) => {
  const p = await softDeletePatient(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, id: p.id, status: p.status });
});

app.delete('/fhir/Patient/:id', async (req, res) => {
  const p = await softDeletePatient(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, id: p.id, status: p.status });
});

// Search & filter patients
app.get('/patients', async (req, res) => {
  await db.read();
  let results = [...db.data.patients];
  const { name, gender, status, since } = req.query;
  if (name) {
    const n = String(name).toLowerCase();
    results = results.filter(p => p.name && p.name.toLowerCase().includes(n));
  }
  if (gender) {
    const g = String(gender).toLowerCase();
    results = results.filter(p => (p.gender || '').toLowerCase() === g);
  }
  if (status) {
    results = results.filter(p => p.status === status);
  }
  if (since) {
    const t = Date.parse(since);
    if (!isNaN(t)) {
      results = results.filter(p => Date.parse(p.createdAt) >= t);
    }
  }
  res.json({ total: results.length, patients: results });
});

app.listen(4000, () => {
  log('hie.start', { port: 4000 });
});
