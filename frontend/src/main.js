// avatar/frontend/src/main.js
// Main application entry point for LiveAvatar

import { AvatarManager } from './avatar.js';
import { updateUI, setStatus, showEmergency } from './ui.js';

// ============================================================================
// STATE
// ============================================================================

let avatar = null;
let currentMode = 'clinic';

// Avatar IDs from .env
const AVATAR_IDS = {
  clinic: import.meta.env.VITE_LIVEAVATAR_AVATAR_ID_CLINIC || 'YOUR_CLINIC_AVATAR_ID',
  rehab: import.meta.env.VITE_LIVEAVATAR_AVATAR_ID_REHAB || 'YOUR_REHAB_AVATAR_ID'
};

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const sendBtn = document.getElementById('sendBtn');
const userInput = document.getElementById('userInput');
const videoElement = document.getElementById('avatarVideo');
const loadingText = document.getElementById('loadingText');

const modeBtns = document.querySelectorAll('.mode-btn');

// ============================================================================
// EVENT LISTENERS
// ============================================================================

// Start avatar
startBtn.addEventListener('click', async () => {
  try {
    setStatus('Starting avatar...', 'loading');
    startBtn.disabled = true;
    
    // Create avatar instance
    avatar = new AvatarManager(currentMode);
    
    // Set up event handlers
    avatar.onSpeakingStart = () => setStatus('Speaking...', 'speaking');
    avatar.onSpeakingEnd = () => setStatus('Ready...', 'ready');
    avatar.onStreamReady = () => {
      setStatus('Connected', 'ready');
      loadingText.style.display = 'none';
    };
    avatar.onDisconnect = () => {
      setStatus('Disconnected', 'error');
      handleStop();
    };
    avatar.onEmergency = (message) => {
      showEmergency(true);
      setStatus('⚠️ Emergency detected', 'error');
    };
    avatar.onError = (error) => {
      console.error('Avatar error:', error);
      setStatus('Error: ' + error.message, 'error');
    };
    
    // Initialize with current mode's avatar
    await avatar.initialize(AVATAR_IDS[currentMode], videoElement);
    
    // Enable controls
    updateUI(true);
    stopBtn.disabled = false;
    sendBtn.disabled = false;
    userInput.disabled = false;
    
    setStatus('Ready to chat', 'ready');
    userInput.focus();
    
  } catch (error) {
    console.error('Failed to start avatar:', error);
    setStatus('Failed to start: ' + error.message, 'error');
    startBtn.disabled = false;
    loadingText.style.display = 'block';
  }
});

// Stop avatar
stopBtn.addEventListener('click', handleStop);

async function handleStop() {
  if (avatar) {
    await avatar.close();
    avatar = null;
  }
  
  updateUI(false);
  startBtn.disabled = false;
  stopBtn.disabled = true;
  sendBtn.disabled = true;
  userInput.disabled = true;
  
  // Reset video
  videoElement.srcObject = null;
  
  loadingText.style.display = 'block';
  loadingText.textContent = 'Click "Start Avatar" to begin';
  setStatus('Stopped', 'idle');
  showEmergency(false);
}

// Send message
sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
  const message = userInput.value.trim();
  if (!message || !avatar) return;
  
  try {
    // Disable input while processing
    sendBtn.disabled = true;
    userInput.disabled = true;
    setStatus('Thinking...', 'loading');
    
    // Send to avatar
    const response = await avatar.sendMessage(message);
    
    // Check for emergency
    if (response.safety.is_emergency) {
      showEmergency(true);
    }
    
    // Clear input
    userInput.value = '';
    
    // Re-enable input
    sendBtn.disabled = false;
    userInput.disabled = false;
    userInput.focus();
    
  } catch (error) {
    console.error('Send message error:', error);
    setStatus('Error sending message', 'error');
    sendBtn.disabled = false;
    userInput.disabled = false;
  }
}

// Mode switching
modeBtns.forEach(btn => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode;
    
    // Don't switch if already active or avatar is running
    if (mode === currentMode || avatar) return;
    
    // Update UI
    modeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    currentMode = mode;
    console.log('Mode switched to:', mode);
  });
});

// ============================================================================
// INITIALIZATION
// ============================================================================

console.log('🚀 Theorem LiveAvatar initialized');
console.log('   Mode:', currentMode);
console.log('   Clinic Avatar ID:', AVATAR_IDS.clinic);
console.log('   Rehab Avatar ID:', AVATAR_IDS.rehab);

// Check if LiveKit loaded
if (typeof LivekitClient === 'undefined') {
  console.error('❌ LiveKit SDK not loaded');
  setStatus('Error: LiveKit SDK not loaded', 'error');
  startBtn.disabled = true;
}
