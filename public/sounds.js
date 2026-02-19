/* ══════════════════════════════════════════════════════════
   SOUNDS  —  Web Audio API synthesised SFX (no files needed)
   All sounds respect a global mute toggle stored in localStorage.
══════════════════════════════════════════════════════════ */

const SFX = (() => {
  let _ctx = null;

  function ctx() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  function isMuted() {
    return localStorage.getItem('sfx_muted') === '1';
  }

  // Play a single oscillator note with an ADSR-style gain envelope
  function tone(freq, type, startTime, duration, peakGain = 0.25) {
    const c = ctx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain);
    gain.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  // Short white-noise burst (used for reveal / whoosh)
  function noise(startTime, duration, peakGain = 0.06) {
    const c = ctx();
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * duration), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    src.connect(gain);
    gain.connect(c.destination);
    gain.gain.setValueAtTime(peakGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    src.start(startTime);
  }

  const SFX = {
    // ── Mute toggle ──────────────────────────────────────────
    muted: localStorage.getItem('sfx_muted') === '1',

    toggleMute() {
      this.muted = !this.muted;
      localStorage.setItem('sfx_muted', this.muted ? '1' : '0');
      document.querySelectorAll('.sfx-mute-btn').forEach(btn => {
        btn.textContent = this.muted ? '🔇' : '🔊';
        btn.title = this.muted ? 'Unmute sounds' : 'Mute sounds';
      });
    },

    // ── Sound definitions ────────────────────────────────────

    // Player joins the waiting room  — soft rising chime
    join() {
      if (this.muted) return;
      const t = ctx().currentTime;
      tone(880,  'sine', t,       0.18, 0.15);
      tone(1100, 'sine', t + 0.1, 0.18, 0.12);
    },

    // Player leaves the waiting room  — descending boop
    leave() {
      if (this.muted) return;
      const t = ctx().currentTime;
      tone(660, 'sine', t,       0.18, 0.12);
      tone(440, 'sine', t + 0.1, 0.22, 0.08);
    },

    // Game / match starting  — upbeat 3-note fanfare
    gameStart() {
      if (this.muted) return;
      const t = ctx().currentTime;
      tone(523, 'sine', t,        0.18, 0.28);
      tone(659, 'sine', t + 0.15, 0.18, 0.28);
      tone(784, 'sine', t + 0.30, 0.35, 0.32);
    },

    // New turn / new drawer  — attention ping
    turnStart() {
      if (this.muted) return;
      const t = ctx().currentTime;
      tone(880, 'triangle', t, 0.22, 0.18);
    },

    // Correct guess (you guessed the word, or word bomb word accepted)
    correct() {
      if (this.muted) return;
      const t = ctx().currentTime;
      tone(523, 'sine', t,        0.12, 0.22);
      tone(659, 'sine', t + 0.12, 0.12, 0.22);
      tone(784, 'sine', t + 0.24, 0.28, 0.28);
    },

    // Someone else guessed correctly  — gentler version
    otherCorrect() {
      if (this.muted) return;
      const t = ctx().currentTime;
      tone(659, 'sine', t,        0.1, 0.12);
      tone(784, 'sine', t + 0.12, 0.2, 0.14);
    },

    // Round / turn over  — brief two-note close
    roundEnd() {
      if (this.muted) return;
      const t = ctx().currentTime;
      tone(659, 'sine', t,        0.12, 0.18);
      tone(523, 'sine', t + 0.15, 0.28, 0.16);
    },

    // Game over: winner  — victory fanfare
    win() {
      if (this.muted) return;
      const t = ctx().currentTime;
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(f, 'sine', t + i * 0.13, 0.28, 0.28)
      );
    },

    // Game over: not the winner  — deflating chord
    lose() {
      if (this.muted) return;
      const t = ctx().currentTime;
      tone(440, 'triangle', t,        0.25, 0.15);
      tone(349, 'triangle', t + 0.2,  0.35, 0.12);
    },

    // Word / canvas revealed  — quick noise whoosh
    reveal() {
      if (this.muted) return;
      noise(ctx().currentTime, 0.18, 0.08);
    },

    // Timer critical  — sharp tick (call once per second when time ≤ 10)
    tick() {
      if (this.muted) return;
      tone(1200, 'square', ctx().currentTime, 0.06, 0.09);
    },

    // Incoming chat message (only for others' guesses/messages)
    chat() {
      if (this.muted) return;
      tone(1320, 'sine', ctx().currentTime, 0.07, 0.06);
    },

    // Word submitted (Wordle / Word Bomb) — satisfying click
    submit() {
      if (this.muted) return;
      const t = ctx().currentTime;
      tone(440, 'sine', t,        0.08, 0.18);
      tone(550, 'sine', t + 0.06, 0.12, 0.12);
    },
  };

  return SFX;
})();

/* ── Mute button factory ───────────────────────────────────────
   Call mountMuteBtn(parentEl) to inject a 🔊/🔇 toggle button.
   Uses class "sfx-mute-btn" so toggleMute() can update all instances.
─────────────────────────────────────────────────────────────── */
function mountMuteBtn(parent) {
  const btn = document.createElement('button');
  btn.className = 'sfx-mute-btn';
  btn.textContent = SFX.muted ? '🔇' : '🔊';
  btn.title = SFX.muted ? 'Unmute sounds' : 'Mute sounds';
  btn.style.cssText = [
    'background:none', 'border:none', 'cursor:pointer',
    'font-size:1.1rem', 'padding:0 0.25rem', 'opacity:0.7',
    'transition:opacity 0.15s', 'line-height:1',
  ].join(';');
  btn.onmouseover = () => btn.style.opacity = '1';
  btn.onmouseout  = () => btn.style.opacity = '0.7';
  btn.onclick = () => SFX.toggleMute();
  parent.appendChild(btn);
}
