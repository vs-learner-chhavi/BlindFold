// Auth & Cart State
let cartCount = 0;
let isLoggedIn = false;

// Unified Click Handler for Top-Right Nav Items
function handleAuthClick(section) {
    if (!isLoggedIn) {
        if (section === 'cart') {
            alert("Login required. Please sign in to view your cart.");
        } else {
            alert("Login required. Please sign in to access this page.");
        }
        showLogin();
    } else {
        if (section === 'cart') {
            alert(`Opening your Cart with ${cartCount} items...`);
        } else if (section === 'orders') {
            alert("Opening your Orders page...");
        } else if (section === 'account') {
            alert("Opening your Account dashboard...");
        }
    }
}

// Add to Cart Logic
function addToCart() {
    cartCount++;
    document.getElementById('cart-count').innerText = cartCount;
}

// Login Page Logic
function showLogin() {
    // Hide the home page completely from screen readers and keyboards
    document.getElementById('main-wrap').style.display = 'none';
    // Show the login modal
    document.getElementById('login-modal').style.display = 'flex';
}

function closeLogin() {
    // Bring the home page back
    document.getElementById('main-wrap').style.display = 'block';
    // Hide the login modal
    document.getElementById('login-modal').style.display = 'none';
}

function performLogin() {
    // Fake login validation
    isLoggedIn = true;
    
    // Return to the home page
    document.getElementById('main-wrap').style.display = 'block';
    document.getElementById('login-modal').style.display = 'none';
    
    // Update navbar greeting to show user is logged in
    const navGreeting = document.querySelector('.nav-item .nav-line1');
    if(navGreeting) navGreeting.innerText = "Hello, Aryan"; 
    
    const sidebarGreeting = document.querySelector('.sidebar-header span');
    if(sidebarGreeting) sidebarGreeting.innerText = "Hello, Aryan";
    
    alert("Successfully logged in!");
}

// Sidebar Logic
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        overlay.style.display = 'none';
    } else {
        sidebar.classList.add('open');
        overlay.style.display = 'block';
    }
}

// Hero Carousel Logic
const heroImages = [
    "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?auto=format&fit=crop&w=1500&q=80",
    "https://images.unsplash.com/photo-1607082349566-187342175e2f?auto=format&fit=crop&w=1500&q=80",
    "https://images.unsplash.com/photo-1593640408182-31c70c8268f5?auto=format&fit=crop&w=1500&q=80"
];
let currentImgIndex = 0;

function slideHero(direction) {
    currentImgIndex += direction;
    
    // Loop around
    if (currentImgIndex < 0) {
        currentImgIndex = heroImages.length - 1;
    } else if (currentImgIndex >= heroImages.length) {
        currentImgIndex = 0;
    }
    
    document.getElementById('hero-img').src = heroImages[currentImgIndex];
}

// Auto-slide hero every 5 seconds
setInterval(() => {
    slideHero(1);
}, 5000);