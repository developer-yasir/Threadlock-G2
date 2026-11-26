/**
 * ThreadLock G2 — Glasses HUD Application
 * Optimized for Even Realities G2 576x288 Monochrome Display & R1 Ring
 */

import { EvenHubAdapter } from './evenhub-adapter.js';

// Application State
const state = {
  pairingCode: '',
  activeThread: null,
  latestGlance: null,
  eventSource: null,
  pollTimer: null,
  undoTimer: null,
  undoRemaining: 0,
  inUndoState: false,
  pendingActionName: '',
  
  // Action Bar Selection: 0 = LOCK, 1 = FLAG, 2 = COUNTER
  actions: ['LOCK', 'FLAG', 'COUNTER'],
  selectedActionIndex: 1, // Default focus on FLAG or COUNTER
  
  viewMode: 'GLANCE', // 'GLANCE' | 'MONITOR'
  isRawMode: false,
};

const adapter = new EvenHubAdapter();

document.addEventListener('DOMContentLoaded', () => {
  initUrlParams();
  initPairingCode();
  initEvenHubEvents();
  initSSE();
  fetchActiveThread();
});

function initUrlParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('mode') === 'raw' || params.get('raw') === 'true') {
    setRawMode(true);
  }
}

function initPairingCode() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('pairingCode') || params.get('code');
  if (code && code.trim().length >= 4) {
    state.pairingCode = code.trim().toUpperCase();
  } else {
    state.pairingCode = localStorage.getItem('threadlock_pairing_code') || 'G2-S9EY';
  }

  localStorage.setItem('threadlock_pairing_code', state.pairingCode);
  updatePairingCodeDisplay();
}

function updatePairingCodeDisplay() {
  const el = document.getElementById('hudPairCode');
  if (el) el.innerText = state.pairingCode;
}

/**
 * Subscribes to unified gestures from Even Hub SDK / R1 Ring / Simulator Keyboard
 */
function initEvenHubEvents() {
  // Swipe Left / Ring Rotate CCW: Navigate Action Left
  adapter.on('swipeLeft', () => {
    cycleAction(-1);
    adapter.hapticPulse(30);
  });

  // Swipe Right / Ring Rotate CW: Navigate Action Right
  adapter.on('swipeRight', () => {
    cycleAction(1);
    adapter.hapticPulse(30);
  });

  // Ring Rotate with direction
  adapter.on('ringRotate', (dir) => {
    cycleAction(dir);
    adapter.hapticPulse(25);
  });

  // Tap: If in Undo state -> Revert; Otherwise cycle view mode
  adapter.on('tap', () => {
    if (state.inUndoState) {
      triggerUndo();
    } else {
      toggleViewMode();
    }
    adapter.hapticPulse(40);
  });

  // Double Tap: Switch View Mode
  adapter.on('doubleTap', () => {
    toggleViewMode();
    adapter.hapticPulse(50);
  });

  // Long Press / Ring Click / Enter: Execute Currently Highlighted Action
  adapter.on('longPress', () => {
    confirmSelectedAction();
    adapter.hapticPulse(80);
  });

  adapter.on('ringClick', () => {
    confirmSelectedAction();
    adapter.hapticPulse(80);
  });

  // Direct Undo shortcut
  adapter.on('undo', () => {
    triggerUndo();
  });

  // Voice Prompt shortcut
  adapter.on('voicePrompt', () => {
    promptVoiceCommand();
  });

  // Voice triggered by hardware mic
  adapter.on('voiceTrigger', (text) => {
    if (text) sendVoiceCommand(text);
  });

  // Lifecycle: Suspend SSE when app switched away to preserve glasses battery
  adapter.on('lifecycle', (status) => {
    if (status === 'paused') {
      if (state.eventSource) state.eventSource.close();
      clearInterval(state.pollTimer);
    } else if (status === 'resumed') {
      initSSE();
      fetchActiveThread();
    }
  });
}

// ==================== REAL-TIME SSE STREAMING ====================
function initSSE() {
  if (state.eventSource) state.eventSource.close();

  try {
    state.eventSource = new EventSource(`/api/stream?pairingCode=${state.pairingCode}`);

    state.eventSource.addEventListener('diff_alert', (e) => {
      try {
        const data = JSON.parse(e.data);
        state.latestGlance = data.glance || data.evaluation?.glance;
        state.viewMode = 'GLANCE';
        renderGlanceView(state.latestGlance, data.state);
        flashScreen();
      } catch (err) {
        console.error('SSE diff_alert error', err);
      }
    });

    state.eventSource.addEventListener('state_changed', () => {
      fetchActiveThread();
    });

    state.eventSource.onerror = () => {
      startPollingFallback();
    };
  } catch (err) {
    startPollingFallback();
  }
}

function startPollingFallback() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    fetchActiveThread();
  }, 4000);
}

// ==================== THREAD DATA & RENDERING ====================
async function fetchActiveThread() {
  try {
    const res = await fetch(`/api/threads?pairingCode=${state.pairingCode}`);
    if (!res.ok) return;
    const threads = await res.json();

    if (Array.isArray(threads) && threads.length > 0) {
      state.activeThread = threads[0];
      if (state.activeThread.latestDiff?.glance) {
        state.latestGlance = state.activeThread.latestDiff.glance;
      }

      if (state.activeThread.currentState === 'UNDO_WINDOW') {
        showUndoState(state.activeThread.undoDeadline, state.activeThread.currentState);
      } else {
        hideUndoState();
      }

      if (state.viewMode === 'GLANCE' && state.latestGlance) {
        renderGlanceView(state.latestGlance, state.activeThread.currentState);
      } else {
        renderMonitorView();
      }
    } else {
      renderNoThreadView();
    }
  } catch (err) {
    console.error('fetchActiveThread error', err);
  }
}

/**
 * 1. HIGH-CONTRAST 576x288 GLANCE VIEW
 * Shows:
 * - Top bar: pairing status + active drift badge (e.g. DRIFT: PRICE + DUE)
 * - Center card: crisp 2-3 line diff ($1,200 -> $950 | Fri -> Mon | short context)
 * - Bottom action bar: LOCK | FLAG | COUNTER with active selection highlight
 */
function renderGlanceView(glance, currentState) {
  if (!glance) return;

  // Top Bar
  const driftBadgeEl = document.getElementById('hudDriftBadge');
  const threadTitleEl = document.getElementById('hudCenterTitle');
  const stateBadgeEl = document.getElementById('hudStateBadge');

  if (driftBadgeEl) {
    const isDrift = glance.driftTypes && glance.driftTypes.length > 0;
    if (isDrift) {
      driftBadgeEl.innerText = `DRIFT: ${glance.driftTypes.join(' + ').toUpperCase()}`;
      driftBadgeEl.className = glance.severity === 'HIGH' ? 'badge-drift alert' : 'badge-drift';
    } else {
      driftBadgeEl.innerText = 'TERMS LOCKED';
      driftBadgeEl.className = 'badge-drift';
    }
  }

  if (threadTitleEl) {
    threadTitleEl.innerText = state.activeThread ? state.activeThread.title.toUpperCase() : 'THREADLOCK G2';
  }

  if (stateBadgeEl) {
    stateBadgeEl.innerText = currentState || 'MONITORING';
  }

  // Center Card (Crisp 2-3 line diff)
  const headlineEl = document.getElementById('hudHeadline');
  const oldValEl = document.getElementById('hudOldVal');
  const newValEl = document.getElementById('hudNewVal');
  const tagsEl = document.getElementById('hudTags');
  const recEl = document.getElementById('hudRecommendation');

  if (headlineEl) headlineEl.innerText = glance.headlineDiff || 'TERMS DRIFT DETECTED';
  if (oldValEl) oldValEl.innerText = `OLD: ${glance.oldValue || 'Locked'}`;
  if (newValEl) newValEl.innerText = `NEW: ${glance.newValue || 'Proposed'}`;

  if (tagsEl) {
    const counterparty = state.activeThread?.counterparty || '@client';
    tagsEl.innerText = `${counterparty} • ${glance.shortReason || 'Proposal deviates from baseline'}`;
  }

  if (recEl) {
    recEl.innerText = `REC ACTION: ${glance.recommendedAction || 'COUNTER'}`;
  }

  updateActionBarHighlight();
}

/**
 * Monitor View (When terms are in sync or user toggles view)
 */
function renderMonitorView() {
  if (!state.activeThread) return;
  const t = state.activeThread;

  const driftBadgeEl = document.getElementById('hudDriftBadge');
  if (driftBadgeEl) {
    driftBadgeEl.innerText = 'LOCKED & SYNCED';
    driftBadgeEl.className = 'badge-drift';
  }

  const threadTitleEl = document.getElementById('hudCenterTitle');
  if (threadTitleEl) threadTitleEl.innerText = t.title.toUpperCase();

  const stateBadgeEl = document.getElementById('hudStateBadge');
  if (stateBadgeEl) stateBadgeEl.innerText = t.currentState;

  const headlineEl = document.getElementById('hudHeadline');
  if (headlineEl) headlineEl.innerText = 'BASELINE LOCKED';

  const oldValEl = document.getElementById('hudOldVal');
  const newValEl = document.getElementById('hudNewVal');
  if (oldValEl) oldValEl.innerText = `PRICE: $${t.lockedTerms?.price?.toLocaleString() || 0} ${t.lockedTerms?.currency || 'USD'}`;
  if (newValEl) newValEl.innerText = `DUE: ${t.lockedTerms?.deadline || 'Agreed'}`;

  const tagsEl = document.getElementById('hudTags');
  if (tagsEl) {
    const scopeCount = t.lockedTerms?.scope?.length || 0;
    tagsEl.innerText = `SCOPE: ${scopeCount} DELIVERABLES • ${t.counterparty}`;
  }

  const recEl = document.getElementById('hudRecommendation');
  if (recEl) recEl.innerText = 'STATUS: MONITORING ACTIVE FOR INCOMING DRIFT';

  updateActionBarHighlight();
}

function renderNoThreadView() {
  const headlineEl = document.getElementById('hudHeadline');
  if (headlineEl) headlineEl.innerText = 'AWAITING PAIRING';

  const oldValEl = document.getElementById('hudOldVal');
  const newValEl = document.getElementById('hudNewVal');
  if (oldValEl) oldValEl.innerText = `CODE: ${state.pairingCode}`;
  if (newValEl) newValEl.innerText = 'OPEN COMPANION WEB';

  const tagsEl = document.getElementById('hudTags');
  if (tagsEl) tagsEl.innerText = 'Create a deal lock to begin live HUD protection';

  const recEl = document.getElementById('hudRecommendation');
  if (recEl) recEl.innerText = 'ACTION: READY FOR CONNECTION';

  const driftBadgeEl = document.getElementById('hudDriftBadge');
  if (driftBadgeEl) {
    driftBadgeEl.innerText = 'STANDBY';
    driftBadgeEl.className = 'badge-drift';
  }
}

// ==================== ACTION BAR NAVIGATION & SELECTION ====================
function cycleAction(direction) {
  // direction: 1 for right, -1 for left
  const total = state.actions.length;
  state.selectedActionIndex = (state.selectedActionIndex + direction + total) % total;
  updateActionBarHighlight();
}

function selectActionDirect(actionName) {
  const idx = state.actions.indexOf(actionName);
  if (idx !== -1) {
    state.selectedActionIndex = idx;
    updateActionBarHighlight();
  }
}

function updateActionBarHighlight() {
  const slots = document.querySelectorAll('.action-slot');
  slots.forEach((slot, idx) => {
    const isSelected = idx === state.selectedActionIndex;
    slot.classList.toggle('active', isSelected);
    const indicator = slot.querySelector('.action-indicator');
    if (indicator) {
      indicator.innerText = isSelected ? '▶ ' : '';
    }
  });
}

async function confirmSelectedAction() {
  const action = state.actions[state.selectedActionIndex];
  if (!action || !state.activeThread) return;

  // Visual pulse on glasses
  flashScreen();

  const withUndo = action === 'LOCK' || action === 'COUNTER';
  await executeG2Action(action, withUndo);
}

async function executeG2Action(action, withUndoWindow = true) {
  if (!state.activeThread) return;

  try {
    const res = await fetch('/api/actions/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: state.activeThread.id,
        pairingCode: state.pairingCode,
        action,
        withUndoWindow,
        actor: 'g2-glasses-hud'
      })
    });

    if (res.ok) {
      const data = await res.json();
      state.pendingActionName = action;

      if (data.inUndoWindow) {
        showUndoState(data.undoDeadline, action);
      }

      await fetchActiveThread();
      flashScreen();
    } else {
      const err = await res.json();
      alert(`Action error: ${err.error}`);
    }
  } catch (err) {
    console.error('executeG2Action error', err);
  }
}

// ==================== CONFIRMATION & UNDO STATE ====================
function showUndoState(deadline, actionName) {
  state.inUndoState = true;
  state.pendingActionName = actionName || 'ACTION';

  const overlay = document.getElementById('hudUndoOverlay');
  const actionText = document.getElementById('undoActionName');
  const timerText = document.getElementById('undoCountdownSeconds');

  if (overlay) overlay.style.display = 'flex';
  if (actionText) actionText.innerText = `CONFIRMED [${state.pendingActionName}]`;

  clearInterval(state.undoTimer);

  const tick = () => {
    const remaining = Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000));
    state.undoRemaining = remaining;
    if (timerText) timerText.innerText = `${remaining}s TO UNDO • [TAP TO REVERT]`;

    if (remaining <= 0) {
      clearInterval(state.undoTimer);
      hideUndoState();
      fetchActiveThread();
    }
  };

  tick();
  state.undoTimer = setInterval(tick, 1000);
}

function hideUndoState() {
  state.inUndoState = false;
  clearInterval(state.undoTimer);
  const overlay = document.getElementById('hudUndoOverlay');
  if (overlay) overlay.style.display = 'none';
}

async function triggerUndo() {
  if (!state.activeThread) return;

  try {
    const res = await fetch('/api/state/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: state.activeThread.id,
        pairingCode: state.pairingCode
      })
    });

    if (res.ok) {
      hideUndoState();
      flashScreen();
      await fetchActiveThread();
    }
  } catch (err) {
    console.error('triggerUndo error', err);
  }
}

// ==================== VOICE / AUDIO STT ====================
function promptVoiceCommand() {
  if (!state.activeThread) return;
  const cmd = prompt('Speak or enter voice command (e.g. "Lock terms", "Flag drift", "Send counter", "Undo"):', 'Lock agreed terms');
  if (cmd && cmd.trim()) {
    sendVoiceCommand(cmd.trim());
  }
}

async function sendVoiceCommand(commandText) {
  if (!state.activeThread) return;

  try {
    const res = await fetch('/api/voice/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText,
        pairingCode: state.pairingCode,
        threadId: state.activeThread.id,
        autoExecuteAction: true
      })
    });

    if (res.ok) {
      const data = await res.json();
      flashScreen();
      await fetchActiveThread();
    }
  } catch (err) {
    console.error('sendVoiceCommand error', err);
  }
}

// ==================== VIEW MODES & SIMULATOR HARNESS ====================
function toggleViewMode() {
  state.viewMode = state.viewMode === 'GLANCE' ? 'MONITOR' : 'GLANCE';
  if (state.viewMode === 'GLANCE' && state.latestGlance) {
    renderGlanceView(state.latestGlance, state.activeThread?.currentState);
  } else {
    renderMonitorView();
  }
}

function setRawMode(enabled) {
  state.isRawMode = enabled;
  document.body.classList.toggle('raw-mode', enabled);
  const toggleBtn = document.getElementById('btnToggleRaw');
  if (toggleBtn) {
    toggleBtn.innerText = enabled ? '🕶 Exit Raw 1:1 Mode' : '📐 1:1 Raw Mode (576x288)';
  }
}

function toggleRawMode() {
  setRawMode(!state.isRawMode);
}

function promptPairingCodeChange() {
  const entered = prompt('Enter 6-char G2 Pairing Code:', state.pairingCode);
  if (entered && entered.trim().length >= 4) {
    state.pairingCode = entered.trim().toUpperCase();
    localStorage.setItem('threadlock_pairing_code', state.pairingCode);
    updatePairingCodeDisplay();
    initSSE();
    fetchActiveThread();
  }
}

function flashScreen() {
  const vp = document.getElementById('viewport');
  if (!vp) return;
  vp.classList.add('flash');
  setTimeout(() => {
    vp.classList.remove('flash');
  }, 220);
}

// Expose functions to window for onclick handlers
window.handleSwipeLeft = () => adapter.emit('swipeLeft');
window.handleSwipeRight = () => adapter.emit('swipeRight');
window.handleTap = () => adapter.emit('tap');
window.handleLongPress = () => adapter.emit('longPress');
window.handleRingRotate = (dir) => adapter.emit('ringRotate', dir);
window.handleRingClick = () => adapter.emit('ringClick');
window.handleUndo = () => adapter.emit('undo');
window.handleVoicePrompt = () => promptVoiceCommand();
window.promptPairingCodeChange = () => promptPairingCodeChange();
window.toggleRawMode = () => toggleRawMode();
window.selectActionDirect = (action) => selectActionDirect(action);
window.confirmSelectedAction = () => confirmSelectedAction();
