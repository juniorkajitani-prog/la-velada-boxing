// Servidor multiplayer autoritativo para La Velada Boxing.
// Responsável por: salas privadas (código + link), presença, seleção de personagem,
// e o loop de combate (vida, stamina, acertos, knockdown, round, resultado) — o cliente
// apenas envia intenção de input e renderiza o estado recebido.
//
// Rodar: cd server && npm install && npm start
// Variáveis de ambiente: ver .env.example (PORT, ALLOWED_ORIGINS).

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const { CHARACTERS, getCharacter } = require("../shared/characters.js");
const { createMatchState, stepMatch } = require("../shared/engine.js");

// --- Servidor de arquivos estáticos (cliente) -------------------------------------------
// O próprio processo do servidor multiplayer também serve client/, shared/ e assets/.
// Isso permite publicar o jogo inteiro (página + WebSocket) com UM único deploy/URL —
// sem precisar de um segundo host estático nem editar client/config.js manualmente.
const PROJECT_ROOT = path.join(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  // A raiz do site ("/") serve o CONTEÚDO de client/index.html direto (200 — bom pra health
  // check do Render/Fly) com uma tag <base> injetada, em vez de redirecionar pra /client/.
  // Isso permite usar o domínio curto como link pra convidar ("https://seujogo.onrender.com/"
  // em vez de ".../client/index.html") e ainda assim os caminhos relativos do HTML
  // ("../shared/...", "../assets/...") resolverem certo, apontando pra /client/.
  if (urlPath === "/" || urlPath === "/index.html") {
    const indexPath = path.join(PROJECT_ROOT, "client", "index.html");
    if (fs.existsSync(indexPath)) {
      let html = fs.readFileSync(indexPath, "utf8");
      html = html.replace(/<head>/i, '<head>\n    <base href="/client/">');
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return true;
    }
  }
  const filePath = path.normalize(path.join(PROJECT_ROOT, urlPath));
  // nunca sai do diretório do projeto (evita path traversal tipo "/../../etc/passwd")
  if (!filePath.startsWith(PROJECT_ROOT)) {
    res.writeHead(403);
    res.end("forbidden");
    return true;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const PORT = parseInt(process.env.PORT || "8787", 10);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
const TICK_MS = 50; // 20Hz — autoritativo
const RECONNECT_WINDOW_MS = 25000;
const ROOM_IDLE_SWEEP_MS = 10 * 60 * 1000; // salas sem atividade há 10min são removidas
const MAX_MSGS_PER_SEC = 40;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem O/0/I/1 para evitar confusão

const rooms = new Map(); // code -> room

function genCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function makeRoom() {
  const code = genCode();
  const room = {
    code,
    sockets: [null, null],
    names: [null, null],
    connected: [false, false],
    characterIds: [null, null],
    ready: [false, false],
    lastInput: [{}, {}],
    matchState: null,
    tickHandle: null,
    disconnectTimers: [null, null],
    lastActivity: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* conexão pode ter caído no instante do envio */ }
  }
}

function broadcastPresence(room) {
  const players = [0, 1].map((i) =>
    room.names[i]
      ? { slot: i, name: room.names[i], connected: room.connected[i], characterId: room.characterIds[i], ready: room.ready[i] }
      : null
  );
  [0, 1].forEach((i) => send(room.sockets[i], { type: "presence", players }));
}

function cleanupRoomIfEmpty(room) {
  if (!room.connected[0] && !room.connected[1]) {
    if (room.tickHandle) clearInterval(room.tickHandle);
    rooms.delete(room.code);
  }
}

function startMatch(room) {
  const charA = room.characterIds[0];
  const charB = room.characterIds[1];
  if (!charA || !charB) return;
  room.matchState = createMatchState(charA, charB, room.names[0], room.names[1]);
  room.lastInput = [{}, {}];
  room.ready = [false, false];
  if (room.tickHandle) clearInterval(room.tickHandle);
  room.tickHandle = setInterval(() => tick(room), TICK_MS);
}

function tick(room) {
  if (!room.matchState) return;
  room.lastActivity = Date.now();
  stepMatch(room.matchState, room.lastInput[0] || {}, room.lastInput[1] || {}, TICK_MS);
  [0, 1].forEach((i) => send(room.sockets[i], { type: "state", state: room.matchState }));
  if (room.matchState.phase === "matchEnd") {
    clearInterval(room.tickHandle);
    room.tickHandle = null;
  }
}

function handleReadyOrRematch(room, slot) {
  const preMatch = !room.matchState || room.matchState.phase === "matchEnd";
  if (!preMatch) return;
  room.ready[slot] = true;
  broadcastPresence(room);
  if (room.ready[0] && room.ready[1] && room.characterIds[0] && room.characterIds[1]) {
    startMatch(room);
  }
}

// Servidor HTTP: serve o cliente estático (ver serveStatic acima) e também responde
// GET "/" com 200 (satisfaz o health check do Render/Fly/Railway) — o combate em si
// usa só o upgrade para WebSocket.
const httpServer = http.createServer((req, res) => {
  try {
    if (serveStatic(req, res)) return;
  } catch (e) {
    // qualquer erro inesperado servindo estático não deve derrubar o servidor de jogo
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found\n");
});
const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT);

wss.on("connection", (ws, req) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS[0] !== "*" && origin && !ALLOWED_ORIGINS.includes(origin)) {
    ws.close(4403, "origin not allowed");
    return;
  }

  ws._room = null;
  ws._slot = null;
  ws._msgTimes = [];

  ws.on("message", (raw) => {
    const now = Date.now();
    ws._msgTimes = ws._msgTimes.filter((t) => now - t < 1000);
    ws._msgTimes.push(now);
    if (ws._msgTimes.length > MAX_MSGS_PER_SEC) return; // descarta silenciosamente excesso

    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "createRoom": {
        const room = makeRoom();
        room.sockets[0] = ws;
        room.names[0] = String(msg.name || "Jogador 1").slice(0, 20);
        room.connected[0] = true;
        ws._room = room.code;
        ws._slot = 0;
        send(ws, { type: "roomCreated", code: room.code });
        broadcastPresence(room);
        break;
      }
      case "joinRoom": {
        const code = String(msg.code || "").toUpperCase();
        const room = rooms.get(code);
        if (!room) { send(ws, { type: "roomError", message: "Sala não encontrada." }); return; }
        let slot = null;
        if (!room.connected[0] && room.sockets[0] === null && room.names[0] === null) slot = 0;
        else if (!room.connected[1] && (room.sockets[1] === null)) slot = 1;
        else if (!room.connected[0]) slot = 0; // reconexão
        else { send(ws, { type: "roomError", message: "Sala cheia." }); return; }

        if (room.disconnectTimers[slot]) { clearTimeout(room.disconnectTimers[slot]); room.disconnectTimers[slot] = null; }
        room.sockets[slot] = ws;
        if (!room.names[slot]) room.names[slot] = String(msg.name || `Jogador ${slot + 1}`).slice(0, 20);
        room.connected[slot] = true;
        ws._room = room.code;
        ws._slot = slot;
        send(ws, { type: "roomJoined", code: room.code, slot });
        broadcastPresence(room);
        if (room.matchState) send(ws, { type: "state", state: room.matchState }); // reconexão em partida em andamento
        break;
      }
      case "selectCharacter": {
        const room = rooms.get(ws._room);
        if (!room || ws._slot === null) return;
        if (!getCharacter(msg.characterId)) return;
        const other = ws._slot === 0 ? 1 : 0;
        if (room.characterIds[other] === msg.characterId) return; // já escolhido pelo oponente
        room.characterIds[ws._slot] = msg.characterId;
        room.ready[ws._slot] = false;
        broadcastPresence(room);
        break;
      }
      case "ready":
      case "rematch": {
        const room = rooms.get(ws._room);
        if (!room || ws._slot === null) return;
        handleReadyOrRematch(room, ws._slot);
        break;
      }
      case "input": {
        const room = rooms.get(ws._room);
        if (!room || ws._slot === null) return;
        const inp = msg.input || {};
        // validação básica para impedir payloads maliciosos
        const safe = {};
        if (inp.move === "left" || inp.move === "right") safe.move = inp.move;
        const allowedActions = ["jab", "straight", "hookLeft", "hookRight", "guard", "guardOff", "dodge", "advance", "special", "taunt"];
        if (allowedActions.includes(inp.action)) safe.action = inp.action;
        safe.mash = !!inp.mash;
        room.lastInput[ws._slot] = safe;
        room.lastActivity = Date.now();
        break;
      }
      case "leave": {
        const room = rooms.get(ws._room);
        if (!room || ws._slot === null) return;
        const slot = ws._slot;
        room.connected[slot] = false;
        room.sockets[slot] = null;
        const otherSlot = slot === 0 ? 1 : 0;
        send(room.sockets[otherSlot], { type: "opponentLeft" });
        if (room.tickHandle) { clearInterval(room.tickHandle); room.tickHandle = null; }
        room.matchState = null;
        cleanupRoomIfEmpty(room);
        break;
      }
      default:
        break;
    }
  });

  ws.on("close", () => {
    const room = rooms.get(ws._room);
    if (!room || ws._slot === null) return;
    const slot = ws._slot;
    if (room.sockets[slot] !== ws) return; // já foi substituído por reconexão
    room.connected[slot] = false;
    room.sockets[slot] = null;
    broadcastPresence(room);
    room.disconnectTimers[slot] = setTimeout(() => {
      const otherSlot = slot === 0 ? 1 : 0;
      if (!room.connected[slot]) {
        send(room.sockets[otherSlot], { type: "opponentLeft" });
        if (room.tickHandle) { clearInterval(room.tickHandle); room.tickHandle = null; }
        room.matchState = null;
      }
      cleanupRoomIfEmpty(room);
    }, RECONNECT_WINDOW_MS);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.connected[0] && !room.connected[1] && now - room.lastActivity > ROOM_IDLE_SWEEP_MS) {
      if (room.tickHandle) clearInterval(room.tickHandle);
      rooms.delete(room.code);
    }
  }
}, 60 * 1000);

console.log(`[la-velada-boxing] servidor multiplayer WebSocket ouvindo na porta ${PORT}`);
console.log(`Personagens carregados: ${CHARACTERS.length}`);
