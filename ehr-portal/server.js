const express = require('express');
const bodyParser = require('body-parser');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const moment = require('moment');

const app = express();
app.use(bodyParser.json());
app.use(cors());
app.use(express.static('public'));

// Database setup
const dbFile = path.join(__dirname, 'ehr-global.json');
const adapter = new JSONFile(dbFile);
const defaultData = {
  patients: [],
  encounters: [],
  labResults: [],
  radiologyReports: [],
  diagnoses: [],
  prescriptions: [],
  users: [
    { id: 'nurse001', username: 'nurse', password: 'nurse123', role: 'nurse', name: 'Jane Nurse' },
    { id: 'doctor001', username: 'doctor', password: 'doctor123', role: 'doctor', name: 'Dr. Smith' },
    { id: 'lab001', username: 'lab', password: 'lab123', role: 'lab', name: 'Lab Tech' },
    { id: 'radiology001', username: 'radiology', password: 'radiology123', role: 'radiology', name: 'Radiology Tech' },
    { id: 'pharmacy001', username: 'pharmacy', password: 'pharmacy123', role: 'pharmacy', name: 'Pharmacist' }
  ]
};
const db = new Low(adapter, defaultData);

// Initialize database
async function initDB() {
  await db.read();
  db.data ||= defaultData;
  await db.write();
  console.log(`📊 EHR Portal initialized with ${db.data.patients.length} patients`);
}
initDB();

// Structured logging
function log(event, data = {}, level = 'info') {
  console.log(JSON.stringify({
    timestamp: moment().toISOString(),
    level,
    event,
    ...data
  }));
}

// Utility functions
function generatePatientId() {
  return `PT-${moment().format('YYYYMMDD')}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
}

function generateEncounterId() {
  return `ENC-${moment().format('YYYYMMDD')}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
}

// Authentication middleware (simplified)
function authenticate(req, res, next) {
  const { username, password } = req.headers;
  const user = db.data.users.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.status(401).json({ error: 'Authentication failed' });
  }
  req.user = user;
  log('auth.success', { userId: user.id, role: user.role });
  next();
}

// Role-based access control
function requireRole(roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Required roles: ${roles.join(', ')}` });
    }
    next();
  };
}

// === PATIENT REGISTRATION ===
app.post('/api/patients/register', authenticate, requireRole(['nurse', 'doctor']), async (req, res) => {
  const { firstName, lastName, dateOfBirth, gender, phone, address, emergencyContact } = req.body;
  
  if (!firstName || !lastName || !dateOfBirth) {
    return res.status(400).json({ error: 'Missing required fields: firstName, lastName, dateOfBirth' });
  }

  await db.read();
  
  // Check for existing patient (basic deduplication)
  const existing = db.data.patients.find(p => 
    p.firstName.toLowerCase() === firstName.toLowerCase() && 
    p.lastName.toLowerCase() === lastName.toLowerCase() && 
    p.dateOfBirth === dateOfBirth
  );
  
  if (existing) {
    log('patient.duplicate_detected', { existingId: existing.id });
    return res.json({ 
      exists: true, 
      patientId: existing.id,
      message: 'Patient already exists in system'
    });
  }

  const patientId = generatePatientId();
  const patient = {
    id: patientId,
    firstName,
    lastName,
    dateOfBirth,
    gender: gender || 'unknown',
    phone: phone || '',
    address: address || '',
    emergencyContact: emergencyContact || '',
    registeredAt: moment().toISOString(),
    registeredBy: req.user.id,
    status: 'active'
  };

  db.data.patients.push(patient);
  await db.write();

  log('patient.registered', { patientId, registeredBy: req.user.id });
  res.json({ 
    success: true, 
    patientId, 
    message: 'Patient registered successfully' 
  });
});

// === PATIENT LOOKUP ===
app.get('/api/patients/:patientId', authenticate, async (req, res) => {
  await db.read();
  const patient = db.data.patients.find(p => p.id === req.params.patientId);
  
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  // Role-based data filtering
  let responseData;
  if (req.user.role === 'nurse') {
    // Nurses get basic info only
    responseData = {
      id: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      phone: patient.phone,
      status: patient.status
    };
  } else if (req.user.role === 'doctor') {
    // Doctors get complete patient record
    const encounters = db.data.encounters.filter(e => e.patientId === patient.id);
    const labResults = db.data.labResults.filter(l => l.patientId === patient.id);
    const radiologyReports = db.data.radiologyReports.filter(r => r.patientId === patient.id);
    const diagnoses = db.data.diagnoses.filter(d => d.patientId === patient.id);
    const prescriptions = db.data.prescriptions.filter(p => p.patientId === patient.id);
    
    responseData = {
      ...patient,
      encounters,
      labResults,
      radiologyReports,
      diagnoses,
      prescriptions
    };
  } else {
    // Other roles get minimal info
    responseData = {
      id: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      status: patient.status
    };
  }

  log('patient.accessed', { patientId: patient.id, accessedBy: req.user.id, role: req.user.role });
  res.json(responseData);
});

// === LAB RESULTS (LOINC) ===
app.post('/api/lab-results', authenticate, requireRole(['lab', 'doctor']), async (req, res) => {
  const { patientId, testName, loincCode, result, unit, normalRange, notes } = req.body;
  
  if (!patientId || !testName || !loincCode || !result) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  await db.read();
  const patient = db.data.patients.find(p => p.id === patientId);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const labResult = {
    id: uuidv4(),
    patientId,
    testName,
    loincCode,
    result,
    unit: unit || '',
    normalRange: normalRange || '',
    notes: notes || '',
    performedAt: moment().toISOString(),
    performedBy: req.user.id,
    status: 'completed'
  };

  db.data.labResults.push(labResult);
  await db.write();

  log('lab.result_added', { patientId, loincCode, performedBy: req.user.id });
  res.json({ success: true, labResultId: labResult.id });
});

// === RADIOLOGY REPORTS (DICOM) ===
app.post('/api/radiology-reports', authenticate, requireRole(['radiology', 'doctor']), async (req, res) => {
  const { patientId, studyType, dicomStudyId, findings, impression, recommendations } = req.body;
  
  if (!patientId || !studyType || !findings) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  await db.read();
  const patient = db.data.patients.find(p => p.id === patientId);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const radiologyReport = {
    id: uuidv4(),
    patientId,
    studyType,
    dicomStudyId: dicomStudyId || `DICOM-${uuidv4()}`,
    findings,
    impression: impression || '',
    recommendations: recommendations || '',
    reportedAt: moment().toISOString(),
    reportedBy: req.user.id,
    status: 'completed'
  };

  db.data.radiologyReports.push(radiologyReport);
  await db.write();

  log('radiology.report_added', { patientId, studyType, reportedBy: req.user.id });
  res.json({ success: true, reportId: radiologyReport.id });
});

// === DIAGNOSIS (ICD-10) ===
app.post('/api/diagnoses', authenticate, requireRole(['doctor']), async (req, res) => {
  const { patientId, icd10Code, description, severity, notes, treatmentPlan } = req.body;
  
  if (!patientId || !icd10Code || !description) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  await db.read();
  const patient = db.data.patients.find(p => p.id === patientId);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const diagnosis = {
    id: uuidv4(),
    patientId,
    icd10Code,
    description,
    severity: severity || 'moderate',
    notes: notes || '',
    treatmentPlan: treatmentPlan || '',
    diagnosedAt: moment().toISOString(),
    diagnosedBy: req.user.id,
    status: 'active'
  };

  db.data.diagnoses.push(diagnosis);
  await db.write();

  log('diagnosis.added', { patientId, icd10Code, diagnosedBy: req.user.id });
  res.json({ success: true, diagnosisId: diagnosis.id });
});

// === PRESCRIPTIONS (NDC) ===
app.post('/api/prescriptions', authenticate, requireRole(['doctor']), async (req, res) => {
  const { patientId, medicationName, ndcCode, dosage, frequency, duration, instructions } = req.body;
  
  if (!patientId || !medicationName || !ndcCode || !dosage) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  await db.read();
  const patient = db.data.patients.find(p => p.id === patientId);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const prescription = {
    id: uuidv4(),
    patientId,
    medicationName,
    ndcCode,
    dosage,
    frequency,
    duration: duration || '',
    instructions: instructions || '',
    prescribedAt: moment().toISOString(),
    prescribedBy: req.user.id,
    status: 'active',
    dispensed: false
  };

  db.data.prescriptions.push(prescription);
  await db.write();

  log('prescription.created', { patientId, ndcCode, prescribedBy: req.user.id });
  res.json({ success: true, prescriptionId: prescription.id });
});

// === PHARMACY - DISPENSE MEDICATION ===
app.post('/api/prescriptions/:prescriptionId/dispense', authenticate, requireRole(['pharmacy']), async (req, res) => {
  await db.read();
  const prescription = db.data.prescriptions.find(p => p.id === req.params.prescriptionId);
  
  if (!prescription) {
    return res.status(404).json({ error: 'Prescription not found' });
  }

  if (prescription.dispensed) {
    return res.status(400).json({ error: 'Prescription already dispensed' });
  }

  prescription.dispensed = true;
  prescription.dispensedAt = moment().toISOString();
  prescription.dispensedBy = req.user.id;
  await db.write();

  log('prescription.dispensed', { prescriptionId: prescription.id, dispensedBy: req.user.id });
  res.json({ success: true, message: 'Prescription dispensed successfully' });
});

// === WORKFLOW STATUS CHECK ===
app.get('/api/patients/:patientId/workflow-status', authenticate, requireRole(['doctor', 'nurse']), async (req, res) => {
  await db.read();
  const patientId = req.params.patientId;
  
  const patient = db.data.patients.find(p => p.id === patientId);
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }

  const labResults = db.data.labResults.filter(l => l.patientId === patientId);
  const radiologyReports = db.data.radiologyReports.filter(r => r.patientId === patientId);
  const diagnoses = db.data.diagnoses.filter(d => d.patientId === patientId);
  const prescriptions = db.data.prescriptions.filter(p => p.patientId === patientId);

  const workflowStatus = {
    patientId,
    patientName: `${patient.firstName} ${patient.lastName}`,
    steps: {
      registration: { completed: true, completedAt: patient.registeredAt },
      labTests: { 
        completed: labResults.length > 0, 
        count: labResults.length,
        latest: labResults.length > 0 ? labResults[labResults.length - 1].performedAt : null 
      },
      radiology: { 
        completed: radiologyReports.length > 0, 
        count: radiologyReports.length,
        latest: radiologyReports.length > 0 ? radiologyReports[radiologyReports.length - 1].reportedAt : null 
      },
      diagnosis: { 
        completed: diagnoses.length > 0, 
        count: diagnoses.length,
        latest: diagnoses.length > 0 ? diagnoses[diagnoses.length - 1].diagnosedAt : null 
      },
      prescription: { 
        completed: prescriptions.length > 0, 
        count: prescriptions.length,
        dispensed: prescriptions.filter(p => p.dispensed).length
      }
    },
    nextSteps: []
  };

  // Determine next steps in workflow
  if (!workflowStatus.steps.labTests.completed) {
    workflowStatus.nextSteps.push('Complete lab tests');
  } else if (!workflowStatus.steps.radiology.completed) {
    workflowStatus.nextSteps.push('Complete radiology studies');
  } else if (!workflowStatus.steps.diagnosis.completed) {
    workflowStatus.nextSteps.push('Provide diagnosis');
  } else if (!workflowStatus.steps.prescription.completed) {
    workflowStatus.nextSteps.push('Prescribe medications');
  } else {
    const pendingDispensing = prescriptions.filter(p => !p.dispensed).length;
    if (pendingDispensing > 0) {
      workflowStatus.nextSteps.push(`Dispense ${pendingDispensing} pending prescription(s)`);
    } else {
      workflowStatus.nextSteps.push('Patient care cycle complete');
    }
  }

  res.json(workflowStatus);
});

// === SEARCH PATIENTS ===
app.get('/api/patients', authenticate, async (req, res) => {
  await db.read();
  const { search, status } = req.query;
  
  let patients = [...db.data.patients];
  
  if (search) {
    const searchTerm = search.toLowerCase();
    patients = patients.filter(p => 
      p.firstName.toLowerCase().includes(searchTerm) ||
      p.lastName.toLowerCase().includes(searchTerm) ||
      p.id.toLowerCase().includes(searchTerm)
    );
  }
  
  if (status) {
    patients = patients.filter(p => p.status === status);
  }

  // Filter response based on role
  if (req.user.role === 'nurse') {
    patients = patients.map(p => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth,
      status: p.status
    }));
  }

  res.json({ total: patients.length, patients });
});

// === HEALTH CHECK ===
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: moment().toISOString(),
    database: 'connected'
  });
});

const PORT = 5000;
app.listen(PORT, () => {
  log('ehr.portal.started', { port: PORT });
  console.log(`🏥 EHR Portal running on http://localhost:${PORT}`);
});
