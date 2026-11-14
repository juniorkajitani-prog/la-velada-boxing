// Motor de combate — compartilhado entre servidor (autoritativo) e cliente
// (modos locais: treinamento vs IA e 2 jogadores no mesmo teclado).
// Determinístico e sem referências a DOM/canvas: recebe estado + input, devolve novo estado.

const ARENA_WIDTH = 900;
const FLOOR_Y = 420;
const FIGHTER_HALF_WIDTH = 34;
const MOVE_SPEED_BASE = 180; // px/s a velocidade 100 (antes 90: andar até o rival levava 5-13s)
const ROUND_MS = 60 * 1000;
const ROUNDS_TOTAL = 3;
// Vida zerada = NOCAUTE: o lutador cai e NÃO levanta. O juiz faz a contagem até 10
// (rápida, só para a cena) e a luta acaba ali — não existe próximo round.
const KNOCKDOWN_COUNT_MS = 4000;

const MOVES = {
  jab: { region: "head", dmg: 6, staminaCost: 6, startup: 90, active: 70, recover: 140, range: 80 },
  straight: { region: "head", dmg: 10, staminaCost: 10, startup: 140, active: 80, recover: 220, range: 90 },
  hookLeft: { region: "body", dmg: 9, staminaCost: 12, startup: 160, active: 90, recover: 260, range: 70, stunChance: 0.04 },
  hookRight: { region: "body", dmg: 9, staminaCost: 12, startup: 160, active: 90, recover: 260, range: 70, stunChance: 0.04 },
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function getCharacterById(id) {
  // Lazy require to avoid circular import issues in browser bundle (characters.js loaded separately there)
  if (typeof module !== "undefined" && module.exports) {
    return require("./characters.js").getCharacter(id);
  }
  return window.getCharacter(id);
}

function createFighter(characterId, x, facing, playerLabel) {
  const char = getCharacterById(characterId);
  return {
    characterId,
    name: char ? char.name : characterId,
    stats: char ? char.stats : { strength: 70, speed: 70, dodge: 70, endurance: 70, cardio: 70, accuracy: 70 },
    special: char ? char.special : null,
    playerLabel: playerLabel || "",
    x,
    facing, // 1 = direita, -1 = esquerda
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    state: "idle", // idle, move, punch, guard, dodge, dash, stun, fallen, taunt, special
    actionTimer: 0, // ms restantes de ações simples (dodge/taunt/stun)
    actionPhase: null, // startup/active/recover (apenas durante "punch")
    actionElapsed: 0,
    actionDuration: null,
    hasHitThisMove: false,
    currentMove: null,
    guard: false,
    dodgeIFrames: 0,
    comboCount: 0,
    noDamageStreak: 0,
    specialMeter: 0, // 0-100, enche levando/dando dano; ao cheio pode ativar especial
    specialActive: 0, // ms restantes de efeito especial ativo
    hypeStacks: 0, // Davo
    knockdown: null, // { countdownMs, mashProgress }
    score: 0,
    lastMoveUsed: null,
    readAdversaryBonus: 0, // Juan: bônus se oponente repetir o golpe
  };
}

function createMatchState(charA, charB, labelA, labelB) {
  return {
    fighters: [
      createFighter(charA, 220, 1, labelA),
      createFighter(charB, ARENA_WIDTH - 220, -1, labelB),
    ],
    round: 1,
    roundTimeMs: ROUND_MS,
    phase: "countdown", // countdown, fighting, roundEnd, matchEnd
    countdownMs: 3000,
    result: null, // { winnerIndex, method }
    log: [],
  };
}

function distanceBetween(f1, f2) { return Math.abs(f1.x - f2.x); }

// ~0.4 => um nocaute passa de ~7-12 para ~18-30 socos limpos sem defesa (ver scripts de simulação).
const HEALTH_DAMAGE_SCALE = 0.4;

function staminaFactor(fighter) {
  const pct = fighter.stamina / fighter.maxStamina;
  if (pct < 0.1) return 0.5;
  if (pct < 0.3) return 0.7;
  return 1;
}

function canAct(fighter) {
  return fighter.state !== "stun" && fighter.state !== "fallen" && fighter.state !== "punch" && fighter.state !== "dodge";
}

function startMove(fighter, moveKey) {
  const move = MOVES[moveKey];
  if (!move) return false;
  if (fighter.stamina < move.staminaCost * 0.4) return false; // fadiga extrema impede o golpe
  if (!canAct(fighter)) return false;
  const speedMul = 100 / Math.max(40, fighter.stats.speed);
  const durMul = fighter.specialActive > 0 && fighter.special?.id === "modo-destruicao" ? 0.85 : 1;
  fighter.guard = false; // quem solta o soco abre a guarda
  fighter.state = "punch";
  fighter.currentMove = moveKey;
  fighter.actionPhase = "startup";
  fighter.actionElapsed = 0;
  fighter.hasHitThisMove = false;
  fighter.actionDuration = {
    startup: move.startup * speedMul * durMul,
    active: move.active * speedMul * durMul,
    recover: move.recover * speedMul * durMul,
  };
  fighter.stamina = clamp(fighter.stamina - move.staminaCost, 0, fighter.maxStamina);
  fighter.lastMoveUsed = moveKey;
  return true;
}

function startGuard(fighter, on) {
  if (fighter.state === "fallen" || fighter.state === "stun") return;
  fighter.guard = !!on;
  if (on && fighter.state === "idle") fighter.state = "guard";
  if (!on && fighter.state === "guard") fighter.state = "idle";
}

function startDodge(fighter) {
  if (!canAct(fighter)) return false;
  if (fighter.stamina < 8) return false;
  fighter.state = "dodge";
  fighter.dodgeIFrames = 220;
  fighter.actionTimer = 260;
  fighter.stamina = clamp(fighter.stamina - 8, 0, fighter.maxStamina);
  return true;
}

function startTaunt(fighter) {
  if (!canAct(fighter)) return false;
  fighter.state = "taunt";
  fighter.actionTimer = 500;
  fighter.stamina = clamp(fighter.stamina + 4, 0, fighter.maxStamina); // risco/recompensa: provoca e recupera um pouco
  return true;
}

function tryActivateSpecial(fighter) {
  if (fighter.specialMeter < 100 || fighter.specialActive > 0) return false;
  fighter.specialMeter = 0;
  fighter.specialActive = 4000; // 4s de efeito, ajustável por personagem
  return true;
}

function applyDamage(attacker, defender, move, matchState) {
  let dmg = move.dmg * (0.5 + attacker.stats.strength / 100) * staminaFactor(attacker);
  const accFactor = 0.6 + attacker.stats.accuracy / 250; // acerta "melhor" com mais precisão
  dmg *= accFactor;

  // Combo Perfeito (Roro)
  if (attacker.special?.id === "combo-perfeito") {
    dmg *= 1 + Math.min(attacker.comboCount, 5) * 0.06;
  }
  // Modo Hype (Davo)
  if (attacker.special?.id === "modo-hype") {
    dmg *= 1 + Math.min(attacker.hypeStacks, 5) * 0.08;
  }
  // Modo Destruição (JH) ativo
  if (attacker.special?.id === "modo-destruicao" && attacker.specialActive > 0) {
    dmg *= 1.6;
  }
  // Leitura do Adversário (Juan): bônus se defensor repetiu o último golpe
  if (attacker.special?.id === "leitura-do-adversario" && defender.lastMoveUsed === attacker.readAdversaryBonus) {
    dmg *= 1.3;
  }

  // Defesa do defensor
  const defResist = 0.4 + defender.stats.endurance / 160;
  const isBlocking = defender.guard && (defender.state === "guard" || defender.state === "idle" || defender.state === "move");
  if (isBlocking) {
    // Soco DEFENDIDO não tira vida nenhuma. Só cansa um pouco quem segura a guarda
    // (mais no corpo), e não conta pontos nem combo para o atacante.
    const blockCost = move.region === "body" ? 3 : 1.5;
    defender.stamina = clamp(defender.stamina - blockCost, 0, defender.maxStamina);
    attacker.specialMeter = clamp(attacker.specialMeter + 1, 0, 100);
    attacker.comboCount = 0;
    matchState.log.push(`${defender.name} defendeu o golpe de ${attacker.name}`);
    return;
  } else {
    dmg *= 2 - defResist; // endurance alta reduz dano recebido
  }
  // AuronPlay: Sangue Frio reduz dano recebido levemente quando ativo
  if (defender.special?.id === "sangue-frio" && defender.specialActive > 0) dmg *= 0.8;

  dmg = Math.max(0.5, dmg);

  // Calibragem: só a perda de VIDA é escalonada, para a luta exigir bem mais socos até o nocaute.
  // Fôlego, medidor de especial e pontuação continuam usando o dano "cheio".
  defender.health = clamp(defender.health - dmg * HEALTH_DAMAGE_SCALE, 0, defender.maxHealth);
  if (move.region === "body") {
    defender.stamina = clamp(defender.stamina - dmg * 0.6, 0, defender.maxStamina);
  } else {
    defender.stamina = clamp(defender.stamina - dmg * 0.2, 0, defender.maxStamina);
  }

  attacker.specialMeter = clamp(attacker.specialMeter + dmg * 0.9, 0, 100);
  defender.specialMeter = clamp(defender.specialMeter + dmg * 0.5, 0, 100);
  attacker.comboCount += 1;
  attacker.score += dmg;
  defender.noDamageStreak = 0;

  if (attacker.special?.id === "modo-hype") attacker.hypeStacks = clamp(attacker.hypeStacks + 1, 0, 5);

  // Juan guarda qual golpe o oponente acabou de usar para tentar "ler" no próximo
  attacker.readAdversaryBonus = defender.lastMoveUsed;

  const stunChance = (move.stunChance || 0) * (1 + (1 - defResist));
  if (Math.random() < stunChance) {
    defender.state = "stun";
    defender.actionTimer = 700;
  }

  if (defender.health <= 0 && !defender.knockdown) {
    defender.state = "fallen";
    defender.knockdowns = (defender.knockdowns || 0) + 1;
    defender.knockdown = { countdownMs: KNOCKDOWN_COUNT_MS, mashProgress: 0, downMs: 0, lastMash: false };
    matchState.log.push(`${defender.name} caiu!`);
  }

  matchState.log.push(`${attacker.name} acertou ${move.region === "head" ? "a cabeça" : "o corpo"} de ${defender.name} (${dmg.toFixed(1)})`);
}

function resolveActiveHit(attacker, defender, matchState) {
  if (attacker.hasHitThisMove) return; // um golpe só resolve uma vez, mesmo que a fase "active" dure vários ticks
  const move = MOVES[attacker.currentMove];
  if (!move) return;
  attacker.hasHitThisMove = true;
  const dist = distanceBetween(attacker, defender);
  if (dist > move.range) return; // fora de alcance, erra
  if (defender.dodgeIFrames > 0) {
    matchState.log.push(`${defender.name} esquivou de ${attacker.name}!`);
    // La Cobra: Caçador — esquiva bem-sucedida abre janela de contra-ataque (buff temporário de dano)
    if (defender.special?.id === "cacador") {
      defender.specialMeter = clamp(defender.specialMeter + 15, 0, 100);
    }
    return;
  }
  applyDamage(attacker, defender, move, matchState);
}

function updateKnockdown(fighter, dtMs) {
  const kd = fighter.knockdown;
  if (!kd) return;
  kd.countdownMs -= dtMs;
  kd.downMs = (kd.downMs || 0) + dtMs;
  fighter.state = "fallen";
  if (kd.countdownMs <= 0) kd.ko = true; // fim da contagem: nocaute, fim de luta
}

function regenStamina(fighter, dtMs) {
  if (fighter.state === "fallen" || fighter.state === "stun") return;
  const base = 8 * (fighter.stats.cardio / 100) * (dtMs / 1000);
  let regen = base;
  if (fighter.special?.id === "sangue-frio" && fighter.specialActive > 0) regen *= 1.6;
  if (fighter.guard) regen *= 1.3; // parado na guarda recupera um pouco mais
  fighter.stamina = clamp(fighter.stamina + regen, 0, fighter.maxStamina);
}

function regenSpecialPassives(fighter, dtMs, oppHealthPct) {
  // Ibai: Último Sobrevivente — bônus quando vida baixa (passivo, não precisa do medidor)
  if (fighter.special?.id === "ultimo-sobrevivente" && fighter.health / fighter.maxHealth < 0.3) {
    fighter.specialActive = Math.max(fighter.specialActive, 1);
  }
  // Rivers: Espírito de Campeã — recuperação de vida/fôlego quando em desvantagem
  if (fighter.special?.id === "espirito-de-campea" && fighter.health / fighter.maxHealth < 0.35) {
    fighter.health = clamp(fighter.health + 0.5 * (dtMs / 1000), 0, fighter.maxHealth);
    fighter.stamina = clamp(fighter.stamina + 2 * (dtMs / 1000), 0, fighter.maxStamina);
  }
}

// Avança o estado de UM lutador (timers, decaimento), sem resolver interação com o oponente.
function tickFighterTimers(fighter, dtMs) {
  if (fighter.state === "punch" && fighter.actionDuration) {
    fighter.actionElapsed += dtMs;
    const { startup, active, recover } = fighter.actionDuration;
    const total = startup + active + recover;
    if (fighter.actionElapsed >= total) {
      fighter.state = "idle";
      fighter.currentMove = null;
      fighter.actionPhase = null;
      fighter.actionDuration = null;
      fighter.actionElapsed = 0;
    } else if (fighter.actionElapsed < startup) {
      fighter.actionPhase = "startup";
    } else if (fighter.actionElapsed < startup + active) {
      fighter.actionPhase = "active";
    } else {
      fighter.actionPhase = "recover";
    }
  } else if (fighter.actionTimer > 0) {
    fighter.actionTimer -= dtMs;
    if (fighter.actionTimer <= 0) {
      fighter.actionTimer = 0;
      if (fighter.state === "dodge" || fighter.state === "taunt" || fighter.state === "stun") {
        fighter.state = "idle";
      }
    }
  }
  if (fighter.dodgeIFrames > 0) fighter.dodgeIFrames = Math.max(0, fighter.dodgeIFrames - dtMs);
  if (fighter.specialActive > 0) fighter.specialActive = Math.max(0, fighter.specialActive - dtMs);
  if (fighter.comboCount > 0) {
    fighter.noDamageStreak += dtMs;
    if (fighter.noDamageStreak > 1500) fighter.comboCount = 0; // combo expira sem novos acertos
  }
  regenStamina(fighter, dtMs);
}

// input = { move: "left"|"right"|null, action: "jab"|"straight"|"hookLeft"|"hookRight"|"guard"|"guardOff"|"dodge"|"special"|"taunt"|"advance"|null, mash: bool }
function applyInput(fighter, opponent, input, dtMs) {
  if (fighter.state === "fallen" || fighter.state === "stun") return;

  if (input.action === "guard") startGuard(fighter, true);
  else if (input.action === "guardOff") startGuard(fighter, false);
  else if (input.action === "dodge") startDodge(fighter);
  else if (input.action === "taunt") startTaunt(fighter);
  else if (input.action === "special") tryActivateSpecial(fighter);
  else if (MOVES[input.action]) startMove(fighter, input.action);

  if (fighter.state === "idle" || fighter.state === "move" || fighter.state === "guard") {
    // piso de 55%: os lentos (Ibai) continuam mais lentos, mas não se arrastando
    let speed = MOVE_SPEED_BASE * (0.55 + 0.45 * fighter.stats.speed / 100) * staminaFactor(fighter);
    if (input.action === "advance") speed *= 1.8;
    const dt = dtMs / 1000;
    if (input.move === "left") {
      fighter.x = clamp(fighter.x - speed * dt, FIGHTER_HALF_WIDTH, ARENA_WIDTH - FIGHTER_HALF_WIDTH);
      if (fighter.state !== "guard") fighter.state = "move";
    } else if (input.move === "right") {
      fighter.x = clamp(fighter.x + speed * dt, FIGHTER_HALF_WIDTH, ARENA_WIDTH - FIGHTER_HALF_WIDTH);
      if (fighter.state !== "guard") fighter.state = "move";
    } else if (fighter.state === "move") {
      fighter.state = "idle";
    }
  }

  fighter.facing = fighter.x < opponent.x ? 1 : -1;
}

const MIN_SEPARATION = 56; // menor que o alcance de todos os golpes (70-90)
function separateFighters(fA, fB) {
  const d = fB.x - fA.x;
  if (Math.abs(d) >= MIN_SEPARATION) return;
  const dir = d === 0 ? (fA.facing || 1) : Math.sign(d); // de que lado B está
  const mid = (fA.x + fB.x) / 2;
  fA.x = clamp(mid - dir * MIN_SEPARATION / 2, FIGHTER_HALF_WIDTH, ARENA_WIDTH - FIGHTER_HALF_WIDTH);
  fB.x = clamp(mid + dir * MIN_SEPARATION / 2, FIGHTER_HALF_WIDTH, ARENA_WIDTH - FIGHTER_HALF_WIDTH);
  // encurralado na corda: empurra o outro
  if (Math.abs(fB.x - fA.x) < MIN_SEPARATION) {
    if (fA.x <= FIGHTER_HALF_WIDTH || fA.x >= ARENA_WIDTH - FIGHTER_HALF_WIDTH) fB.x = fA.x + dir * MIN_SEPARATION;
    else fA.x = fB.x - dir * MIN_SEPARATION;
  }
}

// Avança a partida um passo (chamado a ~20-60Hz no servidor, ou no loop local do cliente).
function stepMatch(matchState, inputA, inputB, dtMs) {
  const [fA, fB] = matchState.fighters;

  if (matchState.phase === "countdown") {
    matchState.countdownMs -= dtMs;
    if (matchState.countdownMs <= 0) matchState.phase = "fighting";
    return matchState;
  }
  if (matchState.phase !== "fighting") return matchState;

  if (fA.knockdown) updateKnockdown(fA, dtMs);
  if (fB.knockdown) updateKnockdown(fB, dtMs);

  if (!fA.knockdown) applyInput(fA, fB, inputA || {}, dtMs);
  if (!fB.knockdown) applyInput(fB, fA, inputB || {}, dtMs);

  // Corpo a corpo: os lutadores não atravessam um ao outro (antes dava pra passar por
  // dentro do rival e ficar fora do alcance dos socos dos dois lados).
  separateFighters(fA, fB);

  tickFighterTimers(fA, dtMs);
  tickFighterTimers(fB, dtMs);

  regenSpecialPassives(fA, dtMs, fB.health / fB.maxHealth);
  regenSpecialPassives(fB, dtMs, fA.health / fA.maxHealth);

  // Resolve golpes que estão na fase ativa nesse tick
  if (fA.state === "punch" && fA.actionPhase === "active" && !fA.knockdown) resolveActiveHit(fA, fB, matchState);
  if (fB.state === "punch" && fB.actionPhase === "active" && !fB.knockdown) resolveActiveHit(fB, fA, matchState);

  // Nocaute definitivo (não levantou dentro da contagem)
  if (fA.knockdown && fA.knockdown.ko) {
    matchState.phase = "matchEnd";
    matchState.result = { winnerIndex: 1, method: "Nocaute" };
    return matchState;
  }
  if (fB.knockdown && fB.knockdown.ko) {
    matchState.phase = "matchEnd";
    matchState.result = { winnerIndex: 0, method: "Nocaute" };
    return matchState;
  }

  // durante a contagem do nocaute o relógio do round para (o round não pode acabar no meio)
  if (fA.knockdown || fB.knockdown) return matchState;

  matchState.roundTimeMs -= dtMs;
  if (matchState.roundTimeMs <= 0) {
    if (matchState.round >= ROUNDS_TOTAL) {
      matchState.phase = "matchEnd";
      if (fA.score > fB.score + 3) matchState.result = { winnerIndex: 0, method: "Decisão" };
      else if (fB.score > fA.score + 3) matchState.result = { winnerIndex: 1, method: "Decisão" };
      else matchState.result = { winnerIndex: -1, method: "Empate" };
    } else {
      matchState.round += 1;
      matchState.roundTimeMs = ROUND_MS;
      matchState.phase = "countdown";
      matchState.countdownMs = 2000;
      fA.stamina = clamp(fA.stamina + 25, 0, fA.maxStamina);
      fB.stamina = clamp(fB.stamina + 25, 0, fB.maxStamina);
      fA.x = 220; fB.x = ARENA_WIDTH - 220;
      fA.knockdown = null; fB.knockdown = null;
    }
  }
  return matchState;
}

const api = {
  ARENA_WIDTH, FLOOR_Y, ROUND_MS, ROUNDS_TOTAL, MOVES, KNOCKDOWN_COUNT_MS,
  createMatchState, createFighter, stepMatch, applyInput,
  HEALTH_DAMAGE_SCALE, _applyDamage: applyDamage,
};

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.Engine = api;
