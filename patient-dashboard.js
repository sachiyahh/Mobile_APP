// Compat version (no ES module imports). Uses global firebase from CDN.
// Initializes Firebase locally if not already initialized elsewhere.
if (!window.firebase || !firebase.apps || !firebase.apps.length) {
    const firebaseConfig = {
        apiKey: "AIzaSyAL6rvtbGZoWOQxm2o3fYxvFniwKz9GpXM",
        authDomain: "raygain-cf637.firebaseapp.com",
        projectId: "raygain-cf637",
        storageBucket: "raygain-cf637.firebasestorage.app",
        messagingSenderId: "258723115236",
        appId: "1:258723115236:web:766902037a28c178e6fcf1",
        measurementId: "G-7DXLCJCLVE"
    };
    firebase.initializeApp(firebaseConfig);
}
var db = firebase.firestore();
// Keep unsubscribe ref for medical records listener to allow dynamic patient filtering.
let _medicalRecordsUnsub = null;

// Sidebar navigation logic
const sections = {
    analyticsSection: document.getElementById('analyticsSection'),
    medicalRecordsSection: document.getElementById('medicalRecordsSection'),
    appointmentsSection: document.getElementById('appointmentsSection')
};

document.getElementById('analyticsBtn').onclick = function() {
    showSection('analyticsSection');
};
// Optional patient-specific navigation button: if exists
const medicalRecordsBtn = document.getElementById('medicalRecordsBtn');
if (medicalRecordsBtn) {
    medicalRecordsBtn.onclick = function() { showSection('medicalRecordsSection'); };
}
document.getElementById('appointmentsBtn').onclick = function() {
    showSection('appointmentsSection');
};
document.getElementById('logoutBtn').onclick = function() {
    sessionStorage.removeItem('patientId');
    window.location.href = 'login.html';
};

function showSection(sectionId) {
    Object.values(sections).forEach(sec => sec.style.display = 'none');
    sections[sectionId].style.display = 'block';
}

// Example: Chart for ROM, Strength (replace with real data from Firebase)
const ctx = document.getElementById('romStrengthChart').getContext('2d');
if (window.Chart) {
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['ROM', 'Strength'],
            datasets: [{
                label: 'Score',
                data: [80, 65],
                backgroundColor: ['#2ecac8', '#24b0b0']
            }]
        },
        options: {
            responsive: false,
            scales: { y: { beginAtZero: true, max: 100 } }
        }
    });
}

// Derive current patient identifier (support query param or sessionStorage)
function resolveCurrentPatientId() {
    const params = new URLSearchParams(window.location.search);
    const pid = params.get('patientId') || sessionStorage.getItem('patientId');
    return pid ? pid.trim() : null;
}
    // Resolve both patient number (patientId) and Firestore doc id (patientDocId)
    function resolveCurrentPatientIdentifiers() {
        const params = new URLSearchParams(window.location.search);
        const pid = params.get('patientId') || sessionStorage.getItem('patientId');
        const pdoc = params.get('patientDocId') || sessionStorage.getItem('patientDocId');
        return {
            patientId: pid ? pid.trim() : null,
            patientDocId: pdoc ? pdoc.trim() : null
        };
    }

// Real-time load and display medical records for current patient (or all if no patient id)
async function startMedicalRecordsListener() {
    const medicalTableBody = document.getElementById('medicalTableBody');
    if (!medicalTableBody) return;
    if (_medicalRecordsUnsub) { try { _medicalRecordsUnsub(); } catch(e){} _medicalRecordsUnsub = null; }
        const { patientId, patientDocId } = resolveCurrentPatientIdentifiers();
    console.log('[patient-dashboard] startMedicalRecordsListener identifiers', { patientId, patientDocId });
    medicalTableBody.innerHTML = '';
    if (!patientId) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="9" style="text-align:center;padding:14px;">No patient session detected. Please log in.</td>';
        medicalTableBody.appendChild(row);
        return;
    }
    // Fetch patient doc to enrich (caseHistory fallback for diagnosis)
    let patientDoc = null;
    try {
            let pSnap = null;
            if (patientDocId) {
                const direct = await db.collection('patients').doc(patientDocId).get();
                if (direct.exists) {
                    patientDoc = direct.data();
                console.log('[patient-dashboard] found patient by docId', patientDocId);
                }
            }
            if (!patientDoc && patientId) {
                pSnap = await db.collection('patients').where('patientId','==',patientId).limit(1).get();
                if (!pSnap.empty) patientDoc = pSnap.docs[0].data();
            if (patientDoc) console.log('[patient-dashboard] found patient by patientId', patientId);
            }
    } catch(e){ console.warn('Patient enrichment failed', e); }

    // Update header with patient name and ID
    try {
        const nameParts = patientDoc ? [patientDoc.firstName, patientDoc.middleName, patientDoc.lastName] : [];
        const fullName = nameParts.filter(Boolean).join(' ').trim();
        const nameEl = document.getElementById('patientProfileName');
        const idEl = document.getElementById('patientProfileNumber');
        if (nameEl) nameEl.textContent = fullName || 'Patient';
        if (idEl) idEl.textContent = patientId || '';
    } catch (hdrErr) { console.warn('Header update failed', hdrErr); }

    // Run multiple fallback queries similar to therapist viewRecords logic
    const queryPromises = [
            patientId ? db.collection('medicalRecords').where('patientId','==',patientId).get() : Promise.resolve({docs:[]}),
            patientDocId ? db.collection('medicalRecords').where('patientDocId','==',patientDocId).get() : Promise.resolve({docs:[]}),
            patientId ? db.collection('medicalRecords').where('patientId','==',patientId.toLowerCase()).get().catch(()=>({docs:[]})) : Promise.resolve({docs:[]})
    ];
    // Attempt patientName-based match if we have the name
    if (patientDoc) {
        const patientName = [patientDoc.firstName, patientDoc.middleName, patientDoc.lastName].filter(Boolean).join(' ').trim();
        if (patientName) queryPromises.push(db.collection('medicalRecords').where('patientName','==',patientName).get().catch(()=>({docs:[]})));
    }
    // Cross-field fallbacks (records created before consistent identifiers): patientId stored as doc id or vice versa
    if (patientDocId) queryPromises.push(db.collection('medicalRecords').where('patientId','==',patientDocId).get().catch(()=>({docs:[]})));
    if (patientId) queryPromises.push(db.collection('medicalRecords').where('patientDocId','==',patientId).get().catch(()=>({docs:[]})));
    let mergedDocs = [];
    try {
        const results = await Promise.all(queryPromises);
        results.forEach((snap,i)=>console.log('[patient-dashboard] query result', i, 'count', snap.docs ? snap.docs.length : 0));
        const uniq = new Map();
        results.forEach(snap => snap.docs.forEach(d => { if (!uniq.has(d.id)) uniq.set(d.id,d); }));
        mergedDocs = Array.from(uniq.values());
    } catch(e){ console.error('Medical record queries failed', e); }

    // Sort newest first by date
    mergedDocs.sort((a,b)=> new Date(b.data().date||0) - new Date(a.data().date||0));
    console.log('[patient-dashboard] merged medical records count', mergedDocs.length);
    if (mergedDocs.length === 0) {
        console.log('[patient-dashboard] initiating broad fallback scan of medicalRecords collection');
        try {
            const broadSnap = await db.collection('medicalRecords').get();
            const all = broadSnap.docs.map(d=>d);
            const lowerPid = patientId ? patientId.toLowerCase() : null;
            const nameCandidate = patientDoc ? [patientDoc.firstName, patientDoc.middleName, patientDoc.lastName].filter(Boolean).join(' ').trim() : null;
            const filtered = all.filter(doc => {
                const r = doc.data();
                if (!r) return false;
                const pidMatch = patientId && (r.patientId === patientId || r.patientId === lowerPid);
                const pdocMatch = patientDocId && r.patientDocId === patientDocId;
                const crossMatch = patientId && r.patientDocId === patientId;
                const reverseCross = patientDocId && r.patientId === patientDocId;
                const nameMatch = nameCandidate && (r.patientName === nameCandidate);
                // Legacy alternate field names
                const legacyNumberMatch = patientId && (r.patientNumber === patientId || r.patient_number === patientId);
                return pidMatch || pdocMatch || crossMatch || reverseCross || nameMatch || legacyNumberMatch;
            });
            console.log('[patient-dashboard] broad scan total', all.length, 'filtered matches', filtered.length);
            if (filtered.length === 0) {
                console.group('[patient-dashboard] broad scan record key dump (no matches)');
                all.forEach(d => {
                    const data = d.data();
                    console.log('doc', d.id, 'keys', Object.keys(data));
                    if (data.patientId || data.patientDocId || data.patientName || data.patientNumber || data.patient_number) {
                        console.log('identifiers =>', {
                            patientId: data.patientId,
                            patientDocId: data.patientDocId,
                            patientName: data.patientName,
                            patientNumber: data.patientNumber || data.patient_number
                        });
                    }
                });
                console.groupEnd();
                // Attempt indirect mapping: some legacy records stored patientId = patient document ID.
                if (patientId && !patientDocId) {
                    console.log('[patient-dashboard] attempting indirect mapping via patients collection');
                    try {
                        const patientsSnap = await db.collection('patients').get();
                        const docIdForPatientNumber = patientsSnap.docs.find(p => {
                            const pdata = p.data();
                            return pdata && pdata.patientId === patientId;
                        });
                        if (docIdForPatientNumber) {
                            const realDocId = docIdForPatientNumber.id;
                            const indirect = all.filter(doc => doc.data().patientId === realDocId || doc.data().patientDocId === realDocId);
                            console.log('[patient-dashboard] indirect mapping realDocId', realDocId, 'indirect matches', indirect.length);
                            if (indirect.length > 0) {
                                mergedDocs = indirect;
                                mergedDocs.sort((a,b)=> new Date(b.data().date||0) - new Date(a.data().date||0));
                            }
                        } else {
                            console.log('[patient-dashboard] no patient document found matching patientId number for indirect mapping');
                        }
                    } catch(indirectErr) { console.warn('[patient-dashboard] indirect mapping failed', indirectErr); }
                }
            }
            if (filtered.length > 0) {
                mergedDocs = filtered;
                mergedDocs.sort((a,b)=> new Date(b.data().date||0) - new Date(a.data().date||0));
            }
        } catch(scanErr){ console.warn('[patient-dashboard] broad scan failed', scanErr); }
    }
    if (mergedDocs.length === 0) {
        const empty = document.createElement('tr');
        empty.innerHTML = '<td colspan="10" style="text-align:center;padding:14px;">No records yet.</td>';
        medicalTableBody.appendChild(empty);
        return;
    }
    mergedDocs.forEach(docSnap => {
        const r = docSnap.data();
        // Diagnosis fallback from patient caseHistory if missing
        const diagnosisVal = r.diagnosis || (patientDoc ? patientDoc.caseHistory : '') || '';
        // Pain formatting identical to therapist view
        let painVal='';
        if (r.pain !== undefined && r.pain !== null) {
            const s = String(r.pain).trim();
            if (s.includes('/')||s==='') painVal=s; else if (/^\d+(?:\.\d+)?$/.test(s)) painVal=s+'/10'; else painVal=s;
        }
            let funcImp = r.functionalImprovement;
            if (funcImp === null || funcImp === undefined || (typeof funcImp === 'number' && isNaN(funcImp))) funcImp = '';
        const funcNotes = r.functionalNotes || '';
            let attendance = r.attendance;
            if (attendance === null || attendance === undefined || (typeof attendance === 'number' && isNaN(attendance))) attendance = '';
        const subjectiveVal = r.subjectiveNotes || r.subjectiveData || '';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${r.date || ''}</td>
            <td>${r.treatmentTime || ''}</td>
            <td>${attendance}</td>
            <td>${diagnosisVal}</td>
            <td>${painVal}</td>
            <td>${r.location || ''}</td>
            <td>${subjectiveVal}</td>
            <td>${funcImp}</td>
            <td>${funcNotes}</td>
            <td>${r.goalStatus || ''}</td>`;
        row.dataset.recordId = docSnap.id;
        row.style.cursor = 'pointer';
        row.addEventListener('click', () => viewRecord(docSnap.id));
        medicalTableBody.appendChild(row);
    });
}

function wireRecordButtons() {
    document.querySelectorAll('.viewRecordBtn').forEach(btn => {
        btn.onclick = async function() {
            const id = btn.getAttribute('data-id');
            await viewRecord(id);
        };
    });
}

async function viewRecord(recordId) {
    const modal = document.getElementById('viewRecordModal');
    const details = document.getElementById('recordDetails');
    if (!modal || !details) return;
    details.innerHTML = 'Loading...';
    modal.style.display = 'flex';
    try {
        const docSnap = await db.collection('medicalRecords').doc(recordId).get();
        if (!docSnap.exists) { details.textContent = 'Record not found.'; return; }
        const r = docSnap.data();
        const lines = [];
        function push(label, val) { if (val !== undefined && val !== null && String(val).trim() !== '') lines.push(`<strong>${label}:</strong> ${String(val)}`); }
        push('Date', r.date);
        push('Treatment Time', r.treatmentTime);
        push('Attendance', r.attendance);
        push('Diagnosis', r.diagnosis);
        if (r.pain !== undefined) push('Pain', (/^\d+(?:\.\d+)?$/.test(String(r.pain).trim())) ? r.pain + '/10' : r.pain);
        push('Location', r.location);
        push('Subjective Notes', r.subjectiveNotes || r.subjectiveData);
        push('Functional %', r.functionalImprovement);
        push('Functional Notes', r.functionalNotes);
        push('Goal Status', r.goalStatus);
        details.innerHTML = lines.join('<br>');
    } catch (err) {
        console.error('Error loading record:', err);
        details.textContent = 'Error loading record.';
    }
}

const closeViewRecordModalBtn = document.getElementById('closeViewRecordModal');
if (closeViewRecordModalBtn) {
    closeViewRecordModalBtn.onclick = function() {
        const modal = document.getElementById('viewRecordModal');
        if (modal) modal.style.display = 'none';
        const details = document.getElementById('recordDetails');
        if (details) details.innerHTML = '';
    };
}

// Patient-specific calendar (similar to therapist view, read-only)
let patientCalendarMonth = new Date();
let _patientApptUnsub = null;
let _patientAppointmentsCache = [];
async function loadPatientAppointmentsRaw(){
    // fallback one-time load if realtime not active
    const snap = await db.collection('appointments').get();
    return snap.docs.map(d=>({id:d.id, ...d.data()}));
}
function patientFullNameFromDoc(pDoc){
    if(!pDoc) return '';
    return [pDoc.firstName,pDoc.middleName,pDoc.lastName].filter(Boolean).join(' ').trim();
}
function getFilterFlags(){
    const home = document.getElementById('filterHome');
    const clinic = document.getElementById('filterClinic');
    return {
        home: !home || home.checked,
        clinic: !clinic || clinic.checked
    };
}
function filteredAppointmentsForPatient(all, patientId, patientDocId, fullName){
    const f = getFilterFlags();
    return all.filter(a => (
        (patientId && a.patientId === patientId) ||
        (patientDocId && a.patientDocId === patientDocId) ||
        (fullName && a.patientName === fullName)
    ) && (
        (a.sessionType === 'Home' && f.home) ||
        (a.sessionType === 'Clinic' && f.clinic) ||
        (!a.sessionType) // include unknown if filters allow? treat as always visible
    ));
}
async function renderPatientCalendar(){
    const grid = document.getElementById('patientCalendarGrid');
    const labelEl = document.getElementById('patientMonthLabel');
    if(!grid || !labelEl) return;
    const { patientId, patientDocId } = resolveCurrentPatientIdentifiers();
    // obtain patient doc for name matching
    let pDoc = null;
    try {
        if(patientDocId){
            const direct = await db.collection('patients').doc(patientDocId).get();
            if(direct.exists) pDoc = direct.data();
        }
        if(!pDoc && patientId){
            const q = await db.collection('patients').where('patientId','==',patientId).limit(1).get();
            if(!q.empty) pDoc = q.docs[0].data();
        }
    } catch(e){ console.warn('patientCalendar: patient doc fetch failed', e); }
    const fullName = patientFullNameFromDoc(pDoc);
    const all = _patientAppointmentsCache.length ? _patientAppointmentsCache : await loadPatientAppointmentsRaw();
    const relevant = filteredAppointmentsForPatient(all, patientId, patientDocId, fullName);
    const year = patientCalendarMonth.getFullYear();
    const month = patientCalendarMonth.getMonth();
    labelEl.textContent = patientCalendarMonth.toLocaleString('default',{month:'long',year:'numeric'});
    grid.innerHTML = '';
    const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    weekdays.forEach(d=>{ const wd=document.createElement('div'); wd.className='weekday'; wd.textContent=d; grid.appendChild(wd); });
    const firstDay = new Date(year,month,1).getDay();
    const daysInMonth = new Date(year,month+1,0).getDate();
    for(let i=0;i<firstDay;i++) grid.appendChild(document.createElement('div'));
    for(let d=1; d<=daysInMonth; d++){
        const cell=document.createElement('div');
        cell.className='day';
        const thisDate = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
        if(new Date(thisDate).toDateString() === new Date().toDateString()) cell.classList.add('day-today');
        cell.innerHTML = '<div>'+d+'</div>';
        relevant.filter(r=>r.date === thisDate).forEach(r => {
            const badge=document.createElement('span');
            badge.className='schedule-badge';
            if (r.sessionType === 'Home') badge.classList.add('session-type-home');
            else if (r.sessionType === 'Clinic') badge.classList.add('session-type-clinic');
            badge.textContent = r.sessionType || 'Session';
            badge.title = (r.description || '') + (r.patientName ? ' - '+r.patientName : '');
            badge.onclick = () => showPatientFloatingCard(r);
            cell.appendChild(badge);
        });
        grid.appendChild(cell);
    }
}
async function updateAppointment(apptId, data){
    try { await db.collection('appointments').doc(apptId).set(data, { merge:true }); }
    catch(e){ console.warn('updateAppointment failed', e); }
}
async function deleteAppointment(apptId){
    try { await db.collection('appointments').doc(apptId).delete(); }
    catch(e){ console.warn('deleteAppointment failed', e); }
}
function showPatientFloatingCard(appt){
    const card = document.getElementById('patientFloatingCard');
    if(!card) return;
    const nameEl = document.getElementById('pfcName');
    const typeEl = document.getElementById('pfcType');
    const dateEl = document.getElementById('pfcDate');
    const descEl = document.getElementById('pfcDesc');
    const editRow = document.getElementById('pfcEditRow');
    const actions = document.getElementById('pfcActions');
    const editTextarea = document.getElementById('pfcEditDescription');
    if(nameEl) nameEl.textContent = appt.patientName || '';
    if(typeEl) typeEl.textContent = appt.sessionType || '';
    if(dateEl) dateEl.textContent = appt.date || '';
    if(descEl) descEl.textContent = appt.description || '';
    // Allow edit/delete only if this appointment belongs to current patient
    const { patientId, patientDocId } = resolveCurrentPatientIdentifiers();
    const canModify = (appt.patientId && appt.patientId === patientId) || (appt.patientDocId && appt.patientDocId === patientDocId);
    if(canModify){
        if(editRow) editRow.style.display = 'flex';
        if(actions) actions.style.display = 'flex';
        if(editTextarea) editTextarea.value = appt.description || '';
        // Wire buttons
        const saveBtn = document.getElementById('pfcSave');
        const delBtn = document.getElementById('pfcDelete');
        if(saveBtn){
            saveBtn.onclick = async () => {
                await updateAppointment(appt.id, { description: editTextarea.value });
                card.style.display='none'; card.classList.add('hidden');
                renderPatientCalendar();
            };
        }
        if(delBtn){
            delBtn.onclick = async () => {
                if(confirm('Delete this appointment?')){
                    await deleteAppointment(appt.id);
                    card.style.display='none'; card.classList.add('hidden');
                    renderPatientCalendar();
                }
            };
        }
    } else {
        if(editRow) editRow.style.display = 'none';
        if(actions) actions.style.display = 'none';
    }
    card.style.display='block';
    card.classList.remove('hidden');
}
const pPrev = document.getElementById('patientPrevMonth');
const pNext = document.getElementById('patientNextMonth');
const pfcCloseBtn = document.getElementById('pfcClose');
if(pPrev) pPrev.onclick = ()=>{ patientCalendarMonth.setMonth(patientCalendarMonth.getMonth()-1); renderPatientCalendar(); };
if(pNext) pNext.onclick = ()=>{ patientCalendarMonth.setMonth(patientCalendarMonth.getMonth()+1); renderPatientCalendar(); };
const filterHomeEl = document.getElementById('filterHome');
const filterClinicEl = document.getElementById('filterClinic');
if(filterHomeEl) filterHomeEl.onchange = () => renderPatientCalendar();
if(filterClinicEl) filterClinicEl.onchange = () => renderPatientCalendar();
if(pfcCloseBtn) pfcCloseBtn.onclick = ()=>{ const card=document.getElementById('patientFloatingCard'); if(card){ card.style.display='none'; card.classList.add('hidden'); } };

// Initialize page content
function startPatientAppointmentsListener(){
    if(_patientApptUnsub){ try{ _patientApptUnsub(); }catch(e){} _patientApptUnsub=null; }
    _patientApptUnsub = db.collection('appointments').onSnapshot(snap => {
        _patientAppointmentsCache = snap.docs.map(d=>({id:d.id, ...d.data()}));
        renderPatientCalendar();
    }, err => { console.warn('appointments listener error', err); });
}
startMedicalRecordsListener();
startPatientAppointmentsListener();

// Data normalization utility: fix legacy medicalRecords that used patientId field to store a patient document ID instead of the patient number.
// Usage (DevTools console): normalizeMedicalRecords('0007P')
window.normalizeMedicalRecords = async function(normalizePatientNumber){
    if(!normalizePatientNumber){ console.warn('normalizeMedicalRecords: supply patient number e.g. normalizeMedicalRecords("0001P")'); return; }
    console.group('[normalizeMedicalRecords] start', normalizePatientNumber);
    try {
        const patSnap = await db.collection('patients').where('patientId','==',normalizePatientNumber).limit(1).get();
        if(patSnap.empty){ console.warn('No patient document found for number', normalizePatientNumber); console.groupEnd(); return; }
        const pdoc = patSnap.docs[0];
        const realDocId = pdoc.id;
        console.log('Resolved patient number -> docId', realDocId);
        const medSnap = await db.collection('medicalRecords').get();
        const toUpdate = [];
        medSnap.docs.forEach(d => {
            const data = d.data();
            if(!data) return;
            // Identify records where patientId equals the real doc id or patientDocId missing/empty
            const patientIdLooksLikeDoc = data.patientId && data.patientId === realDocId;
            const emptyDocIdField = !data.patientDocId || data.patientDocId === '';
            if (patientIdLooksLikeDoc || emptyDocIdField) {
                // Only update if not already normalized for this patient number
                if (data.patientId !== normalizePatientNumber || data.patientDocId !== realDocId) {
                    toUpdate.push({ id:d.id, before:data });
                }
            }
        });
        console.log('Candidate legacy records to update', toUpdate.length);
        for(const rec of toUpdate){
            const updated = Object.assign({}, rec.before, {
                patientId: normalizePatientNumber,
                patientDocId: realDocId
            });
            await db.collection('medicalRecords').doc(rec.id).set(updated, { merge:true });
            console.log('Updated record', rec.id);
        }
        console.log('Normalization finished. Reload page to verify.');
    } catch(err){ console.error('normalizeMedicalRecords error', err); }
    console.groupEnd();
};

// Batch normalization for ALL patients. Run once in DevTools: normalizeAllMedicalRecords()
// It will:
// 1. Load all patients, build maps of { docId -> patientNumber } and { patientNumber -> docId }
// 2. Load all medicalRecords.
// 3. For each record, decide the correct patientId/patientDocId:
//    - If patientId equals a patient document ID, replace with that patient's patientId (number) and set patientDocId.
//    - If patientDocId missing but patientId matches a patientNumber, set patientDocId accordingly.
//    - Skip if already normalized.
// 4. Write minimal merges (patientId + patientDocId) so other fields untouched.
// Provides a summary of changes.
window.normalizeAllMedicalRecords = async function(){
    console.group('[normalizeAllMedicalRecords] start');
    try {
        const patientsSnap = await db.collection('patients').get();
        const byDocId = new Map();
        const byNumber = new Map();
        patientsSnap.docs.forEach(p => {
            const data = p.data() || {}; const number = data.patientId || ''; if(number) { byDocId.set(p.id, number); byNumber.set(number, p.id); }
        });
        console.log('Loaded patients', patientsSnap.size);
        const medSnap = await db.collection('medicalRecords').get();
        console.log('Loaded medicalRecords', medSnap.size);
        const updates = [];
        medSnap.docs.forEach(d => {
            const m = d.data() || {}; if(!m) return;
            let newPatientNumber = null; let newPatientDocId = null; let needs = false;
            // Case A: patientId is actually a docId
            if(m.patientId && byDocId.has(m.patientId)) {
                newPatientNumber = byDocId.get(m.patientId);
                newPatientDocId = m.patientId; // original value is doc id
                // If stored number already matches, skip.
                if(m.patientId !== newPatientNumber || m.patientDocId !== newPatientDocId) needs = true;
            }
            // Case B: patientDocId missing but patientId is a patient number we know.
            else if(!m.patientDocId && m.patientId && byNumber.has(m.patientId)) {
                newPatientNumber = m.patientId;
                newPatientDocId = byNumber.get(m.patientId);
                needs = true;
            }
            // Case C: patientDocId present but patientId empty; fill number.
            else if(m.patientDocId && !m.patientId && byDocId.has(m.patientDocId)) {
                newPatientNumber = byDocId.get(m.patientDocId);
                newPatientDocId = m.patientDocId;
                needs = true;
            }
            if(needs) {
                updates.push({ id:d.id, newPatientNumber, newPatientDocId });
            }
        });
        console.log('Records needing normalization', updates.length);
        for(const u of updates){
            await db.collection('medicalRecords').doc(u.id).set({ patientId: u.newPatientNumber, patientDocId: u.newPatientDocId }, { merge:true });
            console.log('Normalized', u.id, '->', u.newPatientNumber, u.newPatientDocId);
        }
        console.log('Batch normalization complete. Reload dashboards to see updated records.');
    } catch(err){ console.error('normalizeAllMedicalRecords failed', err); }
    console.groupEnd();
};
