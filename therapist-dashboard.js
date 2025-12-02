// Use global firebase object from CDN
var db;
window.onload = function() {
    db = firebase.firestore();
    loadPendingInquiries();
    loadPatients();
    renderCalendar(currentMonth);
};

// --- 1. Pending Inquiries Table and Add button handler ---
async function loadPendingInquiries() {
    try {
        const snapshot = await db.collection('inquiries').get();
        const inquiriesTableBody = document.getElementById('inquiriesTableBody');
        inquiriesTableBody.innerHTML = '';

        snapshot.forEach(doc => {
            const inquiry = doc.data();
            const row = document.createElement('tr');

            row.innerHTML = `
                <td>${inquiry.firstName || ''}</td>
                <td>${inquiry.middleName || ''}</td>
                <td>${inquiry.lastName || ''}</td>
                <td>${inquiry.contactNumber || ''}</td>
                <td><input type="number" min="0" value="${inquiry.age || ''}" class="ageInput" style="width:60px;"></td>
                <td>${inquiry.caseHistory || ''}</td>
                <td>${inquiry.emergencyContactNumber || ''}</td>
                <td>
                    <button data-id="${doc.id}" class="addPatientBtn">Add</button>
                    <button onclick="deleteInquiry('${doc.id}')">Delete</button>
                </td>
            `;
            inquiriesTableBody.appendChild(row);
        });

        // Attach click handlers for Add buttons (strip label out)
        document.querySelectorAll('.addPatientBtn').forEach(function(btn){
            btn.onclick = async function(){
                const id = btn.getAttribute('data-id');
                const row = btn.closest('tr').children;
                
                const inquiryData = {
                    firstName: row[0].innerText.trim(),
                    middleName: row[1].innerText.trim(),
                    lastName: row[2].innerText.trim(),
                    contactNumber: row[3].innerText.trim(),
                    age: row[4].querySelector('input').value.trim(),
                    caseHistory: row[5].innerText.trim(),
                    emergencyContactNumber: row[6].innerText.trim()
                };
                await acceptInquiry(id, inquiryData);
            };
        });
    } catch (error) {
        console.error('Error loading inquiries:', error);
    }
}

// --- 2. Generate Patient ID like 0001P, 0002P ---
async function generateNextPatientId() {
    const snapshot = await db.collection('patients').get();
    const count = snapshot.size + 1;
    return count.toString().padStart(4, '0') + 'P';
}

// --- 3. Accept Inquiry & Move to Patient List ---
window.acceptInquiry = async function(inquiryId, inquiryData) {
    try {
        const patientId = await generateNextPatientId();
        const passcode = Math.floor(100000 + Math.random() * 900000).toString();

        const patientData = {
            patientId: patientId,
            firstName: inquiryData.firstName,
            middleName: inquiryData.middleName,
            lastName: inquiryData.lastName,
            age: inquiryData.age,
            contact: inquiryData.contactNumber,
            caseHistory: inquiryData.caseHistory,
            emergencyContactNumber: inquiryData.emergencyContactNumber,
            passcode: passcode,
            createdAt: new Date().toISOString()
        };
        // Add to patients collection and remove from inquiries
        await db.collection('patients').add(patientData);
        await db.collection('inquiries').doc(inquiryId).delete();

        alert(`Patient added!\nPatient ID: ${patientId}\nPasscode: ${passcode}\nPlease provide these credentials to the patient.`);
        loadPendingInquiries();
        loadPatients();
    } catch (error) {
        console.error('Error accepting inquiry:', error);
        alert('Error adding patient. Please try again.');
    }
};

// --- 4. Delete Inquiry handler ---
window.deleteInquiry = async function(inquiryId) {
    if (confirm('Delete this inquiry?')) {
        try {
            await db.collection('inquiries').doc(inquiryId).delete();
            loadPendingInquiries();
        } catch (error) {
            console.error('Error deleting inquiry:', error);
        }
    }
};

async function getTotalAttendance(patientDocId) {
    const snap = await db.collection('medicalRecords')
        .where('patientDocId', '==', patientDocId)
        .get();
    let total = 0;
    snap.forEach(doc => {
        const d = doc.data();
        total += (parseInt(d.attendance, 10) || 0);
    });
    return total;
}

// --- 5. Patient List Table renderer with Edit/Delete buttons ---
async function loadPatients() {
    try {
        const snapshot = await db.collection('patients').get();
        const patientTableBody = document.getElementById('patientTableBody');
        patientTableBody.innerHTML = '';
        let count = 0;

        snapshot.forEach(doc => {
            const patient = doc.data();
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${patient.patientId}</td>
                <td>${patient.firstName || 'N/A'}</td>
                <td>${patient.middleName || 'N/A'}</td>
                <td>${patient.lastName || 'N/A'}</td>
                <td>${patient.age || 'N/A'}</td>
                <td>${patient.caseHistory ? 'Case History - ' + patient.caseHistory : 'N/A'}</td>
                <td>${patient.emergencyContactNumber || 'N/A'}</td>
                <td>
                    <button onclick="viewRecords('${patient.patientID}')">View Records</button>
                </td>
                <td>
                    <button onclick="editPatient('${doc.id}')">Edit</button>
                    <button onclick="deletePatient('${doc.id}')">Delete</button>
                </td>
            `;
            patientTableBody.appendChild(row);
            count++;
        });
        // Optional: update patient count on dashboard
        const countDisplay = document.getElementById('patientsCount');
        if (countDisplay) countDisplay.textContent = count;
    } catch (error) {
        console.error('Error loading patients:', error);
    }
}

// --- 6. Edit/View/Delete Button Handlers ---
window.editPatient = function(patientDocId) {
    alert('Edit patient feature coming soon (including Medical Records modal/UI)');
};
window.viewRecords = async function(patientDocId) {
    window.location.href = `medical-6records.html?patientDocId=${patientDocId}`;
  try {
    const snap = await db.collection('patients').doc(patientDocId).get();
    if (!snap.exists) {
      alert('Patient not found.');
      return;
    }
    const p = snap.data();
    const params = new URLSearchParams({
      patientDocId: patientDocId,
      patientId: p.patientId || '',
      patientName: `${p.firstName || ''} ${p.middleName || ''} ${p.lastName || ''}`.replace(/\s+/g, ' ').trim(),
      diagnosis: p.caseHistory || ''
    });
    window.location.href = `medical-records.html?${params.toString()}`;
  } catch (err) {
    console.error('Error opening records:', err);
    alert('Unable to open records.');
  }
};

window.deletePatient = async function(patientDocId) {
    if (confirm('Delete this patient and all records?')) {
        try {
            await db.collection('patients').doc(patientDocId).delete();
            loadPatients();
        } catch (error) {
            console.error('Error deleting patient:', error);
        }
    }
};

document.getElementById('appointmentsBtn').addEventListener('click', function() {
  // Hide other sections
  document.querySelectorAll('main section').forEach(sec => sec.style.display = 'none');
  // Show appointments
  document.getElementById('appointmentsSection').style.display = 'block';
});

// --- Calendar Functions remain unchanged ---
async function loadSchedules() {
    const snapshot = await db.collection("appointments").get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
async function saveSchedule(schedule) {
    await db.collection("appointments").add(schedule);
}
async function deleteSchedule(id) {
    await db.collection("appointments").doc(id).delete();
}

document.getElementById('scheduleForm').onsubmit = async function(e){
    e.preventDefault();
    const data = {
        patientName: document.getElementById('patientName').value,
        description: document.getElementById('description').value,
        date: document.getElementById('date').value,
        sessionType: document.querySelector('input[name="sessionType"]:checked').value
    };
    await saveSchedule(data);
    renderCalendar(currentMonth);
    modalEl.classList.add('hidden');
};
