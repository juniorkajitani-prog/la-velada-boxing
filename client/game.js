// Orquestração de telas e dos três modos (multiplayer, treinamento, 2 jogadores locais).
(function () {
  const $ = (sel) => document.querySelector(sel);
  const screens = {};
  document.querySelectorAll(".screen").forEach((el) => (screens[el.id.replace("screen-", "")] = el));

  function show(id) {
    Object.values(screens).forEach((el) => el.classList.remove("active"));
    screens[id].classList.add("active");
    if (typeof updateOrientationHint === "function") updateOrientationHint();
  }

  const App = {
    mode: null,
    playerName: I18N.t("player") + Math.floor(Math.random() * 900 + 100),
    mySlot: null,
    roomCode: null,
    presence: [null, null],
    localStep: 0, // para local2p: 0 = escolhendo P1, 1 = escolhendo P2
    chosen: [null, null],
    difficulty: "medium",
    matchState: null,
    rafId: null,
    keys: new Set(),
    mouse: { left: false, right: false },
    // mobile.actionQueue: fila FIFO de ações disparadas por toque — cada toque em um botão
    // diferente entra na fila e é consumido um por tick de simulação, então dois toques
    // (quase) simultâneos em botões diferentes nunca se perdem um sobrescrevendo o outro.
    mobile: { move: 0, actionQueue: [], mash: false },
    net: false,
  };

  function myFighterIndex() {
    return App.mySlot === 1 ? 1 : 0; // multiplayer usa App.mySlot; treinamento/local o jogador é sempre o slot 0
  }
  App.myFighterIndex = myFighterIndex;

  // Sai do modo online (se estava) — usado ao voltar do multiplayer e ao abrir um modo offline
  function leaveOnline() {
    if (App.net) { try { Net.leave(); } catch (_) {} }
    App.net = false;
    App.mySlot = null;
    App.roomCode = null;
    App.presence = [null, null];
  }

  // ---------------- Navegação básica ----------------
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      stopFightLoop();
      const inMp = screens["mp-room"].classList.contains("active") || screens["mp-lobby"].classList.contains("active");
      if (inMp || (App.net && btn.getAttribute("data-nav") === "mode-select")) leaveOnline();
      show(btn.getAttribute("data-nav"));
    });
  });

  document.querySelectorAll(".mode-card").forEach((card) => {
    card.addEventListener("click", () => {
      App.mode = card.getAttribute("data-mode");
      if (App.mode !== "multiplayer") leaveOnline(); // treino/2 jogadores: 100% offline
      App.chosen = [null, null];
      App.localStep = 0;
      if (App.mode === "multiplayer") {
        $("#mp-status").textContent = "";
        show("mp-lobby");
      } else if (App.mode === "training") {
        openCharSelect(I18N.t("char.chooseTraining"), { showDifficulty: true });
      } else if (App.mode === "local2p") {
        openCharSelect(I18N.t("char.p1"), {});
      } else if (App.mode === "tournament") {
        alert(I18N.t("mode.tournament.soon"));
      }
    });
  });

  // ---------------- Multiplayer: lobby ----------------
  $("#btn-create-room").addEventListener("click", async () => {
    $("#mp-status").textContent = I18N.t("mp.connecting");
    try {
      await Net.createRoom(App.playerName);
    } catch (e) {
      $("#mp-status").textContent = I18N.t("mp.noServer");
    }
  });
  $("#btn-join-room").addEventListener("click", async () => {
    const code = $("#input-room-code").value.trim();
    if (!code) return;
    $("#mp-status").textContent = I18N.t("mp.connecting");
    try {
      await Net.joinRoom(code, App.playerName);
    } catch (e) {
      $("#mp-status").textContent = I18N.t("mp.noServer");
    }
  });

  Net.on("roomCreated", (msg) => {
    App.roomCode = msg.code;
    App.mySlot = 0;
    App.net = true;
    $("#room-code-display").textContent = App.roomCode;
    show("mp-room");
  });
  Net.on("roomJoined", (msg) => {
    App.roomCode = msg.code;
    App.mySlot = msg.slot;
    App.net = true;
    $("#room-code-display").textContent = App.roomCode;
    show("mp-room");
  });
  Net.on("roomError", (msg) => {
    $("#mp-status").textContent = ({ "Sala não encontrada.": I18N.t("mp.err.notFound"), "Sala cheia.": I18N.t("mp.err.full") })[msg.message] || msg.message || I18N.t("mp.joinError");
  });
  Net.on("opponentLeft", () => {
    stopFightLoop();
    alert(I18N.t("mp.opponentLeft"));
    show("mode-select");
  });
  Net.on("disconnected", () => {
    if (App.net) {
      stopFightLoop();
    }
  });

  $("#btn-copy-link").addEventListener("click", () => {
    const url = `${location.origin}${location.pathname}?room=${App.roomCode}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    $("#room-status").textContent = I18N.t("mp.linkCopied", { url });
  });

  Net.on("presence", (msg) => {
    App.presence = msg.players;
    msg.players.forEach((p, i) => {
      const slot = $("#presence-" + i);
      if (slot) slot.querySelector("span").textContent = p ? `${p.name}${p.ready ? " ✅" : ""}` : "—";
    });
    if (msg.players[0] && msg.players[1] && screens["mp-room"].classList.contains("active")) {
      $("#room-status").textContent = I18N.t("mp.both");
      openCharSelect(I18N.t("char.choose"), { multiplayer: true });
    }
    if (screens["char-select"].classList.contains("active")) refreshCharGridLocks();
  });

  // ---------------- Seleção de personagem ----------------
  function charDetailHtml(c) {
    const sp = I18N.special(c.special);
    return `<strong>${c.name}</strong>
      <div class="stat-row"><span>${I18N.t("stat.strength")}</span><span>${c.stats.strength}</span></div>
      <div class="stat-row"><span>${I18N.t("stat.speed")}</span><span>${c.stats.speed}</span></div>
      <div class="stat-row"><span>${I18N.t("stat.dodge")}</span><span>${c.stats.dodge}</span></div>
      <div class="stat-row"><span>${I18N.t("stat.endurance")}</span><span>${c.stats.endurance}</span></div>
      <div class="stat-row"><span>${I18N.t("stat.cardio")}</span><span>${c.stats.cardio}</span></div>
      <div class="stat-row"><span>${I18N.t("stat.accuracy")}</span><span>${c.stats.accuracy}</span></div>
      <div class="special-line">${sp.name}: ${sp.desc}</div>`;
  }

  let selectedCharId = null;

  function openCharSelect(title, opts) {
    $("#char-select-title").textContent = title;
    selectedCharId = null;
    $("#btn-confirm-char").disabled = true;
    $("#char-detail").innerHTML = "";
    const grid = $("#char-grid");
    grid.innerHTML = "";
    CHARACTERS.forEach((c) => {
      const card = document.createElement("div");
      card.className = "char-card";
      card.dataset.id = c.id;
      card.innerHTML = `<img src="../assets/characters/${c.id}/thumb.png" alt="${c.name}"/><div class="cname">${c.name}</div>`;
      card.addEventListener("click", () => onCharClick(c, opts));
      grid.appendChild(card);
    });
    if (openCharSelect._diffDiv) { openCharSelect._diffDiv.remove(); openCharSelect._diffDiv = null; }
    if (opts.showDifficulty) {
      if (!["easy", "medium", "hard"].includes(App.difficulty)) App.difficulty = "medium";
      const diffDiv = document.createElement("div");
      diffDiv.innerHTML = `<div style="margin-top:8px">${I18N.t("diff.label")}
        <button class="btn diff-btn" data-d="easy">${I18N.t("diff.easy")}</button>
        <button class="btn diff-btn" data-d="medium">${I18N.t("diff.medium")}</button>
        <button class="btn diff-btn" data-d="hard">${I18N.t("diff.hard")}</button></div>`;
      $("#char-detail").after(diffDiv);
      diffDiv.querySelectorAll(".diff-btn").forEach((b) =>
        b.addEventListener("click", () => {
          App.difficulty = b.dataset.d;
          diffDiv.querySelectorAll(".diff-btn").forEach((x) => (x.style.outline = ""));
          b.style.outline = "2px solid #ffcc00";
          updateConfirmEnabled(opts);
        })
      );
      openCharSelect._diffDiv = diffDiv;
      const cur = diffDiv.querySelector(`.diff-btn[data-d="${App.difficulty}"]`);
      if (cur) cur.style.outline = "2px solid #ffcc00";
    }
    show("char-select");
    refreshCharGridLocks();
  }

  function refreshCharGridLocks() {
    if (!App.net) return;
    const oppIndex = App.mySlot === 0 ? 1 : 0;
    const opp = App.presence[oppIndex];
    document.querySelectorAll(".char-card").forEach((card) => {
      card.classList.toggle("taken-opp", !!(opp && opp.characterId === card.dataset.id));
    });
  }

  function updateConfirmEnabled(opts) {
    const okChar = !!selectedCharId;
    const okDiff = !opts.showDifficulty || !!App.difficulty;
    $("#btn-confirm-char").disabled = !(okChar && okDiff);
  }

  function onCharClick(c, opts) {
    if (App.net) {
      const oppIndex = App.mySlot === 0 ? 1 : 0;
      const opp = App.presence[oppIndex];
      if (opp && opp.characterId === c.id) return; // já escolhido pelo oponente
    }
    selectedCharId = c.id;
    document.querySelectorAll(".char-card").forEach((card) => card.classList.toggle("selected", card.dataset.id === c.id));
    $("#char-detail").innerHTML = charDetailHtml(c);
    updateConfirmEnabled(opts);
    if (App.net) Net.selectCharacter(c.id);
  }

  $("#btn-confirm-char").addEventListener("click", () => {
    if (!selectedCharId) return;
    if (App.net) {
      Net.ready();
      $("#char-select-title").textContent = I18N.t("mp.waitConfirm");
      $("#btn-confirm-char").disabled = true;
      return;
    }
    if (App.mode === "training") {
      const pool = CHARACTERS.filter((c) => c.id !== selectedCharId);
      const oppChar = pool[Math.floor(Math.random() * pool.length)].id;
      startLocalMatch(selectedCharId, oppChar, I18N.t("you"), I18N.t("ai") + " (" + I18N.t("diff." + App.difficulty) + ")", { aiSlot: 1 });
    } else if (App.mode === "local2p") {
      App.chosen[App.localStep] = selectedCharId;
      if (App.localStep === 0) {
        App.localStep = 1;
        openCharSelect(I18N.t("char.p2"), { excludeFirst: App.chosen[0] });
      } else {
        startLocalMatch(App.chosen[0], App.chosen[1], I18N.t("player1"), I18N.t("player2"), {});
      }
    }
  });

  // ---------------- VS / contagem ----------------
  function showVsScreen(nameA, idA, nameB, idB) {
    $("#vs-fighter-0").style.backgroundImage = `url(../assets/characters/${idA}/thumb.png)`;
    $("#vs-fighter-1").style.backgroundImage = `url(../assets/characters/${idB}/thumb.png)`;
    show("vs");
    let n = 3;
    $("#vs-countdown").textContent = n;
    const iv = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(iv);
        show("fight");
      } else {
        $("#vs-countdown").textContent = n;
      }
    }, 700);
  }

  // ---------------- Modos locais (treinamento / 2P) ----------------
  let aiController = null;
  let localMode = null; // "training" | "local2p"

  function startLocalMatch(charA, charB, labelA, labelB, { aiSlot } = {}) {
    resetRecoverUI();
    App.matchState = Engine.createMatchState(charA, charB, labelA, labelB);
    audioPrevSnap = null;
    localMode = App.mode;
    aiController = aiSlot === 1 ? AI.makeController(App.difficulty) : aiSlot === 0 ? AI.makeController(App.difficulty) : null;
    $("#hud-name-0").textContent = labelA + " — " + App.matchState.fighters[0].name;
    $("#hud-name-1").textContent = labelB + " — " + App.matchState.fighters[1].name;
    showVsScreen(labelA, charA, labelB, charB);
    startFightLoop();
  }

  // ---------------- Input: teclado / mouse / touch ----------------
  window.addEventListener("keydown", (e) => App.keys.add(e.key.toLowerCase()));
  window.addEventListener("keyup", (e) => App.keys.delete(e.key.toLowerCase()));
  const canvas = $("#fight-canvas");
  const ctx2d = canvas.getContext("2d");
  const render3dReady = true; // mantido como nome pra não mexer em mais lugares; renderer agora é o canvas 2D (render.js)
  function draw2d(matchState, ts) {
    Render.drawMatch(ctx2d, matchState, canvas.width, canvas.height, ts);
  }
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) App.mouse.left = true;
    if (e.button === 2) App.mouse.right = true;
  });
  canvas.addEventListener("mouseup", (e) => {
    if (e.button === 0) App.mouse.left = false;
    if (e.button === 2) App.mouse.right = false;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // Esquema de teclado do Jogador 1 (PC): WASD move/avança, J/K/L golpes, Espaço esquiva,
  // Shift defesa, E especial. F/R/Q e o mouse continuam funcionando como atalhos legados
  // (aliases) para não quebrar quem já tinha decorado o esquema anterior.
  function singlePlayerInput() {
    const k = App.keys;
    const input = {};
    if (k.has("a")) input.move = "left";
    else if (k.has("d")) input.move = "right";
    if (k.has("w")) input.action = "advance";
    const guardKeyDown = k.has("shift") || k.has("f");
    if (guardKeyDown) input.action = "guard";
    else if (App._wasGuarding) input.action = "guardOff";
    App._wasGuarding = guardKeyDown;
    if (k.has(" ")) input.action = "dodge";
    if (App.mouse.left) input.action = "jab";
    if (App.mouse.right) input.action = "straight";
    if (k.has("j")) input.action = "jab";
    if (k.has("k")) input.action = "straight";
    if (k.has("q")) input.action = "hookLeft";
    if (k.has("l")) input.action = "hookRight";
    if (k.has("e") || k.has("r")) input.action = "special";
    if (k.has("t")) input.action = "taunt";
    const queued = App.mobile.actionQueue.shift();
    if (queued) input.action = queued;
    if (App.mobile.move) input.move = App.mobile.move > 0 ? "right" : "left";
    return input;
  }

  function player2LocalInput() {
    const k = App.keys;
    const input = {};
    if (k.has("arrowleft")) input.move = "left";
    else if (k.has("arrowright")) input.move = "right";
    if (k.has("arrowdown")) input.action = "guard";
    else if (App._wasGuarding2) input.action = "guardOff";
    App._wasGuarding2 = k.has("arrowdown");
    if (k.has("arrowup")) input.action = "dodge";
    if (k.has("j")) input.action = "jab";
    if (k.has("k")) input.action = "straight";
    if (k.has("n")) input.action = "hookLeft";
    if (k.has("m")) input.action = "hookRight";
    if (k.has("o")) input.action = "special";
    if (k.has("p")) input.action = "taunt";
    return input;
  }

  // Controles de toque (mobile). Cada botão é rastreado pelo próprio touch "identifier"
  // (App.mobile.activeTouches), então vários dedos em botões diferentes — ou no joystick
  // e em um botão ao mesmo tempo — funcionam de forma independente: isso é o que faz
  // "avançar + jab", "recuar + defesa" etc. funcionarem de verdade com multitoque real,
  // em vez de um único dedo "roubar" o estado dos outros.
  const activeBtnTouches = new Map(); // touchId -> botão
  function pressBtn(btn) {
    btn.classList.add("mc-pressed");
    if (btn.classList.contains("mc-disabled")) return; // golpe indisponível (sem stamina/em recuperação)
    const action = btn.dataset.action;
    App.mobile.actionQueue.push(action);
    if (action === "jab" || action === "guard") App.mobile.mash = true;
  }
  function releaseBtn(btn) {
    btn.classList.remove("mc-pressed");
    if (btn.dataset.action === "guard") {
      // defesa é "segurar", não "toque único": solta a guarda quando o dedo sai do botão.
      App.mobile.actionQueue.push("guardOff");
    }
    if (btn.dataset.action === "jab" || btn.dataset.action === "guard") {
      const stillPressed = [...activeBtnTouches.values()].some(
        (b) => b !== btn && (b.dataset.action === "jab" || b.dataset.action === "guard")
      );
      if (!stillPressed) App.mobile.mash = false;
    }
  }
  document.querySelectorAll(".mc-btn").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      activeBtnTouches.set(e.pointerId, btn);
      pressBtn(btn);
    });
    const onEnd = (e) => {
      if (activeBtnTouches.get(e.pointerId) !== btn) return;
      activeBtnTouches.delete(e.pointerId);
      releaseBtn(btn);
    };
    btn.addEventListener("pointerup", onEnd);
    btn.addEventListener("pointercancel", onEnd);
    btn.addEventListener("lostpointercapture", onEnd);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  // Setas de movimento (segurar = andar). Pointer events cobrem toque e mouse;
  // cada dedo é rastreado separadamente, então dá pra andar e socar ao mesmo tempo.
  const movePointers = new Map(); // pointerId -> direção (-1 / 1)
  function refreshMove() {
    const dirs = [...movePointers.values()];
    App.mobile.move = dirs.length ? dirs[dirs.length - 1] * 100 : 0;
  }
  document.querySelectorAll(".mc-move").forEach((btn) => {
    const dir = Number(btn.dataset.move);
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      movePointers.set(e.pointerId, dir);
      btn.classList.add("mc-pressed");
      refreshMove();
    });
    const end = (e) => {
      if (!movePointers.has(e.pointerId)) return;
      movePointers.delete(e.pointerId);
      if (![...movePointers.values()].includes(dir)) btn.classList.remove("mc-pressed");
      refreshMove();
    };
    btn.addEventListener("pointerup", end);
    btn.addEventListener("pointercancel", end);
    btn.addEventListener("lostpointercapture", end);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  // Botões na tela ficam sempre visíveis (celular E computador); teclado/mouse continuam funcionando.
  $("#mobile-controls").classList.remove("hidden");
  document.body.classList.add("touch-device");

  // Avisa pra girar o celular quando o jogo está em pé (retrato) — o boxe lateral precisa
  // de largura pra mostrar os dois lutadores e os controles não cobrirem o ringue.
  function updateOrientationHint() {
    const portrait = window.innerHeight > window.innerWidth;
    document.body.classList.toggle("needs-rotate", isTouchDevice && portrait && screens.fight.classList.contains("active"));
  }
  window.addEventListener("resize", updateOrientationHint);
  window.addEventListener("orientationchange", updateOrientationHint);

  // Atualiza o estado visual (ativo/indisponível) dos botões de golpe conforme stamina,
  // "estar ocupado" (já no meio de outra ação) e o medidor de especial — pedido explícito:
  // "indicação visual quando o golpe não puder ser utilizado" + "estado de recarga".
  const MOVE_STAMINA_COST = { jab: 6, straight: 10, hookLeft: 12, hookRight: 12 };
  function updateMobileButtonStates() {
    if (!App.matchState) return;
    const f = App.matchState.fighters[App.myFighterIndex()];
    if (!f) return;
    const busy = f.state === "punch" || f.state === "dodge" || f.state === "stun" || f.state === "fallen";
    document.querySelectorAll(".mc-btn").forEach((btn) => {
      const action = btn.dataset.action;
      let disabled = busy && action !== "guard";
      const cost = MOVE_STAMINA_COST[action];
      if (cost && f.stamina < cost) disabled = true;
      if (action === "special") disabled = disabled || f.specialMeter < 100;
      btn.classList.toggle("mc-disabled", !!disabled);
      if (action === "special") {
        btn.style.setProperty("--mc-charge", Math.max(0, Math.min(100, f.specialMeter)) + "%");
      }
    });
  }
  App.updateMobileButtonStates = updateMobileButtonStates;

  // ---------------- Loop de luta (local) ----------------
  let lastTs = 0;
  function startFightLoop() {
    lastTs = performance.now();
    App.rafId = requestAnimationFrame(fightTick);
  }
  function stopFightLoop() {
    if (App.rafId) cancelAnimationFrame(App.rafId);
    App.rafId = null;
    GameAudio.stopCrowd();
  }

  // Passo fixo com acumulador: desacopla a simulação da taxa de quadros. Se um frame
  // demorar mais que o normal (dispositivo fraco, aba perdeu foco um instante), o jogo
  // roda vários passos de simulação de uma vez no próximo frame em vez de "perder" aquele
  // tempo — o relógio da luta sempre acompanha o relógio real; só a tela é que pode
  // atualizar mais devagar num hardware fraco.
  let simAccumulator = 0;
  const SIM_STEP_MS = 16;
  const MAX_STEPS_PER_FRAME = 30; // ~480ms de simulação por frame no máximo, evita travar a aba de vez

  function fightTick(ts) {
    let frameDt = ts - lastTs;
    lastTs = ts;
    frameDt = Math.min(frameDt, 1000); // proteção contra salto gigante (aba minimizada por minutos)
    simAccumulator += frameDt;

    if (App.paused) simAccumulator = 0; // pausado: o tempo não anda
    if (!App.net && App.matchState && !App.paused && localMode === "training") aiRecoverTick(ts);
    if (!App.net && App.matchState && !App.paused) {
      let steps = 0;
      while (simAccumulator >= SIM_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
        let inputA, inputB;
        const fA = App.matchState.fighters[0], fB = App.matchState.fighters[1];
        if (localMode === "training") {
          inputA = singlePlayerInput();
          inputA.mash = App.mouse.left || App.keys.has(" ") || App.keys.has("j") || App.mobile.mash;
          inputB = Object.assign({}, aiController.decide(fB, fA, ts));
        } else {
          inputA = singlePlayerInputLocal2pP1();
          inputA.mash = App.keys.has("1");
          inputB = player2LocalInput();
          inputB.mash = App.keys.has("j");
        }
        Engine.stepMatch(App.matchState, inputA, inputB, SIM_STEP_MS);
        simAccumulator -= SIM_STEP_MS;
        steps++;
      }
      if (steps >= MAX_STEPS_PER_FRAME) simAccumulator = 0; // estouro extremo: descarta o resto em vez de travar
    }

    if (App.matchState) {
      processAudioEvents(App.matchState);
      if (render3dReady) draw2d(App.matchState, ts);
      updateHud(App.matchState);
      if (App.matchState.phase === "matchEnd") {
        stopFightLoop();
        showPostfightAfterKo(App.matchState);
        return;
      }
    }
    App.rafId = requestAnimationFrame(fightTick);
  }

  // IA caída "clica" para levantar: fácil ~2,2/s, médio ~3,2/s, difícil ~4,2/s.
  // Assim a IA costuma levantar das primeiras quedas e vai ficando no chão nas seguintes.
  let aiNextClickAt = 0, aiWasDown = false;
  function aiRecoverTick(ts) {
    const f = App.matchState.fighters[1];
    if (!f.knockdown || f.knockdown.ko) { aiWasDown = false; return; }
    const rate = { easy: 2.2, medium: 3.2, hard: 4.2 }[App.difficulty] || 3;
    if (!aiWasDown) { aiWasDown = true; aiNextClickAt = ts + 700; } // tempo de reação
    if (ts >= aiNextClickAt) {
      Engine.registerRecoveryClick(f, ts);
      aiNextClickAt = ts + (1000 / rate) * (0.75 + Math.random() * 0.5);
    }
  }

  // Para local2p, P1 usa um esquema só de teclado (sem mouse) para não conflitar com P2 no mesmo dispositivo.
  function singlePlayerInputLocal2pP1() {
    const k = App.keys;
    const input = {};
    if (k.has("a")) input.move = "left";
    else if (k.has("d")) input.move = "right";
    if (k.has("s")) input.action = "guard";
    else if (App._wasGuardingL2) input.action = "guardOff";
    App._wasGuardingL2 = k.has("s");
    if (k.has("w")) input.action = "dodge";
    if (k.has("1")) input.action = "jab";
    if (k.has("2")) input.action = "straight";
    if (k.has("3")) input.action = "hookLeft";
    if (k.has("4")) input.action = "hookRight";
    if (k.has("5")) input.action = "special";
    if (k.has("6")) input.action = "taunt";
    return input;
  }

  // ---------------- Multiplayer: envio de input + recepção de estado ----------------
  let lastSend = 0;
  function sendMpInputLoop(ts) {
    if (App.mpStopped) return;
    if (!App.net || !screens.fight.classList.contains("active")) {
      App.rafId = requestAnimationFrame(sendMpInputLoop);
      return;
    }
    if (ts - lastSend > 45) {
      lastSend = ts;
      const input = singlePlayerInput();
      input.mash = App.mouse.left || App.keys.has(" ") || App.keys.has("j") || App.mobile.mash;
      Net.input(input);
    }
    App.rafId = requestAnimationFrame(sendMpInputLoop);
  }

  Net.on("state", (msg) => {
    App.matchState = msg.state;
    if (msg.state.phase === "countdown" && msg.state.round === 1 && !App._shownVs) {
      App._shownVs = true;
      audioPrevSnap = null;
      resetRecoverUI();
      const f0 = msg.state.fighters[0], f1 = msg.state.fighters[1];
      $("#hud-name-0").textContent = f0.playerLabel + " — " + f0.name;
      $("#hud-name-1").textContent = f1.playerLabel + " — " + f1.name;
      showVsScreen(f0.playerLabel, f0.characterId, f1.playerLabel, f1.characterId);
      if (!App.rafId) {
        App.mpStopped = false;
        lastTs = performance.now();
        App.rafId = requestAnimationFrame(mpRenderTick);
        requestAnimationFrame(sendMpInputLoop);
      }
    }
    if (msg.state.phase === "matchEnd" && !App._endShown) {
      App._endShown = true;
      updateHud(msg.state);
      showPostfightAfterKo(msg.state);
    }
    if (msg.state.phase !== "matchEnd") App._endShown = false;
  });

  function mpRenderTick(ts) {
    if (App.mpStopped) return;
    if (App.matchState) {
      processAudioEvents(App.matchState);
      if (render3dReady) draw2d(App.matchState, ts);
      updateHud(App.matchState);
    }
    if (App.matchState && App.matchState.phase === "matchEnd") return;
    requestAnimationFrame(mpRenderTick);
  }

  // ---------------- HUD ----------------
  function updateHud(ms) {
    const [fA, fB] = ms.fighters;
    $("#health-0").style.width = Math.max(0, (fA.health / fA.maxHealth) * 100) + "%";
    $("#health-1").style.width = Math.max(0, (fB.health / fB.maxHealth) * 100) + "%";
    $("#stamina-0").style.width = Math.max(0, fA.stamina) + "%";
    $("#stamina-1").style.width = Math.max(0, fB.stamina) + "%";
    $("#special-0").style.width = Math.max(0, fA.specialMeter) + "%";
    $("#special-1").style.width = Math.max(0, fB.specialMeter) + "%";
    $("#round-label").textContent = "ROUND " + ms.round;
    $("#round-timer").textContent = Math.max(0, Math.ceil(ms.roundTimeMs / 1000));
    const kd = fA.knockdown || fB.knockdown;
    $("#knockdown-banner").classList.add("hidden");
    updateKnockdownCount(kd);
    updateRecoverUI(ms);
    updateMobileButtonStates();
    const p0 = $("#portrait-0"), p1 = $("#portrait-1");
    const want0 = `../assets/characters/${fA.characterId}/thumb.png`;
    const want1 = `../assets/characters/${fB.characterId}/thumb.png`;
    if (p0.getAttribute("src") !== want0) p0.src = want0;
    if (p1.getAttribute("src") !== want1) p1.src = want1;
  }

  // Contagem visual do juiz (1 a 10) sincronizada com o knockdown.countdownMs real do motor
  // (shared/engine.js) — autoritativo também no multiplayer, já que vem do matchState.
  let lastKdCount = 0;
  function updateKnockdownCount(kd) {
    const countEl = $("#knockdown-count");
    const textEl = $("#knockdown-text");
    if (!kd) { lastKdCount = 0; return; }
    if (kd.ko) {
      if (lastKdCount !== "ko") {
        countEl.textContent = I18N.t("kd.ko");
        countEl.classList.add("ko-text", "pulse");
        textEl.textContent = I18N.t("kd.koText");
        GameAudio.play("knockdown", 1);
        lastKdCount = "ko";
      }
      return;
    }
    const elapsed = Engine.KNOCKDOWN_COUNT_MS - kd.countdownMs;
    const count = Math.min(10, Math.max(1, Math.floor(elapsed / (Engine.KNOCKDOWN_COUNT_MS / 10)) + 1));
    if (count !== lastKdCount) {
      if (lastKdCount === 0 || lastKdCount === "ko") textEl.textContent = I18N.t("kd.count");
      countEl.textContent = String(count);
      countEl.classList.remove("ko-text");
      countEl.classList.remove("pulse");
      void countEl.offsetWidth; // força reflow pra reiniciar a animação a cada número
      countEl.classList.add("pulse");
      GameAudio.play("countdownBeep", 0.8);
      lastKdCount = count;
    }
  }

  // ---------------- Recuperação por cliques: "LEVANTE-SE!" ----------------
  // Quem decide se levantou é o motor (local) ou o servidor (online). Aqui só mostramos o
  // estado oficial (knockdown.clicks / required / countdownMs) e enviamos os cliques.
  function humanSlots() {
    if (App.net) return [App.myFighterIndex()];
    if (localMode === "training") return [0];
    return [0, 1]; // 2 jogadores no mesmo aparelho
  }
  function downSlot(ms) {
    if (!ms) return -1;
    return ms.fighters[0].knockdown ? 0 : ms.fighters[1].knockdown ? 1 : -1;
  }
  let recPrevDown = -1, recLastCount = 0, recLastLocalTap = 0, recToastUntil = 0, recKoShown = false;
  function showRecoverToast(text, ko) {
    const t = $("#recover-toast");
    const wasHidden = t.classList.contains("hidden");
    if (!wasHidden && t.textContent === text) return; // já está na tela: não reinicia a animação
    t.textContent = text;
    t.classList.toggle("ko", !!ko);
    t.classList.remove("hidden");
    t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  }
  function updateRecoverUI(ms) {
    const ov = $("#recover-overlay");
    const slot = downSlot(ms);
    // levantou agora há pouco → "VOCÊ CONSEGUIU LEVANTAR!"
    const upSlot = ms.fighters.findIndex((f) => f.justRecoveredMs > 0);
    if (upSlot >= 0) {
      if (recPrevDown === upSlot) GameAudio.play("getUp", 0.9);
      const mine = humanSlots().includes(upSlot) && (App.net || localMode === "training");
      showRecoverToast(mine ? I18N.t("rec.youUp") : I18N.t("rec.otherUp", { name: ms.fighters[upSlot].name }));
      recToastUntil = performance.now() + 200;
    } else if (!recKoShown && performance.now() > recToastUntil) {
      $("#recover-toast").classList.add("hidden");
    }
    recPrevDown = slot;
    if (slot < 0) { ov.classList.add("hidden"); document.body.classList.remove("rec-active"); recLastCount = 0; return; }

    const f = ms.fighters[slot];
    const kd = f.knockdown;
    const watching = !humanSlots().includes(slot);
    ov.classList.remove("hidden");
    ov.classList.toggle("watching", watching);
    document.body.classList.toggle("rec-active", !watching); // esconde os botões de luta enquanto tenta levantar
    const pct = Math.max(0, Math.min(100, Math.round((kd.clicks / kd.required) * 100)));
    $("#rec-fill").style.width = pct + "%";
    $("#rec-pct").textContent = pct + "%";
    $("#rec-clicks").textContent = I18N.t("rec.clicks", { n: kd.clicks, total: kd.required, fall: kd.fall || 1 });
    if (watching) {
      $("#rec-title").textContent = I18N.t("rec.watchTitle", { name: f.name.toUpperCase() });
      $("#rec-msg").textContent = I18N.t("rec.watchMsg");
    } else {
      $("#rec-title").textContent = I18N.t("rec.title");
      $("#rec-msg").textContent = I18N.t("rec.msg");
    }
    const elapsed = Engine.KNOCKDOWN_COUNT_MS - kd.countdownMs;
    const count = Math.min(10, Math.max(1, Math.floor(elapsed / (Engine.KNOCKDOWN_COUNT_MS / 10)) + 1));
    if (count !== recLastCount) {
      $("#rec-count").textContent = count;
      const badge = document.querySelector(".rec-count-badge");
      badge.classList.remove("tick"); void badge.offsetWidth; badge.classList.add("tick");
      recLastCount = count;
    }
    if (kd.ko) {
      $("#rec-title").textContent = I18N.t("rec.ko");
      $("#rec-btn").style.visibility = "hidden";
    } else {
      $("#rec-btn").style.visibility = "";
    }
  }
  function recoverPop(x, y, text) {
    const host = screens.fight;
    const r = host.getBoundingClientRect();
    const el = document.createElement("div");
    el.className = "rec-pop";
    el.textContent = text;
    el.style.left = (x - r.left) + "px";
    el.style.top = (y - r.top - 20) + "px";
    host.appendChild(el);
    setTimeout(() => el.remove(), 650);
  }
  function onRecoverTap(x, y) {
    const ms = App.matchState;
    if (!ms || App.paused || ms.phase !== "fighting") return;
    const slot = downSlot(ms);
    if (slot < 0 || !humanSlots().includes(slot)) return;
    const f = ms.fighters[slot];
    if (!f.knockdown || f.knockdown.ko) return;
    const now = performance.now();
    let counted;
    if (App.net) {
      // online: só avisa o servidor; ele valida e devolve o progresso oficial no próximo estado
      if (now - recLastLocalTap < Engine.RECOVERY_MIN_CLICK_INTERVAL_MS) return;
      Net.recoverClick();
      counted = true;
    } else {
      counted = Engine.registerRecoveryClick(f, now);
    }
    if (!counted) return;
    recLastLocalTap = now;
    GameAudio.play("recoverTap", 0.5);
    const fill = $("#rec-fill");
    fill.classList.add("bump"); setTimeout(() => fill.classList.remove("bump"), 90);
    const ov = $("#recover-overlay");
    ov.classList.remove("shake"); void ov.offsetWidth; ov.classList.add("shake");
    const btn = $("#rec-btn");
    btn.classList.add("pressed"); setTimeout(() => btn.classList.remove("pressed"), 80);
    if (x != null) recoverPop(x, y, Math.random() < 0.25 ? "💪" : "+1");
  }
  // Cada dedo/clique é UM pointerdown (pointer events não duplicam toque + mouse emulado)
  $("#recover-overlay").addEventListener("pointerdown", (e) => {
    if ($("#recover-overlay").classList.contains("watching")) return;
    e.preventDefault();
    onRecoverTap(e.clientX, e.clientY);
  });
  $("#recover-overlay").addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return; // segurar a tecla não conta
    if (e.code !== "Space" && e.key !== "Enter") return;
    if ($("#recover-overlay").classList.contains("hidden") || $("#recover-overlay").classList.contains("watching")) return;
    e.preventDefault();
    const b = $("#rec-btn").getBoundingClientRect();
    onRecoverTap(b.left + b.width / 2, b.top);
  });
  function resetRecoverUI() {
    $("#recover-overlay").classList.add("hidden");
    $("#recover-toast").classList.add("hidden");
    document.body.classList.remove("rec-active");
    recPrevDown = -1; recLastCount = 0; recKoShown = false;
  }
  // Nocaute definitivo: segura a tela ~1,8s com "NOCAUTE!" antes do resultado
  function showPostfightAfterKo(ms) {
    if (ms.result && ms.result.method === "Nocaute") {
      recKoShown = true;
      showRecoverToast(I18N.t("rec.ko"), true);
      GameAudio.play("knockdown", 1);
      setTimeout(() => { resetRecoverUI(); showPostfight(ms); }, 1800);
    } else {
      resetRecoverUI();
      showPostfight(ms);
    }
  }

  // ---------------- Áudio e efeitos (reage a mudanças no estado da luta) ----------------
  let audioPrevSnap = null;
  function flashHit(big) {
    const el = $("#hit-flash");
    el.style.opacity = big ? 0.35 : 0.18;
    requestAnimationFrame(() => { el.style.opacity = 0; });
  }
  function hitSoundFor(move) {
    if (move === "jab") return "hitJab";
    if (move === "straight") return "hitStraight";
    return "hitHook";
  }
  function processAudioEvents(ms) {
    const [fA, fB] = ms.fighters;
    const prev = audioPrevSnap;
    if (!prev) {
      audioPrevSnap = snapshotForAudio(ms);
      if (ms.phase === "fighting") GameAudio.startCrowd();
      return;
    }
    [fA, fB].forEach((f, i) => {
      const p = prev.f[i];
      const attacker = ms.fighters[1 - i];
      if (f.health < p.health - 0.1) {
        const big = p.health - f.health > 3;
        GameAudio.play(hitSoundFor(attacker.lastMoveUsed), big ? 1 : 0.7);
        if (render3dReady) Render.triggerHitFX(f.x, big);
        flashHit(big);
      }
      if (f.knockdown && !p.knockdown) GameAudio.play("knockdown");
      if (f.dodgeIFrames > 0 && !p.dodging) GameAudio.play("dodge", 0.6);
      if (f.specialMeter >= 100 && p.specialMeter < 100) GameAudio.play("special", 0.8);
    });
    if (ms.phase === "countdown" && prev.phase !== "countdown") GameAudio.play("bell");
    if (ms.phase === "fighting" && prev.phase === "countdown") GameAudio.play("fightGo");
    if (ms.phase === "fighting") GameAudio.startCrowd();
    if (ms.phase === "matchEnd" && prev.phase !== "matchEnd") {
      GameAudio.play("victory");
      GameAudio.stopCrowd();
    }
    audioPrevSnap = snapshotForAudio(ms);
  }
  function snapshotForAudio(ms) {
    return {
      phase: ms.phase,
      f: ms.fighters.map((f) => ({ health: f.health, knockdown: !!f.knockdown, specialMeter: f.specialMeter, dodging: f.dodgeIFrames > 0 })),
    };
  }

  $("#btn-mute").addEventListener("click", () => toggleMute());
  $("#btn-mute-title").addEventListener("click", () => toggleMute());
  function toggleMute() {
    const now = !GameAudio.isMuted();
    GameAudio.setMuted(now);
    $("#btn-mute").textContent = now ? "🔇" : "🔊";
    $("#btn-mute-title").textContent = now ? I18N.t("sound.off") : I18N.t("sound.on");
  }

  // ---------------- Pós-luta ----------------
  function showPostfight(ms) {
    const r = ms.result;
    let title = I18N.t("post.draw");
    let sub = "";
    if (r && r.winnerIndex >= 0) {
      const winner = ms.fighters[r.winnerIndex];
      title = I18N.t("post.won", { name: `${winner.playerLabel ? winner.playerLabel + " — " : ""}${winner.name}` });
      sub = I18N.t("post.method", { method: I18N.method(r.method) });
    } else {
      sub = I18N.t("post.drawSub");
    }
    $("#postfight-title").textContent = title;
    $("#postfight-sub").textContent = sub;
    show("postfight");
    App._shownVs = false;
  }

  $("#btn-rematch").addEventListener("click", () => {
    if (App.net) {
      Net.rematch();
      show("mp-room");
    } else if (localMode === "training") {
      startLocalMatch(App.matchState.fighters[0].characterId, App.matchState.fighters[1].characterId, I18N.t("you"), I18N.t("ai") + " (" + I18N.t("diff." + App.difficulty) + ")", { aiSlot: 1 });
    } else {
      startLocalMatch(App.chosen[0], App.chosen[1], I18N.t("player1"), I18N.t("player2"), {});
    }
  });
  $("#btn-change-char").addEventListener("click", () => {
    if (App.net) {
      show("mp-room");
    } else if (App.mode === "training") {
      openCharSelect(I18N.t("char.chooseTraining"), { showDifficulty: true });
    } else {
      App.localStep = 0;
      openCharSelect(I18N.t("char.p1"), {});
    }
  });
  $("#btn-leave-room").addEventListener("click", () => {
    stopFightLoop();
    if (App.net) Net.leave();
    App.net = false;
    show("mode-select");
  });

  // ---------------- Idioma (Português / Español) ----------------
  document.querySelectorAll(".lang-btn").forEach((b) => b.addEventListener("click", () => I18N.setLang(b.dataset.lang)));
  I18N.onChange(() => {
    // textos montados no JS que já estão na tela
    const muted = $("#btn-mute").textContent.includes("🔇");
    $("#btn-mute-title").textContent = muted ? I18N.t("sound.off") : I18N.t("sound.on");
    if (!App.net) App.playerName = App.playerName.replace(/^(Jogador|Jugador)/, I18N.t("player"));
  });
  I18N.apply();
  $("#btn-mute-title").textContent = $("#btn-mute").textContent.includes("🔇") ? I18N.t("sound.off") : I18N.t("sound.on");

  // ---------------- Pausar / Sair da partida ----------------
  App.paused = false;
  function openPauseMenu() {
    if (!screens.fight.classList.contains("active")) return;
    if (App.matchState && App.matchState.phase === "matchEnd") return;
    if (App.net) {
      // online não dá pra congelar a luta do outro jogador: o menu só oferece sair
      $("#pause-title").textContent = I18N.t("pause.menu");
      $("#pause-sub").textContent = I18N.t("pause.online");
    } else {
      App.paused = true;
      App.keys.clear(); App.mouse.left = App.mouse.right = false;
      $("#pause-title").textContent = I18N.t("pause.title");
      $("#pause-sub").textContent = I18N.t("pause.sub");
    }
    $("#pause-overlay").classList.remove("hidden");
  }
  function closePauseMenu() {
    App.paused = false;
    $("#pause-overlay").classList.add("hidden");
  }
  function quitMatch() {
    closePauseMenu();
    resetRecoverUI();
    stopFightLoop();
    App.mpStopped = true;
    if (App.net) { try { Net.leave(); } catch (_) {} App.net = false; }
    App.matchState = null;
    App._shownVs = false;
    App.mobile.move = 0; App.mobile.mash = false; App.mobile.actionQueue.length = 0;
    show("mode-select");
  }
  App.quitMatch = quitMatch;
  $("#btn-pause").addEventListener("click", openPauseMenu);
  $("#btn-quit").addEventListener("click", () => {
    if (App.net) openPauseMenu(); // online: confirma antes (abandono)
    else quitMatch();
  });
  $("#btn-resume").addEventListener("click", closePauseMenu);
  $("#btn-quit-confirm").addEventListener("click", quitMatch);
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    // Esc sempre pausa; P só fora do 2 jogadores local (lá o P é a provocação do jogador 2)
    if (k !== "escape" && !(k === "p" && App.mode !== "local2p")) return;
    if ($("#pause-overlay").classList.contains("hidden")) openPauseMenu();
    else closePauseMenu();
  });


  window.__APP_DEBUG__ = () => ({
    phase: App.matchState && App.matchState.phase,
    round: App.matchState && App.matchState.round,
    roundTimeMs: App.matchState && App.matchState.roundTimeMs,
    countdownMs: App.matchState && App.matchState.countdownMs,
    rafId: App.rafId,
    render3dReady,
    health: App.matchState && App.matchState.fighters.map((f) => f.health),
    knockdown: App.matchState && App.matchState.fighters.map((f) => f.knockdown && { ...f.knockdown }),
  });
  window.__TEST_FORCE_ZERO_HEALTH__ = (slot) => { if (App.matchState) App.matchState.fighters[slot].health = 0.01; };
  window.__TEST_FORCE_KNOCKDOWN__ = (slot, countdownMs) => {
    if (!App.matchState) return;
    const f = App.matchState.fighters[slot];
    f.health = 0;
    f.state = "fallen";
    f.knockdowns = (f.knockdowns || 0) + 1;
    f.knockdown = { countdownMs: countdownMs ?? Engine.KNOCKDOWN_COUNT_MS, downMs: 0, fall: f.knockdowns,
      required: Engine.recoveryClicksRequired(f, f.knockdowns), clicks: 0, lastClickAt: null, recovered: false };
  };

  // Link de convite (?room=CODIGO): vai direto para a sala e já entra sozinho.
  // (antes o show("title") daqui de baixo sobrescrevia e o convidado caía na tela inicial)
  const roomParam = (new URLSearchParams(location.search).get("room") || "").trim().toUpperCase();
  if (roomParam) {
    App.mode = "multiplayer";
    show("mp-lobby");
    $("#input-room-code").value = roomParam;
    setTimeout(() => $("#btn-join-room").click(), 50);
  } else {
    show("title");
  }
})();
