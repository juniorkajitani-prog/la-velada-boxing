// IA simples para o modo Treinamento. Gera um objeto de input compatível com Engine.applyInput.
const AI = (() => {
  function makeController(difficulty) {
    const reactionMs = { easy: 450, medium: 260, hard: 120 }[difficulty] || 300;
    const aggression = { easy: 0.25, medium: 0.5, hard: 0.75 }[difficulty] || 0.4;
    let lastDecisionAt = 0;
    let currentInput = {};
    let guardUntil = 0; // a IA segura a guarda só por um tempo curto, depois abaixa

    function decide(self, opponent, nowMs) {
      if (nowMs - lastDecisionAt < reactionMs) return currentInput;
      lastDecisionAt = nowMs;

      const dist = Math.abs(self.x - opponent.x);
      const input = {};
      const guardHold = { easy: 450, medium: 650, hard: 850 }[difficulty] || 600;

      if (self.knockdown) {
        // IA "aperta" o botão em toques separados (alterna), como uma pessoa faria
        input.mash = !currentInput.mash && Math.random() < 0.85;
        return (currentInput = input);
      }

      if (opponent.state === "punch" && opponent.actionPhase !== "recover" && dist < 100) {
        if (Math.random() < 0.5) input.action = "guard";
        else if (Math.random() < 0.5 && self.stats.dodge > 50) input.action = "dodge";
      } else if (dist > 90) {
        input.move = self.x < opponent.x ? "right" : "left";
        if (Math.random() < 0.2) input.action = "advance";
      } else if (dist < 40) {
        input.move = self.x < opponent.x ? "left" : "right";
      } else {
        if (Math.random() < aggression) {
          const moves = ["jab", "jab", "straight", "hookLeft", "hookRight"];
          input.action = moves[Math.floor(Math.random() * moves.length)];
        } else if (Math.random() < 0.3) {
          input.action = "guard";
        }
      }
      if (self.specialMeter >= 100 && Math.random() < 0.4) input.action = "special";
      if (input.action === "guard") {
        if (!self.guard) guardUntil = nowMs + guardHold;
        else if (nowMs >= guardUntil) input.action = "guardOff";
      } else if (!input.action && self.guard && nowMs >= guardUntil) {
        input.action = "guardOff";
      }
      currentInput = input;
      return input;
    }

    return { decide };
  }
  return { makeController };
})();

if (typeof window !== "undefined") window.AI = AI;
