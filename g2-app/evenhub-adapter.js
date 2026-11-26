/**
 * Even Hub SDK Adapter & Hardware Controller for ThreadLock G2
 * Designed for Even Realities G2 smart glasses & R1 Ring
 * 
 * Automatically detects whether running inside the Even Hub WebView or a standard browser,
 * providing identical unified events across:
 * - Touchpad on glasses temple (Swipe L/R, Tap, Double Tap, Long Press)
 * - Even R1 Ring (Rotate CW/CCW, Click, Double Click)
 * - Microphone voice input
 * - Simulator keyboard/touch harness
 */

export class EvenHubAdapter {
  constructor() {
    this.isEvenDevice = this.detectEvenEnvironment();
    this.listeners = {
      swipeLeft: [],
      swipeRight: [],
      tap: [],
      doubleTap: [],
      longPress: [],
      ringRotate: [], // (direction: 1 | -1)
      ringClick: [],
      voiceTrigger: [],
      lifecycle: []   // ('resumed' | 'paused')
    };

    this.isActive = true;
    this.initHardwareHooks();
    this.initKeyboardHarness();
  }

  /**
   * Detects Even Hub WebView injected interface
   */
  detectEvenEnvironment() {
    return !!(
      window.EvenHub ||
      window.evenHub ||
      window.even ||
      navigator.userAgent.includes('EvenHub') ||
      navigator.userAgent.includes('EvenRealities')
    );
  }

  /**
   * Subscribes to hardware touch / ring / audio events
   */
  initHardwareHooks() {
    const hub = window.EvenHub || window.evenHub || window.even;

    if (this.isEvenDevice && hub) {
      console.log('[EvenHubAdapter] Connected to physical Even Realities G2 hardware bridge');

      // Temple Touchpad
      if (typeof hub.onGesture === 'function') {
        hub.onGesture((gesture) => {
          if (!this.isActive) return;
          switch (gesture) {
            case 'SWIPE_LEFT':
            case 'swipe_left':
              this.emit('swipeLeft');
              break;
            case 'SWIPE_RIGHT':
            case 'swipe_right':
              this.emit('swipeRight');
              break;
            case 'TAP':
            case 'tap':
              this.emit('tap');
              break;
            case 'DOUBLE_TAP':
            case 'double_tap':
              this.emit('doubleTap');
              break;
            case 'LONG_PRESS':
            case 'long_press':
              this.emit('longPress');
              break;
          }
        });
      }

      // Even R1 Ring
      if (typeof hub.onRingEvent === 'function') {
        hub.onRingEvent((event) => {
          if (!this.isActive) return;
          if (event.type === 'ROTATE') {
            this.emit('ringRotate', event.delta > 0 ? 1 : -1);
          } else if (event.type === 'CLICK') {
            this.emit('ringClick');
          }
        });
      }

      // Microphone Voice Input
      if (typeof hub.onVoiceCommand === 'function') {
        hub.onVoiceCommand((transcription) => {
          if (!this.isActive) return;
          this.emit('voiceTrigger', transcription);
        });
      }

      // App Lifecycle (Save battery & prevent background popups)
      if (typeof hub.onVisibilityChanged === 'function') {
        hub.onVisibilityChanged((visible) => {
          this.isActive = visible;
          this.emit('lifecycle', visible ? 'resumed' : 'paused');
        });
      }
    } else {
      console.log('[EvenHubAdapter] Running in Simulator / Web Mode (Desktop Harness Active)');
    }

    // Standard document visibilitychange support
    document.addEventListener('visibilitychange', () => {
      const state = document.hidden ? 'paused' : 'resumed';
      this.isActive = !document.hidden;
      this.emit('lifecycle', state);
    });
  }

  /**
   * Keyboard shortcuts for development & judge testing
   */
  initKeyboardHarness() {
    window.addEventListener('keydown', (e) => {
      // Don't intercept if typing in a prompt or input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'ArrowLeft':
        case 'h':
          e.preventDefault();
          this.emit('swipeLeft');
          this.emit('ringRotate', -1);
          break;
        case 'ArrowRight':
        case 'l':
          e.preventDefault();
          this.emit('swipeRight');
          this.emit('ringRotate', 1);
          break;
        case ' ': // Space = Tap
          e.preventDefault();
          this.emit('tap');
          break;
        case 'Enter': // Enter = Confirm / Long Press / Ring Click
          e.preventDefault();
          this.emit('longPress');
          this.emit('ringClick');
          break;
        case 'u':
        case 'U': // U = Undo
          e.preventDefault();
          this.emit('undo');
          break;
        case 'v':
        case 'V': // V = Voice
          e.preventDefault();
          this.emit('voicePrompt');
          break;
      }
    });
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  emit(event, ...args) {
    if (this.listeners[event]) {
      for (const cb of this.listeners[event]) {
        try {
          cb(...args);
        } catch (err) {
          console.error(`[EvenHubAdapter] Error in listener for ${event}:`, err);
        }
      }
    }
  }

  /**
   * Haptic vibration pulse if supported by Even Hub
   */
  hapticPulse(durationMs = 50) {
    const hub = window.EvenHub || window.evenHub || window.even;
    if (hub && typeof hub.vibrate === 'function') {
      try {
        hub.vibrate(durationMs);
      } catch {}
    } else if (navigator.vibrate) {
      try {
        navigator.vibrate(durationMs);
      } catch {}
    }
  }
}
