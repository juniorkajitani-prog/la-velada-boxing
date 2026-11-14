// Teste de integração real: sobe o servidor WebSocket e conecta DOIS clientes
// de verdade (ws), simulando os dois jogadores, para validar o fluxo ponta a ponta:
// criar sala -> entrar por código -> selecionar personagem -> pronto -> estado sincronizado -> dano -> fim.
// Executar: node tests/multiplayer.test.js

const { spawn } = require("child_process");
const WebSocket = require("ws");
const path = require("path");

const PORT = 8799;
let failed = false;
function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); failed = true; }
  else console.log("OK  :", msg);
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const serverProc = spawn("node", ["server.js"], {
    cwd: path.join(__dirname, "..", "server"),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  serverProc.stdout.on("data", (d) => (serverLog += d.toString()));
  serverProc.stderr.on("data", (d) => (serverLog += d.toString()));

  await wait(800); // tempo para o servidor subir

  const clientA = new WebSocket(`ws://localhost:${PORT}`);
  const clientB = new WebSocket(`ws://localhost:${PORT}`);
  const msgsA = [];
  const msgsB = [];
  clientA.on("message", (d) => msgsA.push(JSON.parse(d)));
  clientB.on("message", (d) => msgsB.push(JSON.parse(d)));

  await Promise.all([
    new Promise((r) => clientA.on("open", r)),
    new Promise((r) => clientB.on("open", r)),
  ]);

  // 1) Jogador A cria a sala
  clientA.send(JSON.stringify({ type: "createRoom", name: "Alice" }));
  await wait(200);
  const roomCreated = msgsA.find((m) => m.type === "roomCreated");
  assert(!!roomCreated, "jogador A recebeu roomCreated com um código");
  const code = roomCreated && roomCreated.code;
  assert(typeof code === "string" && code.length === 6, "código da sala tem 6 caracteres");

  // 2) Jogador B entra com o código
  clientB.send(JSON.stringify({ type: "joinRoom", code, name: "Bruno" }));
  await wait(200);
  const roomJoined = msgsB.find((m) => m.type === "roomJoined");
  assert(!!roomJoined && roomJoined.code === code, "jogador B entrou na mesma sala pelo código");
  assert(roomJoined && roomJoined.slot === 1, "jogador B ficou no slot 1 (A ficou no slot 0)");

  // 2b) terceiro jogador tentando entrar na mesma sala deve ser bloqueado
  const clientC = new WebSocket(`ws://localhost:${PORT}`);
  await new Promise((r) => clientC.on("open", r));
  const msgsC = [];
  clientC.on("message", (d) => msgsC.push(JSON.parse(d)));
  clientC.send(JSON.stringify({ type: "joinRoom", code, name: "Carlos" }));
  await wait(200);
  assert(msgsC.some((m) => m.type === "roomError"), "terceiro jogador é bloqueado como lutador (sala cheia)");
  clientC.close();

  // 3) Ambos selecionam personagens diferentes e ficam prontos
  clientA.send(JSON.stringify({ type: "selectCharacter", characterId: "davo" }));
  clientB.send(JSON.stringify({ type: "selectCharacter", characterId: "ibai" }));
  await wait(150);
  clientA.send(JSON.stringify({ type: "ready" }));
  clientB.send(JSON.stringify({ type: "ready" }));
  await wait(300);

  const stateMsgsA = msgsA.filter((m) => m.type === "state");
  assert(stateMsgsA.length > 0, "cliente A começou a receber snapshots de estado autoritativos do servidor");
  const firstState = stateMsgsA[0];
  assert(firstState.state.fighters[0].characterId === "davo", "estado inicial reflete o personagem escolhido por A");
  assert(firstState.state.fighters[1].characterId === "ibai", "estado inicial reflete o personagem escolhido por B");

  // 4) Espera a contagem (countdown ~3s) e entra em "fighting"
  await wait(3600);
  const laterStates = msgsA.filter((m) => m.type === "state");
  const fightingState = laterStates.reverse().find((m) => m.state.phase === "fighting" || m.state.phase === "matchEnd");
  assert(!!fightingState, "a partida avançou para a fase de combate após a contagem");

  // 5) A envia inputs de movimento e soco; B fica parado. Depois de alguns segundos,
  //    a vida de B deve ter sido alterada pelo cálculo autoritativo do servidor (ou o combate seguir normalmente).
  const healthBefore = fightingState.state.fighters[1].health;
  // primeiro anda até o adversário (socando parado não sai do lugar), depois soca
  for (let i = 0; i < 70; i++) {
    clientA.send(JSON.stringify({ type: "input", input: { move: "right" } }));
    await wait(50);
  }
  for (let i = 0; i < 40; i++) {
    clientA.send(JSON.stringify({ type: "input", input: { action: i % 2 ? "jab" : null } }));
    await wait(50);
  }
  const finalStates = msgsA.filter((m) => m.type === "state");
  const lastState = finalStates[finalStates.length - 1];
  assert(!!lastState, "cliente A continuou recebendo estados durante o combate");
  assert(lastState.state.fighters[1].health < healthBefore, "socos de A tiraram vida de B pelo servidor autoritativo");
  console.log(`    (vida de B: antes=${healthBefore.toFixed(1)}, depois=${lastState.state.fighters[1].health.toFixed(1)}, fase atual=${lastState.state.phase})`);

  // 6) Jogador B sai da sala -> A deve ser avisado
  clientB.send(JSON.stringify({ type: "leave" }));
  await wait(300);
  assert(msgsA.some((m) => m.type === "opponentLeft"), "jogador A é avisado quando o oponente sai da sala");

  clientA.close();
  clientB.close();
  serverProc.kill();

  console.log("\n--- log do servidor (trecho) ---");
  console.log(serverLog.split("\n").slice(0, 5).join("\n"));

  if (failed) {
    console.error("\nAlgum teste de integração multiplayer falhou.");
    process.exit(1);
  } else {
    console.log("\nTodos os testes de integração multiplayer (2 clientes reais via WebSocket) passaram.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
