// Therapist login logic (no Firebase, just passcode check)
const therapistLoginForm = document.getElementById('therapistLoginForm');
const passcodeErrorModal = document.getElementById('passcodeErrorModal');
const closePasscodeError = document.getElementById('closePasscodeError');

therapistLoginForm.addEventListener('submit', function(e) {
    e.preventDefault();
    const passcode = therapistLoginForm.elements['therapistPasscode'].value;
    if (passcode === 'BARBEQUE') {
        window.location.href = 'therapist-dashboard.html';
    } else {
        passcodeErrorModal.style.display = 'flex';
    }
});

closePasscodeError.addEventListener('click', function() {
    passcodeErrorModal.style.display = 'none';
    therapistLoginForm.reset();
});
