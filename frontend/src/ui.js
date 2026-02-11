// avatar/frontend/src/ui.js
// UI state management and updates

// ============================================================================
// STATUS UPDATES
// ============================================================================

export function setStatus(message, type = 'info') {
  const statusEl = document.getElementById('status');
  const dotEl = statusEl.querySelector('.status-dot');
  const textEl = statusEl.querySelector('span:last-child');
  
  textEl.textContent = message;
  
  // Update dot color based on type
  const colors = {
    idle: '#999',
    loading: '#f59e0b',
    ready: '#10b981',
    speaking: '#3b82f6',
    error: '#ef4444'
  };
  
  dotEl.style.background = colors[type] || colors.info;
}

// ============================================================================
// EMERGENCY BANNER
// ============================================================================

export function showEmergency(show = true) {
  const banner = document.getElementById('emergencyBanner');
  if (show) {
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
}

// ============================================================================
// UI STATE MANAGEMENT
// ============================================================================

export function updateUI(isActive) {
  // This is called when avatar starts/stops
  // Can be extended for more complex UI updates
  
  if (isActive) {
    console.log('✅ UI active state');
  } else {
    console.log('⏸️ UI inactive state');
    showEmergency(false);
  }
}

// ============================================================================
// LOADING STATES
// ============================================================================

export function showLoading(show = true) {
  const loadingEl = document.getElementById('loadingText');
  if (loadingEl) {
    loadingEl.style.display = show ? 'block' : 'none';
  }
}

// ============================================================================
// CONVERSATION DISPLAY (optional - for showing chat history)
// ============================================================================

export function addMessageToHistory(role, content) {
  // If you want to show conversation history in the UI,
  // you can implement this function
  
  console.log(`[${role}]:`, content);
}

// ============================================================================
// TOAST NOTIFICATIONS (optional)
// ============================================================================

export function showToast(message, type = 'info') {
  // Simple toast notification
  // You can implement a more sophisticated toast system if needed
  
  console.log(`[${type.toUpperCase()}]:`, message);
  
  // For now, just use browser alert for errors
  if (type === 'error') {
    alert(message);
  }
}
