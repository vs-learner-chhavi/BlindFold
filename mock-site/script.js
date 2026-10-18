document.addEventListener('DOMContentLoaded', () => {
    // 1. Check URL parameters for ?fixed=1 and apply global class
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('fixed') === '1') {
        document.body.classList.add('is-fixed');
    }
});

// 2. Global Navigation: Preserves the ?fixed=1 parameter across HTML pages
function goTo(page) {
    const params = window.location.search;
    window.location.href = page + '.html' + params;
}

// 3. Application Wizard Logic
function nextStep(stepNum) {
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
    
    const indicators = document.querySelectorAll('.wizard-step-indicator');
    indicators.forEach(el => el.classList.remove('active-ind'));

    const targetStep = document.getElementById('step-' + stepNum);
    if (targetStep) {
        targetStep.classList.add('active');
        
        for (let i = 0; i < stepNum; i++) {
            if(indicators[i]) indicators[i].classList.add('active-ind');
        }

        // Trap Demo: Unannounced focus jump on broken site
        if (!document.body.classList.contains('is-fixed') && stepNum === 2) {
            document.getElementById('app-address').focus();
        }
    }
}

function submitApplication() {
    const confirmSubmit = window.confirm("Are you sure you want to submit the application?");
    if (confirmSubmit) {
        const payload = {
            name: document.getElementById('app-name').value,
            aadhaar: document.getElementById('app-aadhaar').value,
            bank: document.getElementById('app-bank').value
        };
        console.log("PAYLOAD INTERCEPT TEST (Check sensitive.js for redaction):", payload);
        alert("Application Submitted Successfully.");
        goTo('index');
    } else {
        alert("Submission cancelled by user.");
    }
}

// 4. Booking Logic
function selectSlot(element) {
    document.querySelectorAll('.time-slot').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
}

// 5. Login Logic
function mockLogin() {
    const isFixed = document.body.classList.contains('is-fixed');
    const mobile = document.getElementById('login-mobile').value;
    if (mobile.length !== 10) {
        if (isFixed) {
            document.getElementById('mobile-error-fixed').style.display = 'block';
        } else {
            document.getElementById('mobile-error').style.display = 'block';
        }
    } else {
        alert("Login successful");
        goTo('index');
    }
}

// 6. Popup Logic
function showNoticePopup() {
    const overlay = document.getElementById('notice-overlay');
    overlay.style.display = 'flex';
    if (!document.body.classList.contains('is-fixed')) {
        overlay.querySelector('.trap-only[onfocus]').focus(); // Focus trap
    }
}

function closePopup() { 
    document.getElementById('notice-overlay').style.display = 'none'; 
}

// 7. Accessibility Skip Link
function skipToMain() {
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        mainContent.focus();
        mainContent.scrollIntoView({ behavior: 'smooth' });
    }
}