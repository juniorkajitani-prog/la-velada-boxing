// Cliente WebSocket para o modo multiplayer. Protocolo simples em JSON — ver server/server.js.
const Net = (() => {
  let ws = null;
  let handlers = {};
  let myName = "Jogador";

  function serverUrl() {
    if (window.MP_SERVER_URL) return window.MP_SERVER_URL;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    // Dev local "dois processos" (python -m http.server 8080 servindo só o cliente +
    // node server/server.js na 8787): aponta pra porta separada do servidor multiplayer.
    const isLocalhost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (isLocalhost && (location.port === "8080" || location.port === "")) {
      return `${proto}//${location.hostname}:8787`;
    }
    // Deploy único (o próprio server.js também serve o cliente, ver server/server.js):
    // o WebSocket mora no MESMO host e porta da página — zero configuração.
    return `${proto}//${location.host}`;
  }

  function connect() {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(serverUrl());
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
      ws.onclose = () => emit("disconnected", {});
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        emit(msg.type, msg);
      };
    });
  }

  function emit(type, payload) {
    (handlers[type] || []).forEach((fn) => fn(payload));
  }
  function on(type, fn) {
    handlers[type] = handlers[type] || [];
    handlers[type].push(fn);
  }
  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  async function ensureConnected() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    await connect();
  }

  async function createRoom(name) {
    myName = name;
    await ensureConnected();
    send({ type: "createRoom", name });
  }
  async function joinRoom(code, name) {
    myName = name;
    await ensureConnected();
    send({ type: "joinRoom", code: code.toUpperCase(), name });
  }
  function selectCharacter(characterId) { send({ type: "selectCharacter", characterId }); }
  function ready() { send({ type: "ready" }); }
  function input(payload) { send({ type: "input", input: payload }); }
  function rematch() { send({ type: "rematch" }); }
  function leave() { send({ type: "leave" }); }

  return { on, createRoom, joinRoom, selectCharacter, ready, input, rematch, leave, serverUrl };
})();

if (typeof window !== "undefined") window.Net = Net;
