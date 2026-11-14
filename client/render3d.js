// Renderização 3D real (WebGL via Three.js) do ringue e dos lutadores.
// Cada lutador é um "boneco" articulado (grupos/juntas de verdade, não um sprite plano):
// tronco, cabeça (com o ROSTO REAL recortado da referência do personagem como textura),
// braços com cotovelo, pernas com joelho, luvas e tênis nas cores extraídas da própria arte
// de referência (ver assets/characters/palette.json e scripts/extract_character_art.py).
import * as THREE from "./vendor/three/three.module.min.js";

const Render3D = (() => {
  let renderer, scene, camera;
  let ringGroup;
  const rigs = {}; // slot(0|1) -> { root, parts..., characterId }
  let palette = {};
  let paletteLoaded = false;
  const textureLoader = new THREE.TextureLoader();
  const faceTexCache = {};

  // Mapa de gradiente de 3 degraus para sombreamento "toon" (cel-shading) — faz as cores
  // caírem em faixas chapadas de luz/sombra em vez de um gradiente realista contínuo,
  // ficando parecido com a ilustração plana das caricaturas de referência.
  function makeToonGradientMap() {
    // eslint-disable-next-line no-undef
    const data = new Uint8Array([80, 80, 80, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    return tex;
  }
  let toonGradientMap = null;

  // Técnica clássica de "casco invertido": clona a geometria da peça, usa material preto
  // só na face de trás (BackSide) e escala um pouco pra fora — o resultado é um contorno
  // preto grosso ao redor da peça, igual ao traço de contorno das artes de referência.
  function addOutline(mesh, scale = 1.16) {
    const outline = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: 0x0b0b0e, side: THREE.BackSide }));
    outline.scale.setScalar(scale);
    mesh.add(outline);
    return outline;
  }

  const ARENA_WIDTH = 900; // mesma unidade usada pelo motor de combate (shared/engine.js)
  const WORLD_HALF = 4.6; // metade da largura do ringue no mundo 3D
  const FACE_TURN = Math.PI / 4.2; // ~43°: giro em 3/4 pra câmera ver o rosto, não o perfil puro

  function toWorldX(engineX) {
    return ((engineX / ARENA_WIDTH) - 0.5) * (WORLD_HALF * 2);
  }

  async function loadPalette() {
    if (paletteLoaded) return palette;
    try {
      const res = await fetch("../assets/characters/palette.json");
      palette = await res.json();
    } catch (e) {
      palette = {};
    }
    paletteLoaded = true;
    return palette;
  }

  function getFaceTexture(characterId) {
    if (faceTexCache[characterId]) return faceTexCache[characterId];
    const tex = textureLoader.load(`../assets/characters/${characterId}/face_texture.png`);
    tex.colorSpace = THREE.SRGBColorSpace;
    faceTexCache[characterId] = tex;
    return tex;
  }

  function makeBannerTexture(line1, line2) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#e6e6e6"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#111";
    ctx.font = "bold 42px Arial";
    ctx.textAlign = "center";
    ctx.fillText(line1, 128, 110);
    ctx.fillText(line2, 128, 160);
    return new THREE.CanvasTexture(c);
  }

  // ---------------- Plateia 3D de verdade (arquibancadas em volta do ringue) ----------------
  function buildCrowd() {
    const g = new THREE.Group();
    const rows = 4;
    const perRow = 14;
    const bodyGeo = new THREE.CapsuleGeometry(0.16, 0.34, 2, 6);
    const headGeo = new THREE.SphereGeometry(0.12, 8, 6);
    const shirtColors = [0xd81e1e, 0x2454d6, 0xffd400, 0x2ec4b6, 0xffffff, 0x9b59b6, 0xe67e22, 0x1a1a1a, 0x7ee787];
    const skinColors = [0xe8c39e, 0xc9966b, 0x8d5a3c, 0x5a3a22, 0xf0d9b5];

    // posições de assento: 3 lados (fundo, esquerda, direita) × N fileiras, subindo e recuando
    const seats = [];
    for (let r = 0; r < rows; r++) {
      const back = 6.3 + r * 0.62;
      const side = 6.0 + r * 0.6;
      const height = 0.3 + r * 0.42;
      for (let i = 0; i < perRow; i++) {
        const t = i / (perRow - 1);
        seats.push({ x: (t - 0.5) * 11.5, y: height, z: -back, face: 0 }); // fundo
        seats.push({ x: -side, y: height, z: -5.3 + t * 7.3, face: 1 }); // esquerda
        seats.push({ x: side, y: height, z: -5.3 + t * 7.3, face: -1 }); // direita
      }
    }

    const count = seats.length;
    const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), count);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), count);
    const dummy = new THREE.Object3D();
    const rng = (seed) => { const x = Math.sin(seed * 999.7) * 43758.5453; return x - Math.floor(x); };

    seats.forEach((s, i) => {
      const jitterX = (rng(i) - 0.5) * 0.35;
      const jitterZ = (rng(i + 500) - 0.5) * 0.25;
      const facingY = s.face === 0 ? 0 : (s.face === 1 ? Math.PI / 2 : -Math.PI / 2);

      dummy.position.set(s.x + jitterX, s.y + 0.33, s.z + jitterZ);
      dummy.rotation.set(0, facingY + (rng(i + 50) - 0.5) * 0.6, 0);
      dummy.scale.setScalar(0.85 + rng(i + 90) * 0.3);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      bodies.setColorAt(i, new THREE.Color(shirtColors[Math.floor(rng(i + 10) * shirtColors.length)]));

      dummy.position.set(s.x + jitterX, s.y + 0.6, s.z + jitterZ);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      heads.setColorAt(i, new THREE.Color(skinColors[Math.floor(rng(i + 30) * skinColors.length)]));
    });
    bodies.castShadow = true;
    g.add(bodies, heads);

    // arquibancada (estrutura em degraus, cor neutra, sob a plateia)
    const riserMat = new THREE.MeshStandardMaterial({ color: 0x15131c, roughness: 1 });
    for (let r = 0; r < rows; r++) {
      const y = r * 0.42;
      const riserFar = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 0.75), riserMat);
      riserFar.position.set(0, y, -6.0 - r * 0.62);
      g.add(riserFar);
      const riserL = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.5, 8), riserMat);
      riserL.position.set(-(5.7 + r * 0.6), y, -1.6);
      g.add(riserL);
      const riserR = riserL.clone();
      riserR.position.x = 5.7 + r * 0.6;
      g.add(riserR);
    }

    return g;
  }

  // ---------------- Telão suspenso (jumbotron real, em 3D, sobre a arquibancada do fundo) ----------------
  function buildJumbotron() {
    const g = new THREE.Group();
    const screenTex = makeArenaScreenTexture();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(7.4, 2.4, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 })
    );
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 2.0),
      new THREE.MeshBasicMaterial({ map: screenTex })
    );
    screen.position.z = 0.17;
    frame.add(screen);
    g.add(frame);
    g.position.set(0, 6.4, -9.8);
    g.rotation.x = 0.12;

    // treliça de sustentação (duas colunas simples)
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.4, roughness: 0.6 });
    [-3.2, 3.2].forEach((x) => {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5.4, 6), trussMat);
      col.position.set(x, 2.7, -9.3);
      g.add(col);
    });
    return g;
  }

  function makeArenaScreenTexture() {
    const c = document.createElement("canvas");
    c.width = 896; c.height = 256;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#0a0a12"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#ffcc00"; ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, c.width - 20, c.height - 20);
    ctx.fillStyle = "#ffcc00";
    ctx.font = "bold 92px Arial Black, Arial";
    ctx.textAlign = "center";
    ctx.fillText("VELADA DEL AÑO", c.width / 2, c.height / 2 + 32);
    return new THREE.CanvasTexture(c);
  }

  function buildRing() {
    const g = new THREE.Group();

    g.add(buildCrowd());
    g.add(buildJumbotron());

    // piso do ringue (lona azul)
    const mat = new THREE.MeshStandardMaterial({ color: 0x1c3fae, roughness: 0.9 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(WORLD_HALF * 2 + 1.4, 0.2, 8.6), mat);
    floor.position.set(0, -0.1, -1.2);
    floor.receiveShadow = true;
    g.add(floor);

    // linhas brancas no piso (faixas até o centro)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
    for (let i = -3; i <= 3; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.21, 8.4), lineMat);
      line.position.set(i * 1.4, -0.09, -1.2);
      g.add(line);
    }

    // apron (saia vermelha ao redor do ringue, com a faixa do evento)
    const apronTex = makeBannerTexture("VELADA", "DEL AÑO");
    apronTex.wrapS = THREE.RepeatWrapping; apronTex.repeat.x = 4;
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(WORLD_HALF * 2 + 1.6, 0.9, 0.12),
      new THREE.MeshStandardMaterial({ map: apronTex, color: 0xffffff })
    );
    apron.position.set(0, -0.55, 3.1);
    g.add(apron);

    // cantoneiras (postes) + cordas
    const postMat = [0xdc2626, 0x2454d6, 0xdc2626, 0x2454d6];
    const postPositions = [
      [-WORLD_HALF - 0.3, -5.3],
      [WORLD_HALF + 0.3, -5.3],
      [-WORLD_HALF - 0.3, 3.0],
      [WORLD_HALF + 0.3, 3.0],
    ];
    const posts = [];
    postPositions.forEach(([x, z], i) => {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, 2.4, 10),
        new THREE.MeshStandardMaterial({ color: postMat[i] })
      );
      post.position.set(x, 1.1, z);
      g.add(post);
      posts.push(post.position);

      // faixa "VELADA DEL AÑO" na cantoneira
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.55, 0.75),
        new THREE.MeshBasicMaterial({ map: makeBannerTexture("VELADA", "DEL AÑO"), side: THREE.DoubleSide })
      );
      flag.position.set(x * 0.92, 1.3, z * 0.55);
      flag.rotation.y = x > 0 ? -0.5 : 0.5;
      g.add(flag);
    });

    // cordas horizontais (3 alturas), ligando os 4 postes em retângulo
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    [0.55, 1.0, 1.45].forEach((ropeY) => {
      const corners = [
        [-WORLD_HALF - 0.3, -5.3], [WORLD_HALF + 0.3, -5.3],
        [WORLD_HALF + 0.3, 3.0], [-WORLD_HALF - 0.3, 3.0],
      ];
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.sqrt(dx * dx + dz * dz);
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 6), ropeMat);
        rope.position.set((a[0] + b[0]) / 2, ropeY, (a[1] + b[1]) / 2);
        rope.rotation.z = Math.PI / 2;
        rope.rotation.y = Math.atan2(dz, dx) + Math.PI / 2;
        // orienta o cilindro (eixo Y por padrão) ao longo do segmento no plano XZ
        rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, 0, dz).normalize());
        g.add(rope);
      }
    });

    return g;
  }

  // ---------------- Construção do boneco articulado de um lutador ----------------
  function buildFighterRig(characterId) {
    const pal = palette[characterId] || { skin: "#e0b48a", hair: "#222", shirt: "#444", pants: "#222", shoes: "#111", glove: "#d81e1e" };
    if (!toonGradientMap) toonGradientMap = makeToonGradientMap();
    // Toon/cel-shading (faixas de luz chapadas) em vez de PBR realista — aproxima do
    // visual de ilustração plana das caricaturas de referência, não de boneco "plástico".
    const skinMat = new THREE.MeshToonMaterial({ color: pal.skin, gradientMap: toonGradientMap });
    const hairMat = new THREE.MeshToonMaterial({ color: pal.hair, gradientMap: toonGradientMap });
    const shirtMat = new THREE.MeshToonMaterial({ color: pal.shirt, gradientMap: toonGradientMap });
    const pantsMat = new THREE.MeshToonMaterial({ color: pal.pants, gradientMap: toonGradientMap });
    const shoesMat = new THREE.MeshToonMaterial({ color: pal.shoes, gradientMap: toonGradientMap });
    const gloveMat = new THREE.MeshToonMaterial({ color: pal.glove, gradientMap: toonGradientMap });

    const root = new THREE.Group();

    // --- tronco ---
    const hips = new THREE.Group();
    hips.position.y = 0.95;
    root.add(hips);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.68, 0.34), shirtMat);
    torso.position.y = 0.42;
    torso.castShadow = true;
    addOutline(torso);
    hips.add(torso);

    // --- cabeça (textura real do personagem na face frontal) ---
    // Cabeça ligeiramente maior (proporção "cabeça grande" típica das caricaturas da
    // Velada, em vez de corpo com proporções realistas).
    const headGroup = new THREE.Group();
    headGroup.position.y = 0.86;
    headGroup.scale.setScalar(1.16);
    hips.add(headGroup);

    const faceTex = getFaceTexture(characterId);
    const faceMat = new THREE.MeshToonMaterial({ map: faceTex, gradientMap: toonGradientMap });
    const headMaterials = [
      hairMat, hairMat, hairMat, skinMat,
      faceMat, // frente (rosto)
      hairMat,
    ];
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.42), headMaterials);
    head.castShadow = true;
    addOutline(head);
    headGroup.add(head);
    // "cabelo" (calota no topo, levemente maior, atrás)
    const hairCap = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.18, 0.44), hairMat);
    hairCap.position.set(0, 0.2, -0.01);
    addOutline(hairCap);
    headGroup.add(hairCap);

    // --- braços (ombro -> cotovelo -> luva) ---
    function buildArm(sign) {
      const shoulder = new THREE.Group();
      shoulder.position.set(sign * 0.4, 0.68, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.32, 4, 8), shirtMat);
      upper.position.y = -0.2;
      upper.castShadow = true;
      addOutline(upper);
      shoulder.add(upper);

      const elbow = new THREE.Group();
      elbow.position.y = -0.38;
      shoulder.add(elbow);

      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.3, 4, 8), skinMat);
      lower.position.y = -0.18;
      lower.castShadow = true;
      addOutline(lower);
      elbow.add(lower);

      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), gloveMat);
      glove.position.y = -0.4;
      glove.castShadow = true;
      addOutline(glove, 1.18);
      elbow.add(glove);

      hips.add(shoulder);
      return { shoulder, elbow };
    }
    const leftArm = buildArm(1);
    const rightArm = buildArm(-1);

    // --- pernas (quadril -> joelho -> pé) ---
    function buildLeg(sign) {
      const hip = new THREE.Group();
      // Pernas ~10% mais curtas (hip.scale.y) — mesmo truque de proporção "cartoon" da
      // cabeça maior; posição y recalibrada para os pés continuarem tocando o chão.
      hip.position.set(sign * 0.17, 0.76, 0);
      hip.scale.set(1, 0.9, 1);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.34, 4, 8), pantsMat);
      upper.position.y = -0.2;
      upper.castShadow = true;
      addOutline(upper);
      hip.add(upper);

      const knee = new THREE.Group();
      knee.position.y = -0.4;
      hip.add(knee);

      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.32, 4, 8), pantsMat);
      lower.position.y = -0.18;
      lower.castShadow = true;
      addOutline(lower);
      knee.add(lower);

      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.3), shoesMat);
      shoe.position.set(0, -0.38, 0.05);
      shoe.castShadow = true;
      addOutline(shoe);
      knee.add(shoe);

      root.add(hip);
      return { hip, knee };
    }
    const leftLeg = buildLeg(1);
    const rightLeg = buildLeg(-1);

    // brilho do especial (luz pontual desligada por padrão, liga quando specialActive>0)
    const glow = new THREE.PointLight(0xffd60a, 0, 2.2);
    glow.position.set(0, 1, 0);
    root.add(glow);

    return { root, hips, torso, headGroup, leftArm, rightArm, leftLeg, rightLeg, glow, characterId };
  }

  function ensureRig(slot, characterId) {
    if (rigs[slot] && rigs[slot].characterId === characterId) return rigs[slot];
    if (rigs[slot]) scene.remove(rigs[slot].root);
    const rig = buildFighterRig(characterId);
    scene.add(rig.root);
    rigs[slot] = rig;
    return rig;
  }

  // ---------------- Pose por estado do lutador ----------------
  function poseRig(rig, fighter, opponentX, timeMs) {
    const t = timeMs / 1000;
    const worldX = toWorldX(fighter.x);
    const facingToOpp = fighter.x < opponentX ? 1 : -1;

    rig.root.position.x = worldX;
    // Giro em 3/4 (não 90°) para o rosto real (textura no lado "frente" da cabeça)
    // ficar voltado pra câmera em vez de de perfil puro — crucial para reconhecer o rosto.
    rig.root.rotation.y = facingToOpp === 1 ? FACE_TURN : -FACE_TURN;
    rig.root.rotation.z = 0;
    rig.root.position.y = 0;

    // reset de pose
    rig.leftArm.shoulder.rotation.set(0.15, 0, 0);
    rig.rightArm.shoulder.rotation.set(0.15, 0, 0);
    rig.leftArm.elbow.rotation.set(-0.3, 0, 0);
    rig.rightArm.elbow.rotation.set(-0.3, 0, 0);
    rig.leftLeg.hip.rotation.set(0, 0, 0);
    rig.rightLeg.hip.rotation.set(0, 0, 0);
    rig.leftLeg.knee.rotation.set(0, 0, 0);
    rig.rightLeg.knee.rotation.set(0, 0, 0);
    rig.hips.rotation.y = 0;
    rig.headGroup.rotation.set(0, 0, 0);
    rig.glow.intensity = fighter.specialActive > 0 ? 1.4 + Math.sin(t * 20) * 0.4 : 0;

    switch (fighter.state) {
      case "idle":
        rig.root.position.y = Math.sin(t * 2.2) * 0.015;
        rig.leftArm.shoulder.rotation.x = 0.5;
        rig.rightArm.shoulder.rotation.x = 0.5;
        break;
      case "move": {
        const walk = Math.sin(t * 9);
        rig.leftLeg.hip.rotation.x = walk * 0.5;
        rig.rightLeg.hip.rotation.x = -walk * 0.5;
        rig.leftArm.shoulder.rotation.x = 0.5 - walk * 0.2;
        rig.rightArm.shoulder.rotation.x = 0.5 + walk * 0.2;
        rig.root.position.y = Math.abs(walk) * 0.04;
        break;
      }
      case "punch": {
        const move = fighter.currentMove;
        const phase = fighter.actionPhase;
        const reach = phase === "startup" ? 0.3 : phase === "active" ? 1 : 0.5;
        const isHook = move === "hookLeft" || move === "hookRight";
        const arm = move === "hookLeft" ? rig.leftArm : move === "hookRight" ? rig.rightArm : rig.rightArm; // jab/direto puxam o braço "da frente" (direito, pois tronco já olha p/ frente)
        const other = arm === rig.leftArm ? rig.rightArm : rig.leftArm;
        if (isHook) {
          arm.shoulder.rotation.z = (move === "hookLeft" ? 1 : -1) * 0.9 * reach;
          arm.shoulder.rotation.x = 0.3;
          arm.elbow.rotation.x = -0.9 * (1 - reach * 0.6);
          rig.hips.rotation.y = (move === "hookLeft" ? -1 : 1) * 0.35 * reach;
        } else {
          arm.shoulder.rotation.x = 0.5 - 1.5 * reach;
          arm.elbow.rotation.x = -0.25 * (1 - reach);
          rig.hips.rotation.y = (arm === rig.rightArm ? -1 : 1) * 0.15 * reach;
        }
        other.shoulder.rotation.x = 0.6;
        break;
      }
      case "guard":
        rig.leftArm.shoulder.rotation.x = 1.3;
        rig.rightArm.shoulder.rotation.x = 1.3;
        rig.leftArm.elbow.rotation.x = -1.6;
        rig.rightArm.elbow.rotation.x = -1.6;
        rig.hips.position.y = -0.02;
        break;
      case "dodge":
        rig.root.rotation.z = facingToOpp === 1 ? -0.3 : 0.3;
        rig.root.position.y = -0.1;
        break;
      case "taunt":
        rig.leftArm.shoulder.rotation.x = 1.9 + Math.sin(t * 10) * 0.1;
        rig.rightArm.shoulder.rotation.x = 1.9 - Math.sin(t * 10) * 0.1;
        rig.headGroup.rotation.x = -0.2;
        break;
      case "stun":
        rig.headGroup.rotation.z = Math.sin(t * 25) * 0.25;
        rig.root.position.x += (Math.random() - 0.5) * 0.04;
        break;
      case "fallen":
        rig.root.rotation.z = facingToOpp === 1 ? -Math.PI / 2 : Math.PI / 2;
        rig.root.position.y = -0.75;
        break;
      default:
        break;
    }
  }

  // ---------------- Árbitro (aparece e conta até 10 quando um lutador cai) ----------------
  let referee = null;

  function buildReferee() {
    const skinMat = new THREE.MeshToonMaterial({ color: "#caa07a", gradientMap: toonGradientMap });
    const shirtMat = new THREE.MeshToonMaterial({ color: "#e9e9e9", gradientMap: toonGradientMap });
    const collarMat = new THREE.MeshToonMaterial({ color: "#1c1c1c", gradientMap: toonGradientMap });
    const pantsMat = new THREE.MeshToonMaterial({ color: "#1c1c1c", gradientMap: toonGradientMap });

    const root = new THREE.Group();
    const hips = new THREE.Group();
    hips.position.y = 0.95;
    root.add(hips);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.64, 0.3), shirtMat);
    torso.position.y = 0.4;
    addOutline(torso);
    hips.add(torso);
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.32), collarMat);
    collar.position.y = 0.68;
    addOutline(collar);
    hips.add(collar);

    const headGroup = new THREE.Group();
    headGroup.position.y = 0.84;
    headGroup.scale.setScalar(1.1);
    hips.add(headGroup);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.44, 0.38), skinMat);
    addOutline(head);
    headGroup.add(head);

    function buildArm(sign) {
      const shoulder = new THREE.Group();
      shoulder.position.set(sign * 0.33, 0.68, 0);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.3, 4, 8), shirtMat);
      upper.position.y = -0.18;
      addOutline(upper);
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.34;
      shoulder.add(elbow);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.28, 4, 8), skinMat);
      lower.position.y = -0.16;
      addOutline(lower);
      elbow.add(lower);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), skinMat);
      hand.position.y = -0.34;
      addOutline(hand, 1.12);
      elbow.add(hand);
      hips.add(shoulder);
      return { shoulder, elbow };
    }
    const leftArm = buildArm(1);
    const rightArm = buildArm(-1);

    function buildLeg(sign) {
      const hip = new THREE.Group();
      hip.position.set(sign * 0.14, 0.76, 0);
      hip.scale.set(1, 0.9, 1);
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.34, 4, 8), pantsMat);
      upper.position.y = -0.2;
      addOutline(upper);
      hip.add(upper);
      const knee = new THREE.Group();
      knee.position.y = -0.4;
      hip.add(knee);
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.3, 4, 8), pantsMat);
      lower.position.y = -0.18;
      addOutline(lower);
      knee.add(lower);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.26), shirtMat);
      shoe.position.set(0, -0.36, 0.04);
      addOutline(shoe);
      knee.add(shoe);
      root.add(hip);
    }
    buildLeg(1);
    buildLeg(-1);

    root.visible = false;
    return { root, hips, headGroup, leftArm, rightArm };
  }

  // Pose o árbitro perto do lutador caído: contando (braço batendo pra baixo em ritmo,
  // curvado sobre o lutador) ou, no nocaute definitivo, com os dois braços cruzados
  // acima da cabeça — o gesto clássico de "a luta acabou".
  function poseReferee(matchState, timeMs) {
    if (!referee) return;
    const [fA, fB] = matchState.fighters;
    const down = fA.knockdown ? fA : fB.knockdown ? fB : null;
    if (!down) { referee.root.visible = false; return; }
    referee.root.visible = true;
    const t = timeMs / 1000;
    const dir = down === fA ? -1 : 1; // fica do lado de dentro do ringue, virado pro lutador caído
    referee.root.position.x = toWorldX(down.x) + dir * 0.4;
    referee.root.position.z = 1.35;
    referee.root.rotation.y = dir === 1 ? Math.PI / 2 + 0.3 : -Math.PI / 2 - 0.3;

    referee.leftArm.shoulder.rotation.set(0, 0, 0);
    referee.rightArm.shoulder.rotation.set(0, 0, 0);
    referee.leftArm.elbow.rotation.set(0, 0, 0);
    referee.rightArm.elbow.rotation.set(0, 0, 0);
    referee.headGroup.rotation.set(0, 0, 0);

    if (down.knockdown && down.knockdown.ko) {
      // nocaute definitivo: braços cruzados erguidos acima da cabeça
      referee.leftArm.shoulder.rotation.set(2.5, 0, 0.5);
      referee.rightArm.shoulder.rotation.set(2.5, 0, -0.5);
      referee.hips.rotation.y = 0;
      referee.root.position.y = 0;
    } else {
      // contagem: curvado sobre o lutador, braço descendo e subindo em ritmo de "1, 2, 3..."
      const bob = Math.sin(t * 3.2) * 0.5 + 0.5; // 0..1
      referee.hips.rotation.x = 0.35;
      referee.headGroup.rotation.x = 0.15;
      referee.rightArm.shoulder.rotation.set(1.6 - bob * 1.3, 0, 0);
      referee.rightArm.elbow.rotation.set(-0.3, 0, 0);
      referee.leftArm.shoulder.rotation.set(0.6, 0, 0.2);
      referee.root.position.y = 0;
    }
  }

  // ---------------- API pública ----------------
  async function init(canvas, w, h) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    // Sombras dinâmicas são o maior custo de GPU desta cena e não são essenciais para a
    // leitura do combate — desligadas para manter o ritmo do jogo estável em celulares e
    // em renderização por software (sem isso, o relógio da luta pode ficar mais lento que
    // o tempo real quando o navegador não consegue desenhar a 60fps).
    renderer.shadowMap.enabled = false;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05050a);
    scene.fog = new THREE.Fog(0x05050a, 9, 22);
    camera = new THREE.PerspectiveCamera(44, w / h, 0.1, 100);
    camera.position.set(0, 2.3, 6.2);
    camera.lookAt(0, 1.25, 0);
    baseCamPos = camera.position.clone();

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.PointLight(0xfff1c8, 0.6, 20);
    rim.position.set(-4, 3, -3);
    scene.add(rim);
    const crowdLight = new THREE.PointLight(0x8899ff, 0.5, 26);
    crowdLight.position.set(0, 5, -6);
    scene.add(crowdLight);

    await loadPalette();
    ringGroup = buildRing();
    scene.add(ringGroup);

    if (!toonGradientMap) toonGradientMap = makeToonGradientMap();
    referee = buildReferee();
    scene.add(referee.root);
    const refereeLight = new THREE.PointLight(0xffffff, 1.4, 6);
    refereeLight.position.set(0, 2.4, 2.2);
    referee.root.add(refereeLight);
    referee.light = refereeLight;

    return true;
  }

  // ---------------- Efeitos de impacto (tremor de câmera + faíscas) ----------------
  const fx = { shakeUntil: 0, shakeMag: 0, sparks: [] };
  let sparkTex = null;
  let baseCamPos = null;

  function getSparkTexture() {
    if (sparkTex) return sparkTex;
    const c = document.createElement("canvas");
    c.width = 64; c.height = 64;
    const ctx = c.getContext("2d");
    const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,246,150,1)");
    grd.addColorStop(1, "rgba(255,246,150,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 64, 64);
    sparkTex = new THREE.CanvasTexture(c);
    return sparkTex;
  }

  function triggerHitFX(arenaX, big) {
    const now = performance.now();
    fx.shakeUntil = now + (big ? 260 : 130);
    fx.shakeMag = big ? 0.09 : 0.04;
    const worldX = toWorldX(arenaX);
    const n = big ? 9 : 5;
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({ map: getSparkTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(worldX, 1.25 + (Math.random() - 0.5) * 0.2, 0.2);
      sprite.scale.setScalar(0.18 + Math.random() * 0.12);
      scene.add(sprite);
      const ang = Math.random() * Math.PI * 2;
      fx.sparks.push({ sprite, vx: Math.cos(ang) * 1.6, vy: Math.sin(ang) * 1.6 + 1, born: now });
    }
  }

  function updateFX(timeMs) {
    if (baseCamPos && timeMs < fx.shakeUntil) {
      const k = (fx.shakeUntil - timeMs) / 260;
      camera.position.x = baseCamPos.x + (Math.random() - 0.5) * fx.shakeMag * k;
      camera.position.y = baseCamPos.y + (Math.random() - 0.5) * fx.shakeMag * k;
    } else if (baseCamPos) {
      camera.position.copy(baseCamPos);
    }
    fx.sparks = fx.sparks.filter((s) => {
      const age = timeMs - s.born;
      if (age > 420) { scene.remove(s.sprite); s.sprite.material.dispose(); return false; }
      const t = age / 420;
      s.sprite.position.x += s.vx * 0.01;
      s.sprite.position.y += (s.vy - t * 4) * 0.01;
      s.sprite.material.opacity = 1 - t;
      return true;
    });
  }

  function resize(w, h) {
    if (!renderer) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render(matchState, timeMs) {
    if (!renderer || !matchState) return;
    const [fA, fB] = matchState.fighters;
    const rigA = ensureRig(0, fA.characterId);
    const rigB = ensureRig(1, fB.characterId);
    poseRig(rigA, fA, fB.x, timeMs);
    poseRig(rigB, fB, fA.x, timeMs);
    poseReferee(matchState, timeMs);
    updateFX(timeMs);
    renderer.render(scene, camera);
  }

  return { init, resize, render, triggerHitFX };
})();

window.Render3D = Render3D;
