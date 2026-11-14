// Testes de lógica pura do motor de combate (sem rede). Executar: node tests/engine.test.js
const assert = require("assert");
const { createMatchState, stepMatch } = require("../shared/engine.js");

function run(name, fn) {
  try {
    fn();
    console.log(`OK   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}:`, e.message);
    process.exitCode = 1;
  }
}

run("countdown avança para fighting", () => {
  const ms = createMatchState("jh-de-la-cruz", "ibai", "P1", "P2");
  assert.strictEqual(ms.phase, "countdown");
  for (let i = 0; i < 70; i++) stepMatch(ms, {}, {}, 50); // 3.5s
  assert.strictEqual(ms.phase, "fighting");
});

run("jab de A causa dano em B quando no alcance e sem guarda", () => {
  const ms = createMatchState("davo", "roro", "P1", "P2");
  for (let i = 0; i < 70; i++) stepMatch(ms, {}, {}, 50);
  const [fA, fB] = ms.fighters;
  fA.x = fB.x - 50; // coloca dentro do alcance do jab
  const healthBefore = fB.health;
  for (let i = 0; i < 20; i++) stepMatch(ms, { action: "jab" }, {}, 50);
  assert.ok(fB.health < healthBefore, `esperava dano em B (antes=${healthBefore}, depois=${fB.health})`);
});

run("soco defendido não tira vida nenhuma", () => {
  const ms1 = createMatchState("davo", "roro", "P1", "P2");
  for (let i = 0; i < 70; i++) stepMatch(ms1, {}, {}, 50);
  ms1.fighters[0].x = ms1.fighters[1].x - 50;
  for (let i = 0; i < 20; i++) stepMatch(ms1, { action: "jab" }, {}, 50);
  const dmgNoGuard = 100 - ms1.fighters[1].health;

  const ms2 = createMatchState("davo", "roro", "P1", "P2");
  for (let i = 0; i < 70; i++) stepMatch(ms2, {}, {}, 50);
  ms2.fighters[0].x = ms2.fighters[1].x - 50;
  for (let i = 0; i < 20; i++) stepMatch(ms2, { action: "jab" }, { action: "guard" }, 50);
  const dmgWithGuard = 100 - ms2.fighters[1].health;

  assert.ok(dmgNoGuard > 0, `soco sem guarda deveria tirar vida (tirou ${dmgNoGuard})`);
  assert.strictEqual(dmgWithGuard, 0, `soco defendido não pode tirar vida (tirou ${dmgWithGuard})`);
  assert.ok(ms2.fighters[1].stamina < 100, 'segurar a guarda deveria cansar um pouco');
});

run("golpe fora de alcance não causa dano", () => {
  const ms = createMatchState("davo", "roro", "P1", "P2");
  for (let i = 0; i < 70; i++) stepMatch(ms, {}, {}, 50);
  const healthBefore = ms.fighters[1].health;
  for (let i = 0; i < 20; i++) stepMatch(ms, { action: "jab" }, {}, 50); // distância inicial é grande
  assert.strictEqual(ms.fighters[1].health, healthBefore);
});

run("stamina diminui ao socar e regenera parado", () => {
  const ms = createMatchState("davo", "roro", "P1", "P2");
  for (let i = 0; i < 70; i++) stepMatch(ms, {}, {}, 50);
  ms.fighters[0].x = ms.fighters[1].x - 50;
  const stamBefore = ms.fighters[0].stamina;
  for (let i = 0; i < 10; i++) stepMatch(ms, { action: "jab" }, {}, 50);
  assert.ok(ms.fighters[0].stamina < stamBefore, "stamina deveria cair ao socar");
  const stamAfterPunch = ms.fighters[0].stamina;
  for (let i = 0; i < 40; i++) stepMatch(ms, {}, {}, 50); // parado
  assert.ok(ms.fighters[0].stamina > stamAfterPunch, "stamina deveria regenerar parado");
});

run("knockdown ao zerar vida e nocaute se não levantar", () => {
  const ms = createMatchState("davo", "ibai", "P1", "P2");
  for (let i = 0; i < 70; i++) stepMatch(ms, {}, {}, 50);
  ms.fighters[0].x = ms.fighters[1].x - 50;
  ms.fighters[1].health = 1; // quase nocauteado
  let sawKnockdown = false;
  for (let i = 0; i < 20 && ms.phase === "fighting"; i++) {
    stepMatch(ms, { action: "straight" }, {}, 50);
    if (ms.fighters[1].knockdown) sawKnockdown = true;
  }
  assert.ok(sawKnockdown, "deveria entrar em estado de knockdown");
  // não levanta (sem mash) até estourar a contagem
  for (let i = 0; i < 230 && ms.phase === "fighting"; i++) stepMatch(ms, {}, {}, 50); // ~11.5s
  assert.strictEqual(ms.phase, "matchEnd");
  assert.strictEqual(ms.result.method, "Nocaute");
  assert.strictEqual(ms.result.winnerIndex, 0);
});

// ---- Recuperação por cliques ("LEVANTE-SE!") ----
const { registerRecoveryClick, recoveryClicksRequired, KNOCKDOWN_COUNT_MS } = require("../shared/engine.js");

function knockOut(ms, slot) {
  // derruba o lutador `slot` com socos de verdade (passa pelo applyDamage)
  const atk = ms.fighters[1 - slot], def = ms.fighters[slot];
  def.health = 0.01; def.guard = false; def.state = "idle";
  atk.x = slot === 1 ? def.x - 60 : def.x + 60;
  const inp = (a) => (slot === 1 ? [a, {}] : [{}, a]);
  for (let i = 0; i < 40 && !def.knockdown; i++) stepMatch(ms, ...inp({ action: "straight" }), 50);
  assert.ok(def.knockdown, "deveria cair");
}
// clica `n` vezes, 1 a cada `gap` ms de relógio, avançando a simulação junto
function clickFor(ms, slot, n, gap, clockRef) {
  for (let i = 0; i < n && ms.fighters[slot].knockdown && ms.phase === "fighting"; i++) {
    clockRef.t += gap;
    registerRecoveryClick(ms.fighters[slot], clockRef.t);
    stepMatch(ms, {}, {}, gap);
  }
}
function fightingMatch(a, b) {
  const ms = createMatchState(a, b, "P1", "P2");
  for (let i = 0; i < 70; i++) stepMatch(ms, {}, {}, 50);
  return ms;
}

run("1ª queda: clicando rápido levanta antes do 10 e a luta continua", () => {
  const ms = fightingMatch("davo", "rivers"); const clock = { t: 0 };
  knockOut(ms, 1);
  const kd = ms.fighters[1].knockdown;
  assert.ok(kd.required >= 8 && kd.required <= 17, `1ª queda pede ~12 cliques (pediu ${kd.required})`);
  clickFor(ms, 1, 60, 120, clock); // ~8 cliques/s
  stepMatch(ms, {}, {}, 50);
  assert.strictEqual(ms.phase, "fighting", "luta continua");
  assert.ok(!ms.fighters[1].knockdown, "levantou");
  assert.ok(ms.fighters[1].health > 0, "volta com vida");
  assert.ok(ms.fighters[1].justRecoveredMs > 0, "sinaliza VOCÊ CONSEGUIU LEVANTAR");
});

run("a contagem não pausa com os cliques e chegar no 10 = derrota por KO", () => {
  const ms = fightingMatch("davo", "rivers"); const clock = { t: 0 };
  knockOut(ms, 1);
  const before = ms.fighters[1].knockdown.countdownMs;
  clickFor(ms, 1, 5, 200, clock); // poucos cliques, devagar
  assert.ok(ms.fighters[1].knockdown.countdownMs < before - 900, "contagem seguiu correndo");
  for (let i = 0; i < 300 && ms.phase === "fighting"; i++) stepMatch(ms, {}, {}, 50);
  assert.strictEqual(ms.phase, "matchEnd");
  assert.strictEqual(ms.result.method, "Nocaute");
  assert.strictEqual(ms.result.winnerIndex, 0);
});

run("2ª e 3ª queda exigem cada vez mais cliques", () => {
  const ms = fightingMatch("davo", "rivers"); const clock = { t: 0 };
  const req = [];
  for (let fall = 1; fall <= 3; fall++) {
    knockOut(ms, 1);
    req.push(ms.fighters[1].knockdown.required);
    clickFor(ms, 1, 200, 70, clock); // ~14 cliques/s (jogador muito rápido)
    stepMatch(ms, {}, {}, 50);
    assert.ok(!ms.fighters[1].knockdown && ms.phase === "fighting", `levantou da queda ${fall}`);
    for (let i = 0; i < 25; i++) stepMatch(ms, {}, {}, 50); // termina a animação de levantar
  }
  assert.ok(req[0] < req[1] && req[1] < req[2], `dificuldade progressiva: ${req.join(" < ")}`);
  assert.strictEqual(ms.fighters[1].knockdowns, 3);
});

run("cliques duplicados/rápidos demais (auto-clicker) não contam", () => {
  const ms = fightingMatch("davo", "rivers");
  knockOut(ms, 1);
  const f = ms.fighters[1];
  let counted = 0;
  for (let i = 0; i < 1000; i++) if (registerRecoveryClick(f, 5000 + i)) counted++; // 1000 cliques em 1 segundo
  assert.ok(counted <= 17, `no máximo ~16 contam por segundo (contaram ${counted})`);
  assert.ok(!registerRecoveryClick(f, NaN), "relógio inválido é rejeitado");
});

run("atributos ajustam um pouco a dificuldade, sem tornar automático nem impossível", () => {
  const ibai = createMatchState("ibai", "roro", "a", "b").fighters[0];   // resistência 100
  const roro = createMatchState("roro", "ibai", "a", "b").fighters[0];   // resistência 60
  assert.ok(recoveryClicksRequired(ibai, 3) < recoveryClicksRequired(roro, 3), "mais resistência = um pouco mais fácil");
  const tired = createMatchState("roro", "ibai", "a", "b").fighters[0]; tired.stamina = 0; tired.damageTaken = 999;
  const r = recoveryClicksRequired(tired, 1);
  assert.ok(r > recoveryClicksRequired(roro, 1), "cansado precisa de mais cliques");
  assert.ok(r <= Math.round(12 * 1.4), "mas nunca impossível");
  assert.ok(recoveryClicksRequired(ibai, 1) >= 8, "nunca automático");
  const tenSec = KNOCKDOWN_COUNT_MS / 1000;
  assert.ok(recoveryClicksRequired(tired, 5) / tenSec < 8, "até a 5ª queda dá pra levantar com < 8 cliques/s");
});

run("ninguém bate em quem está no chão", () => {
  const ms = fightingMatch("davo", "rivers");
  knockOut(ms, 1);
  const h = ms.fighters[1].health;
  for (let i = 0; i < 20; i++) stepMatch(ms, { action: "jab" }, {}, 50);
  assert.strictEqual(ms.fighters[1].health, h);
});

run("round termina por decisão quando o tempo acaba sem nocaute", () => {
  const ms = createMatchState("jh-de-la-cruz", "ibai", "P1", "P2");
  ms.phase = "fighting";
  ms.round = 3;
  ms.roundTimeMs = 100;
  stepMatch(ms, {}, {}, 150);
  assert.strictEqual(ms.phase, "matchEnd");
  assert.ok(["Decisão", "Empate"].includes(ms.result.method));
});

if (process.exitCode) {
  console.error("\nAlgum teste falhou.");
} else {
  console.log("\nTodos os testes de motor passaram.");
}
