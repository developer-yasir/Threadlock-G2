/**
 * ThreadLock G2 — Companion Web Console Application
 * Even Realities Hackathon 2026
 */

// Application State
const state = {
  pairingCode: '',
  activeThreadId: null,
  activeThread: null,
  threads: [],
  latestDiff: null,
  eventSource: null,
  pollTimer: null,
  undoTimer: null,
  undoRemaining: 0,
  isRecordingVoice: false,
  recognition: null,
  telegramStatus: {
    isLinked: false,
    botUsername: '@threadlock_g2_bot',
    deepLink: '',
  }
};

// Preset Scenarios for Hackathon Judges & Demos
const DEMO_PRESETS = {
  PRICE_JUMP: {
    label: '+15% Price Drift ($11,500)',
    message: 'Hey! We reviewed the scope, our updated quote is $11,500 USD for the milestone.'
  },
  DEADLINE_SLIP: {
    label: '+25d Deadline Slip (Dec 25)',
    message: 'Due to end-of-year backlog, we must push the delivery date to 2026-12-25.'
  },
  SCOPE_CREEP: {
    label: 'Scope Creep (+Admin Dashboard)',
    message: 'Can you also include a native iPad tablet version, push notifications, and admin analytics dashboard?'
  },
  SNEAKY_TERMS: {
    label: 'Sneaky Net 90 Retainage',
    message: 'We accept the quote! Just note our standard vendor payment terms are Net 90 with 20% retainage held.'
  },
  CLEAN_CONFIRM: {
    label: 'Clean Agreement Confirmation',
    message: 'Everything looks perfect. We confirm the $10,000 USD budget and Nov 30 deadline. Let us proceed!'
  }
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  initPairingCode();
  initSSE();
  fetchThreads();
  fetchTelegramStatus();
  initVoiceRecognition();
});

/**
 * Reads pairing code from URL param or localStorage or creates default G2-S9EY
 */
function initPairingCode() {
  const urlParams = new URLSearchParams(window.location.search);
  const codeParam = urlParams.get('pairingCode') || urlParams.get('code');

  if (codeParam && codeParam.trim().length >= 4) {
    state.pairingCode = codeParam.trim().toUpperCase();
  } else {
    state.pairingCode = localStorage.getItem('threadlock_pairing_code') || 'G2-S9EY';
  }

  localStorage.setItem('threadlock_pairing_code', state.pairingCode);
  updatePairingCodeUI();
}

function updatePairingCodeUI() {
  const el = document.getElementById('activePairingCode');
  if (el) el.innerText = state.pairingCode;
}

/**
 * Prompts user to change or enter a custom pairing code
 */
function promptPairingCode() {
  const entered = prompt('Enter 6-char G2 Pairing Code (e.g. G2-S9EY):', state.pairingCode);
  if (entered && entered.trim().length >= 4) {
    state.pairingCode = entered.trim().toUpperCase();
    localStorage.setItem('threadlock_pairing_code', state.pairingCode);
    updatePairingCodeUI();
    showToast(`Switched session to ${state.pairingCode}`);
    initSSE();
    fetchThreads();
    fetchTelegramStatus();
  }
}

/**
 * Generates a fresh random pairing code
 */
function generateNewPairingCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  state.pairingCode = `G2-${suffix}`;
  localStorage.setItem('threadlock_pairing_code', state.pairingCode);
  updatePairingCodeUI();
  showToast(`Created new session ${state.pairingCode}`);
  initSSE();
  fetchThreads();
  fetchTelegramStatus();
}

// ==================== SSE STREAMING & FALLBACK POLLING ====================
function initSSE() {
  if (state.eventSource) {
    state.eventSource.close();
  }

  const dot = document.getElementById('streamStatusDot');
  const label = document.getElementById('streamStatusLabel');

  try {
    state.eventSource = new EventSource(`/api/stream?pairingCode=${state.pairingCode}`);

    state.eventSource.onopen = () => {
      if (dot) {
        dot.className = 'status-dot online';
      }
      if (label) label.innerText = 'Connected (SSE)';
      clearInterval(state.pollTimer);
    };

    state.eventSource.onerror = () => {
      if (dot) dot.className = 'status-dot pending';
      if (label) label.innerText = 'Polling Fallback';
      startPollingFallback();
    };

    // Real-time Drift Alert received
    state.eventSource.addEventListener('diff_alert', (e) => {
      try {
        const data = JSON.parse(e.data);
        renderEvaluation(data.evaluation);
        renderG2Preview(data.glance?.g2Lines || data.evaluation?.glance?.g2Lines);
        fetchThreads();
        if (state.activeThreadId) fetchAudit(state.activeThreadId);
        showToast(`⚡ Drift Alert: ${data.glance?.headlineDiff || 'Diff Detected'}`);
      } catch (err) {
        console.error('SSE diff_alert parse error', err);
      }
    });

    // Real-time State Change (LOCK, FLAG, COUNTER, UNDO)
    state.eventSource.addEventListener('state_changed', (e) => {
      try {
        const data = JSON.parse(e.data);
        fetchThreads();
        if (state.activeThreadId) fetchAudit(state.activeThreadId);
      } catch (err) {
        console.error('SSE state_changed parse error', err);
      }
    });
  } catch (err) {
    startPollingFallback();
  }
}

function startPollingFallback() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    fetchThreads();
    if (state.activeThreadId) fetchAudit(state.activeThreadId);
  }, 4000);
}

// ==================== THREADS & BASELINE LOCKER ====================
async function fetchThreads() {
  try {
    const res = await fetch(`/api/threads?pairingCode=${state.pairingCode}`);
    if (!res.ok) return;
    state.threads = await res.json();

    renderThreadsList();

    // Auto-select thread or select first available
    if (state.threads.length > 0) {
      const currentExists = state.threads.some(t => t.id === state.activeThreadId);
      if (!currentExists || !state.activeThreadId) {
        selectThread(state.threads[0].id);
      } else {
        const active = state.threads.find(t => t.id === state.activeThreadId);
        if (active) {
          state.activeThread = active;
          renderActiveBaseline(active);
        }
      }
    } else {
      state.activeThreadId = null;
      state.activeThread = null;
      renderEmptyBaseline();
    }
  } catch (err) {
    console.error('fetchThreads error', err);
  }
}

function renderThreadsList() {
  const container = document.getElementById('threadsList');
  if (!container) return;

  if (state.threads.length === 0) {
    container.innerHTML = `
      <div style="color: var(--text-muted); font-size: 0.8rem; padding: 8px 0;">
        No active deal locks in this session. Lock one below to start monitoring!
      </div>
    `;
    return;
  }

  container.innerHTML = state.threads.map(t => {
    const isSelected = t.id === state.activeThreadId;
    const priceStr = t.lockedTerms?.price !== undefined
      ? `$${t.lockedTerms.price.toLocaleString()} ${t.lockedTerms.currency || 'USD'}`
      : 'Agreed Rate';

    return `
      <div onclick="selectThread('${t.id}')" style="
        background: ${isSelected ? '#142033' : 'var(--bg-input)'};
        border: 1px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-subtle)'};
        padding: 9px 12px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="font-size: 0.85rem; color: ${isSelected ? '#fff' : '#cbd5e1'};">${escapeHtml(t.title)}</strong>
          <span class="badge badge-${t.currentState.toLowerCase().replace('_', '-')}">${t.currentState}</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 3px;">
          ${escapeHtml(t.counterparty)} • ${priceStr} • Due ${t.lockedTerms?.deadline || 'N/A'}
        </div>
      </div>
    `;
  }).join('');
}

async function selectThread(id) {
  state.activeThreadId = id;
  renderThreadsList();

  try {
    const res = await fetch(`/api/threads/${id}?pairingCode=${state.pairingCode}`);
    if (!res.ok) return;
    const thread = await res.json();
    state.activeThread = thread;

    renderActiveBaseline(thread);

    if (thread.latestDiff) {
      state.latestDiff = thread.latestDiff;
      renderEvaluation(thread.latestDiff);
      renderG2Preview(thread.latestDiff.glance?.g2Lines);
    } else {
      resetEvaluationView();
    }

    if (thread.currentState === 'UNDO_WINDOW') {
      showUndoBanner(thread.undoDeadline);
    } else {
      hideUndoBanner();
    }

    fetchAudit(id);
  } catch (err) {
    console.error('selectThread error', err);
  }
}

function renderActiveBaseline(thread) {
  const container = document.getElementById('activeBaselineBox');
  if (!container) return;

  const t = thread.lockedTerms || {};
  const priceFormatted = t.price !== undefined ? `$${t.price.toLocaleString()} ${t.currency || 'USD'}` : 'Not Specified';

  // Compute dynamic drift badges based on latestDiff
  const driftBadgesHtml = getDriftBadgesHtml(thread);

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
      <div>
        <h4 style="font-size: 0.95rem; color: #fff;">${escapeHtml(thread.title)}</h4>
        <span style="font-size: 0.75rem; color: var(--text-dim);">Counterparty: <strong>${escapeHtml(thread.counterparty)}</strong> (${thread.channel || 'Telegram'})</span>
      </div>
      <span class="badge badge-${thread.currentState.toLowerCase().replace('_', '-')}">${thread.currentState}</span>
    </div>

    <div style="margin: 6px 0;">
      ${driftBadgesHtml}
    </div>

    <div class="baseline-row">
      <span style="color: var(--text-dim);">Agreed Price:</span>
      <strong style="color: var(--accent-green); font-family: var(--hud-mono); font-size: 0.9rem;">${priceFormatted}</strong>
    </div>

    <div class="baseline-row">
      <span style="color: var(--text-dim);">Agreed Deadline:</span>
      <strong style="color: #cbd5e1; font-family: var(--hud-mono);">${t.deadline || 'As agreed'}</strong>
    </div>

    <div class="baseline-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
      <span style="color: var(--text-dim);">Deliverables / Scope:</span>
      <div class="scope-tag-list">
        ${(t.scope && t.scope.length > 0)
          ? t.scope.map(s => `<span class="scope-tag">${escapeHtml(s)}</span>`).join('')
          : '<span style="color: var(--text-dim); font-size: 0.75rem;">All agreed deliverables</span>'
        }
      </div>
    </div>

    <div style="font-size: 0.75rem; color: var(--text-muted); background: #070b10; padding: 6px 8px; border-radius: 4px; margin-top: 4px;">
      <strong>Baseline Summary:</strong> ${escapeHtml(thread.baselineSummary || 'N/A')}
    </div>
  `;
}

function renderEmptyBaseline() {
  const container = document.getElementById('activeBaselineBox');
  if (container) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-dim); font-size: 0.8rem; padding: 16px 0;">
        No active deal lock. Fill the form below and click <strong>"Lock Agreed Terms"</strong>.
      </div>
    `;
  }
}

/**
 * Generates visual badges when a term has drifted (Price Changed, Deadline Shifted, Scope Changed)
 */
function getDriftBadgesHtml(thread) {
  if (!thread.latestDiff || !thread.latestDiff.hasDrift) {
    return `<span class="drift-badge drift-badge-green">● ALL TERMS LOCKED & IN SYNC</span>`;
  }

  const diff = thread.latestDiff;
  const badges = [];

  if (diff.numericDrifts && diff.numericDrifts.length > 0) {
    const p = diff.numericDrifts[0];
    const sign = p.absoluteChange >= 0 ? '+' : '';
    badges.push(`<span class="drift-badge drift-badge-red">● Price Drift (${sign}${p.percentageChange.toFixed(1)}%)</span>`);
  }

  if (diff.dateDrifts && diff.dateDrifts.length > 0) {
    const d = diff.dateDrifts[0];
    const sign = d.shiftDays >= 0 ? '+' : '';
    badges.push(`<span class="drift-badge drift-badge-amber">● Deadline Shifted (${sign}${d.shiftDays}d)</span>`);
  }

  if (diff.scopeDrifts && diff.scopeDrifts.length > 0) {
    const count = diff.scopeDrifts.length;
    badges.push(`<span class="drift-badge drift-badge-purple">● Scope Changed (${count} ${count === 1 ? 'item' : 'items'})</span>`);
  }

  if (diff.customRuleViolations && diff.customRuleViolations.length > 0) {
    badges.push(`<span class="drift-badge drift-badge-red">● Rule Violation Flagged</span>`);
  }

  return `<div style="display: flex; gap: 6px; flex-wrap: wrap;">${badges.join('')}</div>`;
}

/**
 * Handles creation of new baseline deal lock
 */
async function handleCreateThread(e) {
  e.preventDefault();

  const title = document.getElementById('title').value.trim();
  const counterparty = document.getElementById('counterparty').value.trim();
  const channel = document.getElementById('channel').value;
  const price = parseFloat(document.getElementById('price').value);
  const currency = document.getElementById('currency').value.trim().toUpperCase() || 'USD';
  const deadline = document.getElementById('deadline').value;
  const scopeVal = document.getElementById('scope').value.split(',').map(s => s.trim()).filter(Boolean);
  const baselineSummary = document.getElementById('baselineSummary').value.trim();

  const payload = {
    pairingCode: state.pairingCode,
    title,
    counterparty,
    channel,
    baselineSummary,
    lockedTerms: {
      price,
      currency,
      deadline,
      scope: scopeVal,
      customRules: [
        {
          id: 'cr1',
          name: 'Strict Payment Protection',
          description: 'Forbids net 90 or retainage held without prior agreement',
          forbiddenKeywords: ['net 90', 'retainage'],
          severity: 'HIGH'
        }
      ]
    }
  };

  try {
    const res = await fetch('/api/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const created = await res.json();
      showToast(`🔒 Agreement locked: "${created.title}"`);
      await fetchThreads();
      selectThread(created.id);
    } else {
      const err = await res.json();
      alert('Failed to lock terms: ' + (err.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('handleCreateThread error', err);
    alert('Network error locking terms');
  }
}

// ==================== DIFF EVALUATION & G2 DISPLAY ====================
function setDemoPreset(key) {
  const preset = DEMO_PRESETS[key];
  if (preset) {
    const input = document.getElementById('incomingMessage');
    if (input) input.value = preset.message;
    showToast(`Loaded preset: ${preset.label}`);
  }
}

async function evaluateMessage() {
  if (!state.activeThreadId) {
    alert('Please select or create an active deal lock first!');
    return;
  }

  const message = document.getElementById('incomingMessage').value.trim();
  if (!message) return;

  try {
    const res = await fetch('/api/diff/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: state.activeThreadId,
        pairingCode: state.pairingCode,
        message,
        sender: state.activeThread?.counterparty || '@client'
      })
    });

    if (res.ok) {
      const data = await res.json();
      renderEvaluation(data.evaluation);
      renderG2Preview(data.evaluation.glance?.g2Lines);
      fetchThreads();
      fetchAudit(state.activeThreadId);
      showToast('Diff evaluated and pushed to G2 Glasses HUD!');
    } else {
      const err = await res.json();
      alert('Diff evaluation error: ' + err.error);
    }
  } catch (err) {
    console.error('evaluateMessage error', err);
  }
}

async function sendViaTelegramBridge() {
  const message = document.getElementById('incomingMessage').value.trim();
  if (!message) return;

  try {
    const res = await fetch('/api/telegram/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: state.pairingCode,
        senderName: 'Client Partner',
        senderUsername: state.activeThread?.counterparty || '@client_buyer',
        text: message
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.evaluation) {
        renderEvaluation(data.evaluation);
        renderG2Preview(data.evaluation.glance?.g2Lines);
      }
      fetchThreads();
      if (state.activeThreadId) fetchAudit(state.activeThreadId);
      showToast('Simulated incoming Telegram message ingested!');
    }
  } catch (err) {
    console.error('sendViaTelegramBridge error', err);
  }
}

function renderEvaluation(evaluation) {
  if (!evaluation) return;
  const box = document.getElementById('diffCard');
  if (!box) return;

  box.style.display = 'flex';

  const headline = document.getElementById('diffHeadline');
  const oldVal = document.getElementById('diffOldVal');
  const newVal = document.getElementById('diffNewVal');
  const action = document.getElementById('diffAction');
  const reason = document.getElementById('diffReason');
  const sevBadge = document.getElementById('diffSeverityBadge');

  if (headline) headline.innerText = evaluation.glance?.headlineDiff || 'DIFF EVALUATION';
  if (oldVal) oldVal.innerText = evaluation.glance?.oldValue || '-';
  if (newVal) newVal.innerText = evaluation.glance?.newValue || '-';
  if (action) action.innerText = evaluation.glance?.recommendedAction || 'FLAG';
  if (reason) reason.innerText = evaluation.glance?.shortReason || 'Evaluated against locked baseline.';

  if (sevBadge) {
    const sev = evaluation.severity || 'LOW';
    sevBadge.innerText = `${sev} SEVERITY`;
    sevBadge.className = `badge ${sev === 'HIGH' ? 'badge-flagged' : (sev === 'MEDIUM' ? 'badge-counter' : 'badge-locked')}`;
  }
}

function resetEvaluationView() {
  const box = document.getElementById('diffCard');
  if (box) box.style.display = 'none';
}

function renderG2Preview(lines) {
  const container = document.getElementById('g2PreviewDisplay');
  if (!container) return;

  if (!lines || lines.length === 0) {
    container.innerHTML = `
      <div class="g2-line">[i] THREADLOCK HUD: STANDBY</div>
      <div class="g2-line">READY FOR INCOMING EVALUATION</div>
      <div class="g2-line">------------------------------------</div>
      <div class="g2-line">Awaiting messages on active thread</div>
      <div class="g2-line">ACTION: MONITORING ACTIVE</div>
      <div class="g2-line">&lt;SWIPE: ACTIONS | TAP: TOGGLE&gt;</div>
    `;
    return;
  }

  container.innerHTML = lines.map(line => `<div class="g2-line">${escapeHtml(line)}</div>`).join('');
}

// ==================== READ & WRITE ACTION EXECUTION ====================
async function executeAction(action, withUndoWindow = true) {
  if (!state.activeThreadId) {
    alert('Please select or create an active deal lock first!');
    return;
  }

  try {
    const res = await fetch('/api/actions/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: state.activeThreadId,
        pairingCode: state.pairingCode,
        action,
        actor: 'companion-web',
        withUndoWindow
      })
    });

    if (res.ok) {
      const data = await res.json();
      showToast(`Action [${action}] executed: ${data.message}`);

      if (data.inUndoWindow) {
        showUndoBanner(data.undoDeadline);
      } else {
        hideUndoBanner();
      }

      await fetchThreads();
      await selectThread(state.activeThreadId);
      fetchAudit(state.activeThreadId);
    } else {
      const err = await res.json();
      alert(`Action error: ${err.error}`);
    }
  } catch (err) {
    console.error('executeAction error', err);
  }
}

function showUndoBanner(deadline) {
  const banner = document.getElementById('undoBanner');
  if (!banner) return;

  banner.style.display = 'flex';
  clearInterval(state.undoTimer);

  const updateCountdown = () => {
    const remainingSeconds = Math.max(0, Math.round((new Date(deadline).getTime() - Date.now()) / 1000));
    const secEl = document.getElementById('undoSeconds');
    if (secEl) secEl.innerText = remainingSeconds;

    if (remainingSeconds <= 0) {
      clearInterval(state.undoTimer);
      hideUndoBanner();
      fetchThreads();
    }
  };

  updateCountdown();
  state.undoTimer = setInterval(updateCountdown, 1000);
}

function hideUndoBanner() {
  clearInterval(state.undoTimer);
  const banner = document.getElementById('undoBanner');
  if (banner) banner.style.display = 'none';
}

async function triggerUndo() {
  if (!state.activeThreadId) return;

  try {
    const res = await fetch('/api/state/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId: state.activeThreadId,
        pairingCode: state.pairingCode
      })
    });

    if (res.ok) {
      hideUndoBanner();
      showToast('↩️ Action reverted within undo window!');
      await fetchThreads();
      fetchAudit(state.activeThreadId);
    } else {
      const err = await res.json();
      alert(`Undo error: ${err.error}`);
    }
  } catch (err) {
    console.error('triggerUndo error', err);
  }
}

// ==================== VOICE COMMANDS (WEB SPEECH + SERVER-SIDE STT) ====================
function initVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  try {
    state.recognition = new SpeechRecognition();
    state.recognition.continuous = false;
    state.recognition.interimResults = false;
    state.recognition.lang = 'en-US';

    state.recognition.onstart = () => {
      state.isRecordingVoice = true;
      const micBtn = document.getElementById('micRecordBtn');
      if (micBtn) {
        micBtn.classList.add('btn-red');
        micBtn.innerText = '🔴 Listening...';
      }
    };

    state.recognition.onend = () => {
      state.isRecordingVoice = false;
      const micBtn = document.getElementById('micRecordBtn');
      if (micBtn) {
        micBtn.classList.remove('btn-red');
        micBtn.innerText = '🎙 Speak Command';
      }
    };

    state.recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      const input = document.getElementById('voiceCommandInput');
      if (input) input.value = transcript;
      sendVoiceCommand(transcript);
    };

    state.recognition.onerror = (e) => {
      console.warn('Speech recognition error:', e.error);
    };
  } catch (err) {
    console.warn('SpeechRecognition initialization error', err);
  }
}

function toggleVoiceRecord() {
  if (!state.recognition) {
    showToast('Browser microphone recognition not supported. Use text voice command.');
    return;
  }

  if (state.isRecordingVoice) {
    state.recognition.stop();
  } else {
    try {
      state.recognition.start();
    } catch {}
  }
}

function setVoicePreset(text) {
  const input = document.getElementById('voiceCommandInput');
  if (input) input.value = text;
}

async function sendVoiceCommand(overrideText) {
  const text = overrideText || document.getElementById('voiceCommandInput').value.trim();
  if (!text) return;

  try {
    const res = await fetch('/api/voice/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commandText: text,
        pairingCode: state.pairingCode,
        threadId: state.activeThreadId,
        autoExecuteAction: true
      })
    });

    if (res.ok) {
      const data = await res.json();
      const resultBox = document.getElementById('voiceResultBox');
      if (resultBox) resultBox.style.display = 'block';

      const transEl = document.getElementById('voiceTranscribedText');
      const intentEl = document.getElementById('voiceIntentBadge');
      const msgEl = document.getElementById('voiceActionMsg');

      if (transEl) transEl.innerText = `"${data.transcribedText}"`;
      if (intentEl) intentEl.innerText = data.detectedIntent;

      if (data.executedAction) {
        if (msgEl) msgEl.innerText = `Executed [${data.executedAction.action}]: ${data.executedAction.message}`;
        if (data.executedAction.inUndoWindow) {
          showUndoBanner(data.executedAction.undoDeadline);
        }
        fetchThreads();
        if (state.activeThreadId) fetchAudit(state.activeThreadId);
      } else {
        if (msgEl) msgEl.innerText = 'Voice intent evaluated successfully.';
      }
    }
  } catch (err) {
    console.error('sendVoiceCommand error', err);
  }
}

// ==================== TELEGRAM INTEGRATION ====================
async function fetchTelegramStatus() {
  try {
    const res = await fetch(`/api/telegram/status?pairingCode=${state.pairingCode}`);
    if (!res.ok) return;
    const data = await res.json();

    state.telegramStatus = data;

    const label = document.getElementById('tgStatusLabel');
    const deepInput = document.getElementById('tgDeepLinkInput');
    const openBtn = document.getElementById('tgOpenBtn');

    if (deepInput) deepInput.value = data.deepLink;
    if (openBtn) openBtn.href = data.deepLink;

    if (label) {
      if (data.isLinked) {
        label.innerText = `Linked: ${data.telegramLink.username || data.telegramLink.firstName || 'Chat ' + data.telegramLink.chatId}`;
        label.style.color = 'var(--accent-green)';
      } else {
        label.innerText = 'Unlinked (Click to Connect)';
        label.style.color = 'var(--text-muted)';
      }
    }
  } catch (err) {
    console.error('fetchTelegramStatus error', err);
  }
}

function toggleTelegramModal() {
  const modal = document.getElementById('tgModal');
  if (!modal) return;
  const isHidden = modal.style.display === 'none' || !modal.style.display;
  modal.style.display = isHidden ? 'flex' : 'none';
  if (isHidden) fetchTelegramStatus();
}

function copyTelegramLink() {
  const val = document.getElementById('tgDeepLinkInput').value;
  navigator.clipboard.writeText(val);
  showToast('Telegram deep-link copied to clipboard!');
}

async function simulateTelegramLink() {
  try {
    const res = await fetch('/api/telegram/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: state.pairingCode,
        chatId: 10001,
        username: '@demo_partner',
        firstName: 'Demo Partner'
      })
    });

    if (res.ok) {
      fetchTelegramStatus();
      showToast(`Telegram link established for session ${state.pairingCode}!`);
      toggleTelegramModal();
    }
  } catch (err) {
    console.error('simulateTelegramLink error', err);
  }
}

// ==================== AUDIT TRAIL & HASH VERIFICATION ====================
async function fetchAudit(threadId) {
  try {
    const res = await fetch(`/api/audit/${threadId}?pairingCode=${state.pairingCode}`);
    if (!res.ok) return;
    const events = await res.json();

    const container = document.getElementById('auditList');
    if (!container) return;

    if (!Array.isArray(events) || events.length === 0) {
      container.innerHTML = '<div style="color: var(--text-dim); font-size: 0.8rem;">No audit records on this thread.</div>';
      return;
    }

    container.innerHTML = events.slice().reverse().map(e => `
      <div class="audit-entry">
        <div class="audit-meta">
          <span>${e.actor} ${e.toState ? `→ [${e.toState}]` : ''}</span>
          <span>${new Date(e.timestamp).toLocaleTimeString()}</span>
        </div>
        <strong style="color: #cbd5e1; font-size: 0.82rem;">${escapeHtml(e.action)}</strong>
        <div class="audit-hash-code">SHA-256: ${e.hash.substring(0, 28)}...</div>
      </div>
    `).join('');
  } catch (err) {
    console.error('fetchAudit error', err);
  }
}

async function verifyAuditIntegrity() {
  if (!state.activeThreadId) {
    alert('Please select an active deal lock first!');
    return;
  }

  try {
    const res = await fetch(`/api/audit/verify/${state.activeThreadId}`);
    if (!res.ok) return;
    const data = await res.json();

    const statusEl = document.getElementById('integrityStatus');
    if (!statusEl) return;

    statusEl.style.display = 'block';

    if (data.isValid) {
      statusEl.innerHTML = `<strong>🛡 Chain Verified:</strong> 100% untampered SHA-256 integrity (${data.totalEvents} events validated).`;
      statusEl.style.color = 'var(--accent-green)';
    } else {
      statusEl.innerHTML = `<strong>⚠️ Chain Broken:</strong> Tamper detected at event: ${data.brokenAtEventId}`;
      statusEl.style.color = 'var(--accent-rose)';
    }
  } catch (err) {
    console.error('verifyAuditIntegrity error', err);
  }
}

// ==================== UTILITIES ====================
function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3200);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
