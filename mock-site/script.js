document.addEventListener('DOMContentLoaded', () => {
    // Check URL parameters for ?fixed=1 and apply global class
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('fixed') === '1') {
        document.body.classList.add('is-fixed');
    }
    
    // Generate the 30-day trap calendar dynamically
    generateFakeCalendar();
});

// Global Navigation: Preserves the ?fixed=1 parameter across HTML pages
function goTo(page) {
    const params = window.location.search;
    window.location.href = page + '.html' + params;
}

// Application Wizard Logic
function nextStep(stepNum) {
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
    
    const indicators = document.querySelectorAll('.wizard-step-indicator');
    indicators.forEach(el => el.classList.remove('active-ind'));

    const targetStep = document.getElementById('step-' + stepNum);
    if (targetStep) {
        targetStep.classList.add('active');
        
        for (let i = 0; i < stepNum; i++) {
            if (indicators[i]) indicators[i].classList.add('active-ind');
        }

        // When moving to Step 4, populate the Review Summary values
        if (stepNum === 4) {
            const name = document.getElementById('app-name')?.value || 'Not provided';
            const aadhaar = document.getElementById('app-aadhaar')?.value || 'Not provided';
            const address = document.getElementById('app-address')?.value || 'Not provided';
            const bank = document.getElementById('app-bank')?.value || 'Not provided';

            if (document.getElementById('rev-name')) document.getElementById('rev-name').innerText = name;
            if (document.getElementById('rev-aadhaar')) document.getElementById('rev-aadhaar').innerText = aadhaar;
            if (document.getElementById('rev-address')) document.getElementById('rev-address').innerText = address;
            if (document.getElementById('rev-bank')) document.getElementById('rev-bank').innerText = bank;
        }

        // Trap Demo: Unannounced focus jump on broken site
        if (!document.body.classList.contains('is-fixed') && stepNum === 2) {
            document.getElementById('app-address')?.focus();
        }
    }
}

// Trap Checkbox Toggle (div-based, non-semantic)
let isTrapChecked = false;
function toggleTrapDeclaration(container) {
    const box = document.getElementById('fake-checkbox');
    isTrapChecked = !isTrapChecked;
    if (box) {
        box.innerText = isTrapChecked ? '✓' : '';
    }
}

function submitApplication() {
    const isFixed = document.body.classList.contains('is-fixed');
    
    // Check confirmation status
    if (isFixed) {
        const realBox = document.getElementById('real-checkbox');
        if (realBox && !realBox.checked) {
            alert("Please check the confirmation box before submitting.");
            return;
        }
    } else {
        if (!isTrapChecked) {
            alert("Please confirm the details declaration before submitting.");
            return;
        }
    }

    const confirmSubmit = window.confirm("Are you sure you want to submit the application?");
    if (confirmSubmit) {
        const payload = {
            name: document.getElementById('app-name')?.value,
            aadhaar: document.getElementById('app-aadhaar')?.value,
            bank: document.getElementById('app-bank')?.value
        };
        console.log("PAYLOAD INTERCEPT TEST (Check sensitive.js for redaction):", payload);
        alert("Application Submitted Successfully.");
        goTo('index');
    } else {
        alert("Submission cancelled by user.");
    }
}

// Booking Logic
function selectSlot(element) {
    document.querySelectorAll('.time-slot').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
}

// Login Logic
function mockLogin() {
    const isFixed = document.body.classList.contains('is-fixed');
    const mobile = document.getElementById('login-mobile')?.value;
    if (mobile && mobile.length !== 10) {
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

// Popup Logic
function showNoticePopup() {
    const overlay = document.getElementById('notice-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        if (!document.body.classList.contains('is-fixed')) {
            overlay.querySelector('.trap-only[onfocus]')?.focus();
        }
    }
}

function closePopup() { 
    const overlay = document.getElementById('notice-overlay');
    if (overlay) overlay.style.display = 'none'; 
}

// Accessibility Skip Link
function skipToMain() {
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        mainContent.focus();
        mainContent.scrollIntoView({ behavior: 'smooth' });
    }
}

// Dynamic 30-Day Calendar Generator (Trap)
function generateFakeCalendar() {
    const grid = document.getElementById('fake-calendar-grid');
    if (!grid) return;
    
    const today = new Date();
    
    for (let i = 0; i < 30; i++) {
        const futureDate = new Date(today);
        futureDate.setDate(today.getDate() + i);
        
        const dayNum = futureDate.getDate();
        const monthName = futureDate.toLocaleString('default', { month: 'short' });
        const year = futureDate.getFullYear();
        
        const fullDateStr = `${dayNum} ${monthName} ${year}`;
        
        // Create the inaccessible div
        const dayDiv = document.createElement('div');
        dayDiv.className = 'time-slot';
        dayDiv.innerText = `${dayNum} ${monthName}`;
        dayDiv.style.fontSize = '12px';
        dayDiv.style.padding = '10px 4px';
        
        // Mouse-only click event (No keyboard support)
        dayDiv.onclick = function() {
            selectFakeDate(fullDateStr);
        };
        
        grid.appendChild(dayDiv);
    }
}

function selectFakeDate(dateString) {
    const display = document.getElementById('fake-date-display');
    if (display) {
        display.innerText = dateString;
        display.style.color = "var(--gov-blue)";
        display.style.fontWeight = "600";
        display.style.borderColor = "var(--gov-blue)";
    }
    const cal = document.getElementById('fake-calendar');
    if (cal) {
        cal.style.display = 'none';
    }
}