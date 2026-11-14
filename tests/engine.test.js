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

run("nocaute não levanta nem com toques e não passa para o próximo round", () => {
  const ms = createMatchState("davo", "rivers", "P1", "P2");
  for (let i = 0; i < 70; i++) stepMatch(ms, {}, {}, 50);
  ms.roundTimeMs = 300; // round quase acabando
  ms.fighters[0].x = ms.fighters[1].x - 50;
  ms.fighters[1].health = 0.01;
  for (let i = 0; i < 20 && !ms.fighters[1].knockdown; i++) stepMatch(ms, { action: "straight" }, {}, 50);
  assert.ok(ms.fighters[1].knockdown, "deveria cair");
  for (let i = 0; i < 200 && ms.phase === "fighting"; i++) stepMatch(ms, {}, { mash: i % 2 === 0, action: "jab" }, 50);
  assert.strictEqual(ms.round, 1, "não pode ir para o próximo round");
  assert.strictEqual(ms.phase, "matchEnd");
  assert.strictEqual(ms.result.method, "Nocaute");
  assert.strictEqual(ms.result.winnerIndex, 0);
});

run("lutadores não atravessam um ao outro", () => {
  const ms = createMatchState("roro", "ibai", "P1", "P2");
  for (let i = 0; i < 70; i++) stepMatch(ms, {}, {}, 50);
  for (let i = 0; i < 200; i++) stepMatch(ms, { move: "right" }, {}, 50);
  const [a, b] = ms.fighters;
  assert.ok(a.x < b.x, `A não pode passar para o outro lado de B (A=${a.x}, B=${b.x})`);
  assert.ok(b.x - a.x >= 55, "mantém distância mínima de corpo");
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
