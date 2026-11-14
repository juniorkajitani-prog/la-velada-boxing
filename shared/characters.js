// Dados dos 9 lutadores. Compartilhado entre cliente (browser) e servidor (Node).
// Os atributos (0-100) são ponto de partida para balanceamento de jogo,
// não afirmações sobre as capacidades reais das pessoas reais que inspiram os nomes.

const CHARACTERS = [
  {
    id: "jh-de-la-cruz",
    name: "JH de la Cruz",
    stats: { strength: 92, speed: 65, dodge: 60, endurance: 85, cardio: 70, accuracy: 65 },
    special: { id: "modo-destruicao", name: "Modo Destruição", desc: "Potência de soco muito aumentada por tempo limitado." }
  },
  {
    id: "ibai",
    name: "Ibai",
    stats: { strength: 90, speed: 40, dodge: 35, endurance: 100, cardio: 65, accuracy: 60 },
    special: { id: "ultimo-sobrevivente", name: "Último Sobrevivente", desc: "Bônus ofensivo e defensivo quando a vida está baixa." }
  },
  {
    id: "fernanfloo",
    name: "Fernanfloo",
    stats: { strength: 65, speed: 95, dodge: 95, endurance: 65, cardio: 90, accuracy: 90 },
    special: { id: "caos-total", name: "Caos Total", desc: "Mobilidade e troca de direção extremas por tempo limitado." }
  },
  {
    id: "juan-guarnizo",
    name: "Juan Guarnizo",
    stats: { strength: 70, speed: 85, dodge: 90, endurance: 65, cardio: 90, accuracy: 95 },
    special: { id: "leitura-do-adversario", name: "Leitura do Adversário", desc: "Recompensa (dano/precisão) quando o oponente repete o mesmo golpe." }
  },
  {
    id: "auronplay",
    name: "AuronPlay",
    stats: { strength: 65, speed: 65, dodge: 85, endurance: 85, cardio: 90, accuracy: 85 },
    special: { id: "sangue-frio", name: "Sangue Frio", desc: "Reduz consumo de fôlego e melhora recuperação defensiva." }
  },
  {
    id: "davo",
    name: "Davo",
    stats: { strength: 95, speed: 85, dodge: 60, endurance: 65, cardio: 70, accuracy: 70 },
    special: { id: "modo-hype", name: "Modo Hype", desc: "Acertos consecutivos aumentam velocidade e potência temporariamente." }
  },
  {
    id: "la-cobra",
    name: "La Cobra",
    stats: { strength: 85, speed: 90, dodge: 95, endurance: 65, cardio: 75, accuracy: 95 },
    special: { id: "cacador", name: "Caçador", desc: "Esquiva bem-sucedida abre janela de contra-ataque com bônus." }
  },
  {
    id: "roro",
    name: "Roro",
    stats: { strength: 65, speed: 100, dodge: 95, endurance: 60, cardio: 95, accuracy: 90 },
    special: { id: "combo-perfeito", name: "Combo Perfeito", desc: "Combos consecutivos sem levar dano aumentam o multiplicador de dano." }
  },
  {
    id: "rivers",
    name: "Rivers",
    stats: { strength: 85, speed: 85, dodge: 70, endurance: 90, cardio: 90, accuracy: 75 },
    special: { id: "espirito-de-campea", name: "Espírito de Campeã", desc: "Bônus moderado de recuperação de vida/fôlego quando em desvantagem." }
  }
];

function getCharacter(id) {
  return CHARACTERS.find((c) => c.id === id) || null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CHARACTERS, getCharacter };
}
if (typeof window !== "undefined") {
  window.CHARACTERS = CHARACTERS;
  window.getCharacter = getCharacter;
}
