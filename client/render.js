// Renderização em canvas: ringue "VELADA DEL AÑO" + lutadores.
// Os lutadores usam uma imagem estática (recorte da referência do personagem) animada
// proceduralmente (translação/rotação/escala) — ver assets/inventory.md para o motivo.

const Render = (() => {
  const imgCache = {};

  // ---------------- Efeitos visuais (shake / flash / faíscas) ----------------
  const fx = { shakeUntil: 0, shakeMag: 0, flashUntil: 0, flashMag: 0, sparks: [] };

  function triggerHitFX(arenaX, big) {
    const now = performance.now();
    fx.shakeUntil = now + (big ? 260 : 140);
    fx.shakeMag = big ? 10 : 5;
    fx.flashUntil = now + (big ? 140 : 70);
    fx.flashMag = big ? 0.35 : 0.18;
    for (let i = 0; i < (big ? 10 : 6); i++) {
      const ang = Math.random() * Math.PI * 2;
      fx.sparks.push({
        x: arenaX, yOff: -30 - Math.random() * 20,
        vx: Math.cos(ang) * (big ? 3.2 : 2), vy: Math.sin(ang) * (big ? 3.2 : 2) - 1,
        life: 1, born: now,
      });
    }
  }

  function updateAndDrawSparks(ctx, w, h, floorY, timeMs) {
    const scaleArena = w / 900;
    const chestY = floorY - h * 0.2;
    fx.sparks = fx.sparks.filter((s) => timeMs - s.born < 500);
    fx.sparks.forEach((s) => {
      const t = (timeMs - s.born) / 500;
      const x = (s.x + s.vx * t * 20) * scaleArena;
      const y = chestY + s.yOff * 0.3 + s.vy * t * 20;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.fillStyle = "#fff67a";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }


  // Alguns personagens têm, além do sprite base (pose neutra), artes dedicadas para
  // estados específicos (ex: sprite_punch.png, sprite_guard.png) desenhadas pelo artista
  // na pose real — não apenas o sprite base transformado via código. Quando existe arte
  // dedicada para o estado atual, usamos ela; senão caímos de volta pro sprite base.
  function getSprite(characterId, mirrored, pose) {
    const suffix = mirrored ? "_mirrored" : "";
    const file = pose ? `sprite_${pose}${suffix}.png` : `sprite${suffix}.png`;
    const key = characterId + "|" + file;
    if (imgCache[key]) return imgCache[key];
    const img = new Image();
    img._failed = false;
    img.onerror = () => { img._failed = true; };
    img.src = `../assets/characters/${characterId}/${file}`;
    imgCache[key] = img;
    return img;
  }

  function usable(img) {
    return img && !img._failed && img.complete && img.naturalWidth;
  }

  // Mapeia o estado de combate pro sufixo de arte dedicada correspondente, quando houver.
  function poseForState(state) {
    if (state === "punch") return "punch";
    if (state === "guard") return "guard";
    if (state === "move") return "move";
    if (state === "fallen") return "fallen";
    return null;
  }

  // Resolve a melhor imagem disponível para o estado atual: arte dedicada da pose se já
  // carregou com sucesso, senão o sprite base (pose neutra) pra ser transformado via código.
  function resolveSprite(characterId, mirrored, pose) {
    if (pose) {
      const posed = getSprite(characterId, mirrored, pose);
      if (usable(posed)) return { img: posed, isPosed: true };
      if (!posed._failed) {
        // ainda carregando — evita que o lutador suma nesse frame.
        const base = getSprite(characterId, mirrored, null);
        return { img: usable(base) ? base : posed, isPosed: false };
      }
    }
    return { img: getSprite(characterId, mirrored, null), isPosed: false };
  }

  // Ringue oficial (arte enviada pelo usuário). Desenhado em modo "cover";
  // RING_FLOOR_FRAC = altura (fração da imagem) onde ficam os pés dos lutadores, já sobre a lona.
  const ringImg = new Image();
  ringImg._failed = false;
  ringImg.onerror = () => { ringImg._failed = true; };
  ringImg.src = "../assets/arena/ring.png";
  const RING_FLOOR_FRAC = 0.84;

  function drawArena(ctx, w, h, timeMs) {
    ctx.clearRect(0, 0, w, h);
    if (usable(ringImg)) {
      const iw = ringImg.naturalWidth, ih = ringImg.naturalHeight;
      const s = Math.max(w / iw, h / ih);
      const dw = iw * s, dh = ih * s;
      const ox = (w - dw) / 2;
      // corte centralizado: preserva o letreiro em cima e a lona embaixo
      const oy = (h - dh) / 2;
      ctx.drawImage(ringImg, ox, oy, dw, dh);
      // leve pulsar dos holofotes para a cena não ficar estática
      ctx.save();
      ctx.globalAlpha = 0.05 + 0.04 * Math.sin(timeMs / 700);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h * 0.45);
      ctx.restore();
      const cap = document.body.classList.contains("touch-device") ? 0.8 : 0.9; // no celular os botões ocupam a base
      return Math.min(h * cap, oy + dh * RING_FLOOR_FRAC);
    }

    // fundo gradiente (arena escura, holofotes)
    const bg = ctx.createRadialGradient(w / 2, h * 0.25, 40, w / 2, h * 0.25, w * 0.8);
    bg.addColorStop(0, "#2a2440");
    bg.addColorStop(1, "#05050a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // telão / placa de fundo com o nome do evento
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#111018";
    ctx.fillRect(w * 0.08, h * 0.04, w * 0.84, h * 0.14);
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 3;
    ctx.strokeRect(w * 0.08, h * 0.04, w * 0.84, h * 0.14);
    ctx.fillStyle = "#ffcc00";
    ctx.font = `bold ${Math.floor(h * 0.07)}px Arial Black, Arial`;
    ctx.textAlign = "center";
    ctx.fillText("VELADA DEL AÑO", w / 2, h * 0.14);
    ctx.restore();

    // holofotes (feixes cônicos vindos do topo)
    ctx.save();
    [0.2, 0.5, 0.8].forEach((fx_, i) => {
      const grd = ctx.createLinearGradient(w * fx_, 0, w * fx_, h * 0.5);
      grd.addColorStop(0, "rgba(255,255,255,0.10)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      const spread = w * 0.08;
      ctx.moveTo(w * fx_ - 4, 0);
      ctx.lineTo(w * fx_ + 4, 0);
      ctx.lineTo(w * fx_ + spread, h * 0.5);
      ctx.lineTo(w * fx_ - spread, h * 0.5);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();

    // plateia (silhuetas simples, com leve cintilação)
    for (let i = 0; i < 26; i++) {
      const cx = (i / 26) * w + (Math.sin(i * 13.1) * 4);
      const cy = h * 0.21 + Math.cos(i) * 3;
      const flicker = 0.7 + 0.3 * Math.sin(timeMs / 400 + i);
      ctx.fillStyle = `rgba(26,24,38,${flicker})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // piso do ringue (lona)
    const floorY = h * 0.56;
    ctx.fillStyle = "#1c3fae";
    ctx.beginPath();
    ctx.moveTo(w * 0.05, h * 0.97);
    ctx.lineTo(w * 0.95, h * 0.97);
    ctx.lineTo(w * 0.80, floorY);
    ctx.lineTo(w * 0.20, floorY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      ctx.beginPath();
      ctx.moveTo(w * (0.20 + 0.60 * t), floorY);
      ctx.lineTo(w * (0.05 + 0.90 * t), h * 0.97);
      ctx.stroke();
    }

    // cordas + cantoneiras
    const ropeYs = [floorY - 6, floorY - 22, floorY - 38];
    const cornerColors = ["#e63946", "#1c3fae"];
    [0, 1].forEach((side) => {
      const cx = side === 0 ? w * 0.09 : w * 0.91;
      ctx.fillStyle = cornerColors[side];
      ctx.fillRect(cx - 7, floorY - 70, 14, 70);
      // faixa "VELADA DEL AÑO" na cantoneira
      ctx.save();
      ctx.translate(cx, floorY - 50);
      ctx.rotate(side === 0 ? -0.08 : 0.08);
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.floor(h * 0.018)}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText("VELADA", 0, -6);
      ctx.fillText("DEL AÑO", 0, 8);
      ctx.restore();
    });
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ropeYs.forEach((ry) => {
      ctx.beginPath();
      ctx.moveTo(w * 0.09, ry);
      ctx.lineTo(w * 0.91, ry);
      ctx.stroke();
    });

    return floorY;
  }

  function stateTransform(fighter, timeMs) {
    const t = timeMs / 1000;
    let tx = 0, ty = 0, rot = 0, scaleX = 1, scaleY = 1, alpha = 1, tint = null;
    switch (fighter.state) {
      case "idle":
        ty = Math.sin(t * 2.2) * 3;
        break;
      case "move":
        ty = Math.sin(t * 7) * 5;
        rot = Math.sin(t * 7) * 0.02 * fighter.facing;
        break;
      case "punch": {
        const move = fighter.currentMove;
        const isHook = move === "hookLeft" || move === "hookRight";
        if (fighter.actionPhase === "startup") {
          // antecipação: puxa o corpo pra trás antes de disparar o golpe, como um boxeador
          // de verdade carrega o peso antes de soltar a mão — sem isso o golpe "teleporta".
          tx = -5 * fighter.facing;
          rot = -0.06 * fighter.facing;
          scaleX = 0.97; scaleY = 1.03;
        } else if (fighter.actionPhase === "active") {
          // golpe disparado: avanço forte + estica-e-encolhe (squash/stretch) pra dar peso
          tx = 34 * fighter.facing;
          scaleX = 1.14; scaleY = 0.93;
          if (isHook) {
            // ganchos sobem em arco lateral em vez de ir reto pra frente
            ty = -14;
            rot = 0.3 * fighter.facing * (move === "hookLeft" ? 1 : -1);
          } else {
            rot = 0.08 * fighter.facing;
          }
        } else {
          // recuperação: volta pra posição de guarda
          tx = 9 * fighter.facing;
          rot = 0.03 * fighter.facing;
        }
        break;
      }
      case "guard":
        scaleY = 0.94; ty = 4;
        break;
      case "dodge":
        tx = -16 * fighter.facing; rot = -0.12 * fighter.facing;
        break;
      case "taunt":
        ty = Math.sin(t * 10) * 6; rot = Math.sin(t * 10) * 0.05;
        break;
      case "stun":
        tx = (Math.random() - 0.5) * 8; ty = (Math.random() - 0.5) * 8; tint = "rgba(255,80,80,0.35)";
        break;
      case "fallen":
        rot = 1.45 * fighter.facing * -1; ty = 70; alpha = 0.95;
        break;
      default:
        break;
    }
    if (fighter.specialActive > 0) tint = tint || "rgba(255,214,10,0.25)";
    if (fighter.dodgeIFrames > 0) alpha = 0.6;
    return { tx, ty, rot, scaleX, scaleY, alpha, tint };
  }

  function drawFighter(ctx, fighter, w, h, floorY, timeMs) {
    const mirrored = fighter.facing < 0;
    const pose = poseForState(fighter.state);
    const { img, isPosed } = resolveSprite(fighter.characterId, mirrored, pose);
    const scaleArena = w / 900;
    const baseX = fighter.x * scaleArena;
    const spriteH = h * 0.34;
    const spriteW = img.naturalWidth ? spriteH * (img.naturalWidth / img.naturalHeight) : spriteH * 0.85;
    const baseY = floorY;

    let { tx, ty, rot, scaleX, scaleY, alpha, tint } = stateTransform(fighter, timeMs);
    if (isPosed) {
      // a arte já mostra a pose real (soco, guarda...) — não distorcemos com
      // rotação/escala procedural, que foi pensada pra deformar o sprite neutro.
      // Mantemos só um leve avanço/recuo e o tingimento (ex: brilho do especial).
      rot = 0;
      scaleX = 1;
      scaleY = 1;
      if (fighter.state === "punch") {
        tx = fighter.actionPhase === "active" ? 14 * fighter.facing
          : fighter.actionPhase === "startup" ? -3 * fighter.facing
          : 6 * fighter.facing;
      } else if (fighter.state === "guard") {
        tx = 0;
      } else if (fighter.state === "fallen") {
        // a arte já mostra ele caindo/tonto — sem a rotação de 90°+ usada
        // pra deitar o sprite neutro no chão.
        tx = 0;
        ty = 6;
      } else if (fighter.state === "move") {
        tx = 0; // posição já vem de baseX; só mantemos o leve bob vertical do stateTransform
      }
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(baseX + tx, baseY + ty);
    ctx.rotate(rot);
    ctx.scale(scaleX, scaleY);
    if (img.complete && img.naturalWidth) {
      ctx.drawImage(img, -spriteW / 2, -spriteH, spriteW, spriteH);
    } else {
      ctx.fillStyle = "#444";
      ctx.fillRect(-spriteW / 2, -spriteH, spriteW, spriteH);
    }
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(-spriteW / 2, -spriteH, spriteW, spriteH);
    }
    ctx.restore();

    // linhas de movimento atrás do soco no instante ativo do golpe — reforça a leitura de
    // "soco rápido" mesmo sem um sprite de braço separado animando de verdade.
    if (fighter.state === "punch" && fighter.actionPhase === "active") {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      const gloveY = baseY - spriteH * 0.42;
      for (let i = 0; i < 3; i++) {
        const lx = baseX - fighter.facing * (spriteW * 0.32 + i * 10);
        ctx.beginPath();
        ctx.moveTo(lx, gloveY - 6 + i * 6);
        ctx.lineTo(lx - fighter.facing * 14, gloveY - 6 + i * 6);
        ctx.stroke();
      }
      ctx.restore();
    }

    // nome sob o lutador
    ctx.save();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText(fighter.name, baseX, baseY + 14);
    ctx.restore();

  }

  // Juiz: figura vetorial simples (não é uma das 9 referências, então desenhamos um
  // boneco genérico de árbitro — camisa listrada preto/branco clássica de boxe) que entra
  // em cena quando algum lutador está caído, curvado contando ou com os braços erguidos
  // no nocaute definitivo.
  function drawRefereeVector(ctx, matchState, w, h, floorY, timeMs) {
    const [fA, fB] = matchState.fighters;
    const down = fA.knockdown ? fA : fB.knockdown ? fB : null;
    if (!down) return;
    const scaleArena = w / 900;
    const dir = down === fA ? 1 : -1; // fica do lado de fora, virado pro caído
    const x = down.x * scaleArena + dir * 46;
    const y = floorY;
    const t = timeMs / 1000;
    const ko = down.knockdown && down.knockdown.ko;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-dir, 1); // vira de frente pro lutador caído

    const bob = ko ? 0 : Math.sin(t * 3.4) * 0.5 + 0.5;
    const bend = ko ? 0 : 0.3; // curvado contando
    ctx.rotate(bend);

    // pernas
    ctx.strokeStyle = "#161616"; ctx.lineWidth = 7; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-5, -34); ctx.lineTo(-9, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5, -34); ctx.lineTo(9, 0); ctx.stroke();

    // tronco (camisa listrada preto/branco)
    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(-13, -72, 26, 40);
    ctx.strokeStyle = "#161616"; ctx.lineWidth = 4;
    for (let i = -10; i <= 10; i += 6) {
      ctx.beginPath(); ctx.moveTo(i, -72); ctx.lineTo(i, -32); ctx.stroke();
    }
    ctx.strokeStyle = "#161616"; ctx.lineWidth = 2;
    ctx.strokeRect(-13, -72, 26, 40);

    // cabeça
    ctx.fillStyle = "#caa07a";
    ctx.beginPath(); ctx.arc(0, -84, 11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#161616"; ctx.lineWidth = 2; ctx.stroke();

    // braço contando (sobe e desce em ritmo de "1, 2, 3...") ou erguido no nocaute
    ctx.strokeStyle = "#caa07a"; ctx.lineWidth = 6; ctx.lineCap = "round";
    if (ko) {
      ctx.beginPath(); ctx.moveTo(10, -68); ctx.lineTo(26, -98); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10, -68); ctx.lineTo(-26, -98); ctx.stroke();
    } else {
      const armY = -68 + bob * 18;
      ctx.beginPath(); ctx.moveTo(10, -68); ctx.lineTo(22, armY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-10, -68); ctx.lineTo(-18, -78); ctx.stroke();
    }
    ctx.restore();
  }

  // Juiz oficial (arte enviada pelo usuário). A arte original aponta para a DIREITA.
  const refImg = new Image(); refImg.onerror = () => { refImg._failed = true; };
  refImg.src = "../assets/referee/referee.png";
  const refImgM = new Image(); refImgM.onerror = () => { refImgM._failed = true; };
  refImgM.src = "../assets/referee/referee_mirrored.png";

  function drawReferee(ctx, matchState, w, h, floorY, timeMs) {
    const [fA, fB] = matchState.fighters;
    const down = fA.knockdown ? fA : fB.knockdown ? fB : null;
    if (!down) return;
    if (!usable(refImg) || !usable(refImgM)) return drawRefereeVector(ctx, matchState, w, h, floorY, timeMs);
    const standing = down === fA ? fB : fA;
    const scaleArena = w / 900;
    const refH = h * 0.36;
    const refW = refH * (refImg.naturalWidth / refImg.naturalHeight);
    const downX = down.x * scaleArena;
    // fica do lado de FORA do caído (longe de quem ficou de pé), apontando pra ele;
    // se não couber no ringue, vai pro outro lado
    // largura real da arte de "caído" (algumas são deitadas, bem largas) pra não sobrepor
    const fallenImg = getSprite(down.characterId, down.facing < 0, "fallen");
    const fallenW = usable(fallenImg) ? h * 0.34 * (fallenImg.naturalWidth / fallenImg.naturalHeight) : h * 0.3;
    const gap = fallenW / 2 + refW / 2 + 6;
    let side = down.x < standing.x ? -1 : 1;
    let x = downX + side * gap;
    if (x - refW / 2 < w * 0.03 || x + refW / 2 > w * 0.97) { side = -side; x = downX + side * gap; }
    const img = side < 0 ? refImg : refImgM; // à esquerda do caído aponta pra direita (arte original)

    const kd = down.knockdown;
    const total = window.Engine ? Engine.KNOCKDOWN_COUNT_MS : 4000;
    const stepMs = total / 10;
    const elapsed = total - kd.countdownMs;
    const count = Math.min(10, Math.floor(elapsed / stepMs) + 1);
    const phase = (elapsed % stepMs) / stepMs; // 0..1 dentro de cada número
    // a cada número o juiz dá um "tranco" pra baixo apontando (como na arte)
    const punch = kd.ko ? 0 : Math.max(0, 1 - phase * 3);
    const dy = punch * 8;
    const tilt = punch * 0.05 * -side;

    ctx.save();
    ctx.translate(x, floorY + dy);
    ctx.rotate(tilt);
    ctx.drawImage(img, -refW / 2, -refH, refW, refH);
    ctx.restore();

    // balão com o número da contagem (ou NOCAUTE no final)
    const label = kd.ko ? (window.I18N ? I18N.t("kd.ko") : "NOCAUTE!") : String(count);
    const bx = x + side * -refW * 0.05, by = floorY - refH - 26;
    const pop = kd.ko ? 1 : 1 + punch * 0.35;
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(pop, pop);
    ctx.font = `bold ${Math.round(h * (kd.ko ? 0.05 : 0.075))}px "Arial Black", Arial`;
    const tw = ctx.measureText(label).width;
    const bw = tw + 28, bh = h * (kd.ko ? 0.085 : 0.11);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#111"; ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 12); else ctx.rect(-bw / 2, -bh / 2, bw, bh);
    ctx.fill(); ctx.stroke();
    // rabinho do balão apontando pro juiz
    ctx.beginPath(); ctx.moveTo(-8, bh / 2 - 1); ctx.lineTo(8, bh / 2 - 1); ctx.lineTo(0, bh / 2 + 12); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#e2231a"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 2);
    ctx.restore();
  }

  function drawMatch(ctx, matchState, w, h, timeMs) {
    ctx.save();
    const shaking = timeMs < fx.shakeUntil;
    if (shaking) {
      const k = (fx.shakeUntil - timeMs) / 260;
      ctx.translate((Math.random() - 0.5) * fx.shakeMag * k, (Math.random() - 0.5) * fx.shakeMag * k);
    }

    const floorY = drawArena(ctx, w, h, timeMs);
    const [fA, fB] = matchState.fighters;
    const order = fA.x < fB.x ? [fA, fB] : [fB, fA];
    order.forEach((f) => drawFighter(ctx, f, w, h, floorY, timeMs));
    drawReferee(ctx, matchState, w, h, floorY, timeMs);
    updateAndDrawSparks(ctx, w, h, floorY, timeMs);

    if (matchState.phase === "countdown") {
      ctx.save();
      ctx.fillStyle = "#ffcc00";
      ctx.font = `bold ${Math.floor(h * 0.18)}px Arial Black, Arial`;
      ctx.textAlign = "center";
      const n = Math.ceil(matchState.countdownMs / 1000);
      ctx.fillText(matchState.round > 1 ? `ROUND ${matchState.round}` : (n > 0 ? String(n) : (window.I18N ? I18N.t("fight.go") : "LUTA!")), w / 2, h / 2);
      ctx.restore();
    }

    if (timeMs < fx.flashUntil) {
      ctx.save();
      ctx.globalAlpha = fx.flashMag * Math.max(0, (fx.flashUntil - timeMs) / 140);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    ctx.restore();
  }

  return { drawMatch, getSprite, triggerHitFX };
})();

if (typeof window !== "undefined") window.Render = Render;
