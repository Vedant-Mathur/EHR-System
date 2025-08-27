# EHR-demo (3 hospitals + HIE) - ZIP package

## What is this
A runnable demo that demonstrates simple interoperability between 3 hospital nodes and a central HIE broker with advanced features:
- Hospital-A (port 3001) uses local gender codes: M/W
- Hospital-B (port 3002) uses local gender codes: 1/0
- Hospital-C (port 3003) uses canonical FHIR gender strings: male/female
- HIE (port 4000) stores canonical FHIR-like Patient resources and fans out notifications

## Advanced Features
✅ **Patient Deduplication**: Prevents duplicate patients based on name + birthDate matching  
✅ **Search & Filtering**: Query patients by name, gender, status, or date range  
✅ **Soft Delete**: Mark patients as inactive without losing data  
✅ **Structured Logging**: JSON-formatted logs for better observability  
✅ **Status Tracking**: Active/inactive patient status with timestamps
🆕 **Complete EHR Portal**: Full clinical workflow with patient registration, lab results (LOINC), radiology (DICOM), diagnosis (ICD-10), and prescriptions (NDC)

## Quick start (on your machine)
1. Install Node.js (v16+ or v18 recommended) and npm.
2. Unzip the package and open a terminal in the `ehr-demo` folder.
3. Install dependencies:
   ```powershell
   # Windows PowerShell commands:
   npm --prefix "hospital-A" install
   npm --prefix "hospital-B" install
   npm --prefix "hospital-C" install
   npm --prefix "hie" install
   npm --prefix "ehr-portal" install
   ```
4. Start services (open 5 terminals or use separate PowerShell windows):
   ```powershell
   # Terminal 1 - Start HIE first (required for notifications)
   npm --prefix "hie" start
   # Terminal 2
   npm --prefix "hospital-A" start
   # Terminal 3
   npm --prefix "hospital-B" start
   # Terminal 4
   npm --prefix "hospital-C" start
   # Terminal 5 - EHR Portal (Complete Clinical Workflow)
   npm --prefix "ehr-portal" start
   ```
   **Note**: Start the HIE server first, as hospitals need it for patient notifications.
5. Demo ingestion from Hospital A:
   ```powershell
   # Create first patient:
   curl -s -X POST http://localhost:3001/ingest -H "Content-Type: application/json" -d '{"localId":"A-1001","name":"Raghav Kumar","gender":"M","birthDate":"1990-05-10"}'
   
   # Create second patient:
   curl -s -X POST http://localhost:3001/ingest -H "Content-Type: application/json" -d '{"localId":"A-1002","name":"Sarah Johnson","gender":"W","birthDate":"1985-03-15"}'
   ```
6. Verify Hospital B received the notification and stored a locally-coded record:
   ```powershell
   curl -s http://localhost:3002/patients
   ```
   You should see the same patient with `gender_local: "0"` in Hospital B (0=female, 1=male).

7. Inspect HIE canonical records:
   ```powershell
   curl -s http://localhost:4000/patients
   ```

## 🏥 NEW: Complete EHR Portal Workflow

### Access the EHR Portal:
```powershell
# After starting all services, open:
http://localhost:5000
```

### Demo User Accounts:
- **Nurse**: `nurse` / `nurse123` (Basic patient info access)
- **Doctor**: `doctor` / `doctor123` (Full patient records + clinical workflow)
- **Lab Tech**: `lab` / `lab123` (Lab results entry)
- **Radiology Tech**: `radiology` / `radiology123` (Radiology reports)
- **Pharmacist**: `pharmacy` / `pharmacy123` (Medication dispensing)

### Complete Clinical Workflow:

#### 1. **Patient Registration** (Nurse/Doctor)
- Assign unique patient ID: `PT-YYYYMMDD-XXXXXX`
- Collect demographics and contact information
- Automatic deduplication based on name + DOB

#### 2. **Lab Tests** (Lab Tech/Doctor)
- Enter lab results with **LOINC codes** (Laboratory tests)
- Example: Complete Blood Count (LOINC: 58410-2)
- Include results, units, normal ranges

#### 3. **Radiology Studies** (Radiology Tech/Doctor)  
- Upload radiology reports with **DICOM Study IDs**
- Support for X-Ray, CT, MRI, Ultrasound
- Include findings, impressions, recommendations

#### 4. **Diagnosis** (Doctor Only)
- Enter diagnoses using **ICD-10 codes**
- Example: Type 2 Diabetes (ICD-10: E11.9)
- Include severity and treatment plans

#### 5. **Prescriptions** (Doctor Only)
- Prescribe medications using **NDC codes**
- Example: Metformin (NDC: 0093-1054-01)
- Include dosage, frequency, duration

#### 6. **Pharmacy Dispensing** (Pharmacist)
- Dispense prescribed medications
- Update medication status in global EHR
- Track dispensing history

### Role-Based Data Access:
- **Nurses**: Basic patient demographics only
- **Doctors**: Complete patient records with full clinical history
- **Lab/Radiology**: Patient info + their respective results
- **Pharmacy**: Patient info + prescription details only

## Advanced Feature Demonstrations

### 8. Test Patient Deduplication:
```powershell
# Try to create a duplicate patient (same name + birthDate):
curl -s -X POST http://localhost:3001/ingest -H "Content-Type: application/json" -d '{"localId":"A-1003","name":"Raghav Kumar","gender":"M","birthDate":"1990-05-10"}'
# Response: {"ok":true,"stored":false,"duplicateOf":"<existing-id>"}
```

### 9. Search & Filter Patients:
```powershell
# Search by name (substring match):
curl -s "http://localhost:4000/patients?name=sarah"

# Filter by gender:
curl -s "http://localhost:4000/patients?gender=male"
curl -s "http://localhost:3002/patients?gender=female"

# Filter by status:
curl -s "http://localhost:4000/patients?status=active"

# Filter by date range (patients created since specific date):
curl -s "http://localhost:4000/patients?since=2025-08-01T00:00:00Z"

# Combine filters:
curl -s "http://localhost:4000/patients?gender=female&status=active"
```

### 10. Soft Delete (Data Preservation):
```powershell
# First, get a patient ID from HIE:
curl -s http://localhost:4000/patients

# Soft delete a patient (replace <patient-id> with actual ID):
curl -s -X DELETE http://localhost:4000/patients/<patient-id>

# Verify patient is marked inactive but data preserved:
curl -s "http://localhost:4000/patients?status=inactive"

# Show all patients (active + inactive):
curl -s http://localhost:4000/patients
```

### 11. Structured Logging Output:
When services are running, you'll see structured JSON logs like:
```json
{"ts":"2025-08-12T10:30:00.000Z","level":"info","event":"hie.patient.created","id":"abc-123"}
{"ts":"2025-08-12T10:30:01.000Z","level":"info","event":"hie.notify.success","hospital":"Hospital-B","id":"abc-123"}
{"ts":"2025-08-12T10:31:00.000Z","level":"info","event":"hie.patient.dedup","existingId":"abc-123","name":"Raghav Kumar"}
```

## Notes
- This demo uses file-backed `lowdb` JSON files for persistence (`db.json`).
- **Windows users**: The commands above use PowerShell syntax with `npm --prefix` to avoid directory navigation issues.
- **lowdb compatibility**: If you encounter "lowdb: missing default data" errors, the server.js files have been updated to provide default data to the Low constructor.
- **Enhanced Features**: Includes deduplication, search/filtering, soft delete, and structured logging for production-ready interoperability patterns.
- Do NOT use real patient data.
- For a production demonstration, replace HIE with a real FHIR server (HAPI) and use SMART-on-FHIR / OAuth2 for auth.

## API Reference

### Search Parameters (All Services)
- `name` - Substring search in patient name (case-insensitive)
- `gender` - Exact match on gender (canonical or local codes)  
- `status` - Filter by active/inactive status
- `since` - ISO timestamp, returns patients created after this date

### Response Formats
**Basic listing**: `{"total": 2, "patients": [...]}`  
**Deduplication**: `{"ok": true, "stored": false, "duplicateOf": "existing-id"}`  
**Soft delete**: `{"ok": true, "id": "patient-id", "status": "inactive"}`

### Log Events
- `hie.patient.created` - New patient stored at HIE
- `hie.patient.dedup` - Duplicate patient detected
- `hie.notify.success/failure` - Hospital notification results
- `hospitalX.patient.created` - Local patient creation
- `hospitalX.patient.dedup` - Local duplicate detection

## Troubleshooting
- **"EADDRINUSE" error**: A server is already running on that port. Stop it with Ctrl+C or use Task Manager.
- **Empty arrays `[]`**: If Hospital B or C show empty patient lists, make sure:
  1. HIE server is running first
  2. You've sent at least one patient to Hospital A
  3. All servers started without errors
- **"Connection refused"**: Server isn't running. Check that all 4 services are started.
- **Gender code mapping**: 
  - Hospital A: M=male, W=female 
  - Hospital B: 1=male, 0=female
  - Hospital C: male/female (canonical FHIR)

## Checking Running Services
To check what Node.js processes are running:

```powershell
# Check all Node.js processes
Get-Process node

# Check specific ports
netstat -ano | findstr ":3001"  # Hospital A
netstat -ano | findstr ":3002"  # Hospital B  
netstat -ano | findstr ":3003"  # Hospital C
netstat -ano | findstr ":4000"  # HIE

# Check all hospital ports at once
netstat -ano | findstr "300[123]"

# Kill a specific process by PID (if needed)
Stop-Process -Id <PID> -Force
```

Quick health check for all services:
```powershell
# Test if services are responding
curl -s http://localhost:3001/patients  # Hospital A
curl -s http://localhost:3002/patients  # Hospital B
curl -s http://localhost:3003/patients  # Hospital C
curl -s http://localhost:4000/patients  # HIE
```

## Complete Demo Workflow

Follow this complete workflow to showcase all features:

```powershell
# 1. Start all services (4 terminals)
npm --prefix "hie" start
npm --prefix "hospital-A" start  
npm --prefix "hospital-B" start
npm --prefix "hospital-C" start

# 2. Create initial patients
curl -s -X POST http://localhost:3001/ingest -H "Content-Type: application/json" -d '{"localId":"A-1001","name":"John Smith","gender":"M","birthDate":"1990-05-10"}'
curl -s -X POST http://localhost:3001/ingest -H "Content-Type: application/json" -d '{"localId":"A-1002","name":"Jane Doe","gender":"W","birthDate":"1985-03-15"}'

# 3. Verify distribution across hospitals
curl -s http://localhost:3001/patients  # Hospital A (local)
curl -s http://localhost:3002/patients  # Hospital B (received via HIE)  
curl -s http://localhost:4000/patients  # HIE (canonical)

# 4. Test deduplication
curl -s -X POST http://localhost:3001/ingest -H "Content-Type: application/json" -d '{"localId":"A-1003","name":"John Smith","gender":"M","birthDate":"1990-05-10"}'

# 5. Test search & filtering
curl -s "http://localhost:4000/patients?name=john"
curl -s "http://localhost:4000/patients?gender=female"
curl -s "http://localhost:3002/patients?gender=0"  # Hospital B's local codes

# 6. Test soft delete (get patient ID first)
$patients = curl -s http://localhost:4000/patients | ConvertFrom-Json
$patientId = $patients.patients[0].id
curl -s -X DELETE "http://localhost:4000/patients/$patientId"
curl -s "http://localhost:4000/patients?status=inactive"

# 7. Monitor structured logs in terminal outputs for events like:
# {"ts":"...","event":"hie.patient.created","id":"..."}
# {"ts":"...","event":"hie.patient.dedup","existingId":"..."}
```

## Files included
- hospital-template/: template server and example config
- hospital-A/: Hospital A (port 3001) + config.json
- hospital-B/: Hospital B (port 3002) + config.json  
- hospital-C/: Hospital C (port 3003) + config.json
- hie/: HIE broker server (port 4000)
- **ehr-portal/**: Complete EHR clinical workflow system (port 5000)
- README.md (this file)

## What's Next?
Potential enhancements you could add:
- **Patient Updates**: PUT endpoints for modifying existing patients
- **Retry Queue**: Persistent retry mechanism for failed notifications  
- **FHIR Validation**: Schema validation for incoming resources
- **Authentication**: API keys or OAuth2 for secure access
- **Audit Trail**: Complete history of all patient operations
- **Web Dashboard**: Simple UI to visualize the patient network
- **Fuzzy Matching**: More sophisticated deduplication algorithms

