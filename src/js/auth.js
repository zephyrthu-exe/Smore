import { auth } from './firebase-config.js';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

// DOM Elements
const loginSection = document.getElementById('loginSection');
const registerSection = document.getElementById('registerSection');
const showLoginBtn = document.getElementById('showLogin');
const showRegisterBtn = document.getElementById('showRegister');

const bannerTitle = document.getElementById('bannerTitle');
const bannerDesc = document.getElementById('bannerDesc');

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authStatus = document.getElementById('auth-status');

// Switch Forms
showLoginBtn?.addEventListener('click', () => {
  registerSection.classList.add('d-none');
  loginSection.classList.remove('d-none');
  bannerTitle.textContent = "Save More, Stress Less";
  bannerDesc.textContent = "Your all-in-one personal finance tracker built directly for smart daily budgets.";
  hideMessage();
});

showRegisterBtn?.addEventListener('click', () => {
  loginSection.classList.add('d-none');
  registerSection.classList.remove('d-none');
  bannerTitle.textContent = "Start Your Savings Journey";
  bannerDesc.textContent = "Join thousands of users building strong financial habits and crushing their savings goals.";
  hideMessage();
});

// Password Show/Hide Toggle (Global Event Listener for Reliability)
document.addEventListener('click', (e) => {
  if (e.target && e.target.classList.contains('toggle-pass')) {
    e.preventDefault();
    const targetId = e.target.getAttribute('data-target');
    const input = document.getElementById(targetId);
    if (input) {
      if (input.type === 'password') {
        input.type = 'text';
        e.target.textContent = 'Hide';
      } else {
        input.type = 'password';
        e.target.textContent = 'Show';
      }
    }
  }
});

function showMessage(msg, isError = true) {
  if (!authStatus) return;
  authStatus.textContent = msg;
  authStatus.className = isError ? 'status-alert is-visible is-error' : 'status-alert is-visible is-success';
}

function hideMessage() {
  if (!authStatus) return;
  authStatus.className = 'status-alert';
}

// Login
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email')?.value.trim();
    const password = document.getElementById('login-password')?.value;

    if (!email || !password) {
      showMessage('Please enter both email and password.');
      return;
    }

    try {
      await signOut(auth);
      await signInWithEmailAndPassword(auth, email, password);
      showMessage('Signed in successfully.', false);
      window.location.href = './dashboard.html';
    } catch (err) {
      handleAuthError(err.code);
    }
  });
}

// Register
if (registerForm) {
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('register-email')?.value.trim();
    const password = document.getElementById('register-password')?.value;
    const confirmPassword = document.getElementById('regConfirmPassword')?.value;
    const termsCheck = document.getElementById('termsCheck')?.checked;

    if (!email || !password || !confirmPassword) {
      showMessage('Please fill in all required fields.');
      return;
    }

    if (password !== confirmPassword) {
      showMessage('Passwords do not match.');
      return;
    }

    if (!termsCheck) {
      showMessage('Please accept the Terms of Service to continue.');
      return;
    }

    try {
      await signOut(auth);
      await createUserWithEmailAndPassword(auth, email, password);
      showMessage('Account created successfully.', false);
      window.location.href = './dashboard.html';
    } catch (err) {
      handleAuthError(err.code);
    }
  });
}

function handleAuthError(code) {
  let msg = 'An unexpected error occurred. Please try again.';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      msg = 'Invalid email or password.';
      break;
    case 'auth/email-already-in-use':
      msg = 'This email is already registered.';
      break;
    case 'auth/weak-password':
      msg = 'Password should be at least 6 characters long.';
      break;
  }
  showMessage(msg, true);
}