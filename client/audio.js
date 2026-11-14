// Áudio do jogo — todos os efeitos são sintetizados (assets/audio/*.wav), sem material de terceiros.
const GameAudio = (() => {
  const files = {
    hitJab: "hit_jab.wav",
    hitStraight: "hit_straight.wav",
    hitHook: "hit_hook.wav",
    block: "block.wav",
    dodge: "dodge.wav",
    bell: "bell.wav",
    countdownBeep: "countdown_beep.wav",
    fightGo: "fight_go.wav",
    knockdown: "knockdown.wav",
    victory: "victory.wav",
    special: "special.wav",
    crowd: "crowd_ambience.wav",
    recoverTap: "recover_tap.wav",
    getUp: "get_up.wav",
  };
  const cache = {};
  let muted = false;
  let crowdEl = null;

  function get(name) {
    if (!cache[name]) {
      const a = new Audio(`../assets/audio/${files[name]}`);
      cache[name] = a;
    }
    return cache[name];
  }

  function play(name, vol) {
    if (muted || !files[name]) return;
    try {
      const base = get(name);
      const node = base.cloneNode(); // permite sobrepor o mesmo som várias vezes seguidas
      node.volume = vol != null ? vol : 1;
      node.play().catch(() => {});
    } catch (e) { /* autoplay bloqueado antes de interação do usuário — ignora silenciosamente */ }
  }

  function startCrowd() {
    if (muted) return;
    if (!crowdEl) {
      crowdEl = get("crowd");
      crowdEl.loop = true;
      crowdEl.volume = 0.35;
    }
    crowdEl.play().catch(() => {});
  }
  function stopCrowd() {
    if (crowdEl) { crowdEl.pause(); crowdEl.currentTime = 0; }
  }

  // Trilha dos menus: "Noite de Campeões" — composição ORIGINAL do projeto (sem direitos de terceiros).
  let musicEl = null, musicWanted = false, fadeTimer = null;
  function fadeTo(target, ms, then) {
    if (!musicEl) return;
    clearInterval(fadeTimer);
    const from = musicEl.volume, steps = Math.max(1, Math.round(ms / 40));
    let i = 0;
    fadeTimer = setInterval(() => {
      i++;
      musicEl.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps)));
      if (i >= steps) { clearInterval(fadeTimer); if (then) then(); }
    }, 40);
  }
  function startMusic() {
    musicWanted = true;
    if (muted) return;
    if (!musicEl) {
      musicEl = new Audio("../assets/music/noite-de-campeoes.mp3");
      musicEl.loop = true;
      musicEl.volume = 0;
    }
    if (!musicEl.paused && musicEl.volume > 0.3) return;
    const p = musicEl.play();
    if (p && p.catch) p.catch(() => {}); // navegador bloqueia antes do 1º clique: tentamos de novo no clique
    fadeTo(0.55, 900);
  }
  function stopMusic() {
    musicWanted = false;
    if (!musicEl || musicEl.paused) return;
    fadeTo(0, 700, () => musicEl.pause());
  }
  // Navegadores só deixam tocar som depois de uma interação: no 1º clique/tecla, retoma.
  ["pointerdown", "keydown"].forEach((ev) =>
    window.addEventListener(ev, () => { if (musicWanted && !muted && musicEl && musicEl.paused) startMusic(); }, { passive: true })
  );

  function setMuted(v) {
    muted = v;
    if (muted) { stopCrowd(); if (musicEl) musicEl.pause(); }
    else if (musicWanted) startMusic();
  }
  function isMuted() { return muted; }

  function musicPlaying() { return !!(musicEl && !musicEl.paused && musicEl.volume > 0); }
  return { play, startCrowd, stopCrowd, startMusic, stopMusic, musicPlaying, setMuted, isMuted };
})();

if (typeof window !== "undefined") window.GameAudio = GameAudio;
