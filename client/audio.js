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

  function setMuted(v) {
    muted = v;
    if (muted) stopCrowd();
  }
  function isMuted() { return muted; }

  return { play, startCrowd, stopCrowd, setMuted, isMuted };
})();

if (typeof window !== "undefined") window.GameAudio = GameAudio;
