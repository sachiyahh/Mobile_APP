// --- Firebase init ---
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
const db = firebase.firestore();

//--- TAB: Get patientId from URL ---
function getQueryParam(param) {
  const params = new URLSearchParams(window.location.search);
  return params.get(param) || '';
}

// Accept either `patientId` (patient number like 0001P) or `patientDocId` (Firestore doc id)
let patientId = '';// patient number
let patientDocId = '';// firestore doc id

async function resolvePatientFromParams() {
  const patientIdParam = getQueryParam('patientId');
  const patientDocIdParam = getQueryParam('patientDocId');

  if (patientDocIdParam) {
    // Resolve doc -> patientId
    const snap = await db.collection('patients').doc(patientDocIdParam).get();
    if (snap.exists) {
      const p = snap.data();
      patientDocId = snap.id;
      patientId = p.patientId || '';
    } else {
      patientDocId = patientDocIdParam;
    }
  } else if (patientIdParam) {
    // Resolve patientId -> doc id
    const snap = await db.collection('patients').where('patientId', '==', patientIdParam).limit(1).get();
    if (!snap.empty) {
      const pdoc = snap.docs[0];
      patientDocId = pdoc.id;
      patientId = pdoc.data().patientId || patientIdParam;
    } else {
      patientId = patientIdParam;
    }
  }
}

// --- Prefill for forms that need name/diagnosis (only once) ---
async function prefillPatientDetails() {
  await resolvePatientFromParams();
  if (patientDocId) {
    const pdoc = await db.collection('patients').doc(patientDocId).get();
    if (pdoc.exists) {
      const p = pdoc.data();
      const patientName = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
      const diagnosis = p.caseHistory || '';
      document.querySelectorAll('#patientName').forEach(input => input.value = patientName);
      document.querySelectorAll('#diagnosis').forEach(input => input.value = diagnosis);
      document.querySelectorAll('#patientNumber').forEach(input => input.value = p.patientId || patientDocId);
    }
  } else if (patientId) {
    // we have only patient number
    const snap = await db.collection('patients').where('patientId', '==', patientId).limit(1).get();
    if (!snap.empty) {
      const p = snap.docs[0].data();
      const patientName = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
      const diagnosis = p.caseHistory || '';
      document.querySelectorAll('#patientName').forEach(input => input.value = patientName);
      document.querySelectorAll('#diagnosis').forEach(input => input.value = diagnosis);
      document.querySelectorAll('#patientNumber').forEach(input => input.value = patientId);
    } else {
      document.querySelectorAll('#patientNumber').forEach(input => input.value = patientId);
    }
  }
}

// ========== TAB 1: DAILY PROGRESS ==========
const progressForm = document.getElementById('progressForm');
const recordsTableBody = document.getElementById('recordsTableBody');
const editBtn = document.getElementById('editBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
let editRecordId = null;

progressForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(progressForm);

  const recordData = {
    // store both identifiers for future robustness
    patientId: patientId || '',
    patientDocId: patientDocId || '',
    patientName: document.getElementById('patientName').value,
    date: formData.get('date'),
    treatmentTime: formData.get('treatmentTime'),
    attendance: parseInt(formData.get('attendance'), 10),
    diagnosis: formData.get('diagnosis'),
    pain: formData.get('pain'),
    location: formData.get('location'),
    subjectiveNotes: formData.get('subjectiveNotes'),
    functionalImprovement: parseInt(formData.get('functionalImprovement'), 10),
    functionalNotes: formData.get('functionalNotes'),
    goalStatus: formData.get('goalStatus'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    if (editRecordId) {
      await db.collection('medicalRecords').doc(editRecordId).update(recordData);
      alert('Record updated successfully.');
      editRecordId = null;
      editBtn.disabled = true;
      if(cancelEditBtn) cancelEditBtn.style.display='none';
    } else {
      await db.collection('medicalRecords').add(recordData);
      alert('Record saved successfully.');
    }
    progressForm.reset();
    await prefillPatientDetails();
    await loadRecords();
  } catch (error) {
    console.error('Error saving record:', error);
    alert('Error saving record. Please try again.');
  }
});

async function loadRecords() {
  try {
    // Ensure params are resolved before loading
    await resolvePatientFromParams();
    if (!patientId && !patientDocId) {
      recordsTableBody.innerHTML = '<tr><td colspan="10">No patient selected.</td></tr>';
      return;
    }
    // Prefer querying by patientId (patient number) if available, otherwise by patientDocId
    let snapshot;
    if (patientId) {
      snapshot = await db.collection('medicalRecords').where('patientId', '==', patientId).get();
    } else {
      snapshot = await db.collection('medicalRecords').where('patientDocId', '==', patientDocId).get();
    }

    recordsTableBody.innerHTML = '';
    snapshot.forEach(doc => {
      const d = doc.data();
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${d.date || ''}</td>
        <td>${d.treatmentTime || ''}</td>
        <td>${d.attendance ?? ''}</td>
        <td>${d.diagnosis || ''}</td>
        <td>${d.pain || ''}</td>
        <td>${d.location || ''}</td>
        <td>${d.subjectiveNotes || ''}</td>
        <td>${d.functionalImprovement ?? ''}</td>
        <td>${d.functionalNotes || ''}</td>
        <td>${d.goalStatus || ''}</td>
        <td>
          <button onclick="editRecord('${doc.id}')">Edit</button>
          <button onclick="deleteRecord('${doc.id}')">Delete</button>
        </td>
      `;
      recordsTableBody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error loading records:', error);
  }
}

window.editRecord = async function(id) {
  try {
    const snap = await db.collection('medicalRecords').doc(id).get();
    if (!snap.exists) return;
    const d = snap.data();
    progressForm.date.value = d.date || '';
    progressForm.treatmentTime.value = d.treatmentTime || '';
    progressForm.attendance.value = d.attendance ?? 0;
    progressForm.pain.value = d.pain || '';
    progressForm.location.value = d.location || '';
    progressForm.subjectiveNotes.value = d.subjectiveNotes || '';
    progressForm.functionalImprovement.value = d.functionalImprovement ?? 0;
    progressForm.functionalNotes.value = d.functionalNotes || '';
    progressForm.goalStatus.value = d.goalStatus || '';
    progressForm.diagnosis.value = d.diagnosis || '';
    document.getElementById('patientName').value = d.patientName || '';
    document.getElementById('patientNumber').value = patientId;
    editRecordId = id;
    editBtn.disabled = false;
    if(cancelEditBtn) cancelEditBtn.style.display='inline-block';
  } catch (error) {
    console.error('Error loading record:', error);
  }
};

window.deleteRecord = async function(id) {
  if (!confirm('Delete this record?')) return;
  try {
    await db.collection('medicalRecords').doc(id).delete();
    await loadRecords();
    // If we deleted the record currently being edited, reset edit state
    if(editRecordId === id){
      editRecordId = null; editBtn.disabled = true; if(cancelEditBtn) cancelEditBtn.style.display='none'; progressForm.reset(); prefillPatientDetails();
    }
  } catch (error) {
    console.error('Error deleting record:', error);
  }
};

// Cancel/Close edit handler
if(cancelEditBtn){
  cancelEditBtn.onclick = function(){
    editRecordId = null;
    editBtn.disabled = true;
    cancelEditBtn.style.display='none';
    progressForm.reset();
    prefillPatientDetails();
  };
}

// ========== TAB 2: SUBJECTIVE DATA ==========
const subjectiveForm = document.getElementById('subjectiveForm');
const subjectiveEditBtn = document.getElementById('subjectiveEditBtn');
let editSubjectiveId = null;

subjectiveForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(subjectiveForm);
  const data = {
    patientId,
    chiefComplaints: formData.get('chiefComplaints'),
    hpiDate: formData.get('hpiDate'),
    mechanism: formData.get('mechanism'),
    medications: formData.get('medications'),
    surgery: formData.get('surgery'),
    labs: formData.get('labs'),
    xray: formData.get('xray'),
    mri: formData.get('mri'),
    ctscan: formData.get('ctscan'),
    emgncv: formData.get('emgncv'),
    prevTherapy: formData.get('prevTherapy'),
    treatSessions: formData.get('treatSessions'),
    otherHistory: formData.get('otherHistory'),
    allergies: formData.get('allergies'),
    homeSituation: formData.get('homeSituation'),
    patientGoals: formData.get('patientGoals'),
    // Heredofamilial, and all checkboxes as boolean or text
    hfDM: subjectiveForm.hfDM?.checked || false,
    hfDM1: subjectiveForm.hfDM1?.checked || false,
    hfDM2: subjectiveForm.hfDM2?.checked || false,
    hfHeart: subjectiveForm.hfHeart?.checked || false,
    hfHeartTxt: formData.get('hfHeartTxt'),
    hfHPN: subjectiveForm.hfHPN?.checked || false,
    hfCancer: subjectiveForm.hfCancer?.checked || false,
    hfCancerTxt: formData.get('hfCancerTxt'),
    hfArthritis: subjectiveForm.hfArthritis?.checked || false,
    hfArthritisTxt: formData.get('hfArthritisTxt'),
    hfBlood: subjectiveForm.hfBlood?.checked || false,
    hfBloodTxt: formData.get('hfBloodTxt'),
    hfLung: subjectiveForm.hfLung?.checked || false,
    hfLungTxt: formData.get('hfLungTxt'),
    hfOther: subjectiveForm.hfOther?.checked || false,
    hfOtherTxt: formData.get('hfOtherTxt'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    if (editSubjectiveId) {
      await db.collection('subjectiveRecords').doc(editSubjectiveId).update(data);
      alert('Subjective record updated.');
      editSubjectiveId = null;
      subjectiveEditBtn.disabled = true;
    } else {
      await db.collection('subjectiveRecords').add(data);
      alert('Subjective record saved.');
    }
    subjectiveForm.reset();
    await prefillPatientDetails();
  } catch (error) {
    console.error('Error saving subjective record:', error);
    alert('Error saving subjective record.');
  }
});

// Add similar logic for edit/delete (if you wish to display and edit past Subjective Records)

// ========== TAB 3: OBJECTIVE DATA ==========
const objectiveForm = document.getElementById('objectiveForm');
const objectiveEditBtn = document.getElementById('objectiveEditBtn');
let editObjectiveId = null;

objectiveForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(objectiveForm);

  const getAllChecked = (name) => 
    Array.from(objectiveForm[name]).filter(cb => cb.checked).map(cb => cb.value);

  const data = {
    patientId,
    sensorium: getAllChecked('sensorium'),
    bodyBuild: getAllChecked('bodyBuild'),
    orientedTo: getAllChecked('orientedTo'),
    orientedNotes: formData.get('orientedNotes'),
    // Add other fields as above for all objective data checkboxes and values...
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  try {
    if (editObjectiveId) {
      await db.collection('objectiveRecords').doc(editObjectiveId).update(data);
      alert('Objective record updated.');
      editObjectiveId = null;
      objectiveEditBtn.disabled = true;
    } else {
      await db.collection('objectiveRecords').add(data);
      alert('Objective record saved.');
    }
    objectiveForm.reset();
    await prefillPatientDetails();
  } catch (error) {
    console.error('Error saving objective record:', error);
    alert('Error saving objective record.');
  }
});

// ========== Initial load ==========
window.onload = async function() {
  await prefillPatientDetails();
  await loadRecords();
};
window.viewRecords = async function(patientDocId) {
    window.location.href = `medical-records.html?patientDocId=${patientDocId}`;  
};   

// Modal logic
function showModal(contentHtml) {
  document.getElementById('modalRecordContent').innerHTML = contentHtml;
  document.getElementById('recordModal').style.display = 'flex';
}
document.getElementById('closeRecordModal').onclick = function() {
  document.getElementById('recordModal').style.display = 'none';
};
window.onclick = function(event) {
  if (event.target === document.getElementById('recordModal')) {
    document.getElementById('recordModal').style.display = 'none';
  }
};


