# Inventário de assets — personagens

Todas as imagens de referência foram enviadas pelo usuário em 2026-11-14 e preservadas sem alteração em `reference.png` dentro da pasta de cada personagem. Os arquivos `sprite.png`, `sprite_mirrored.png` e `thumb.png` são **derivados automáticos** (recorte + redimensionamento da própria referência, sem geração de conteúdo novo) e servem como placeholder jogável até que um pipeline de animação definitivo (spritesheet ou rig por ossos) seja produzido.

| Personagem (slug)   | Nome exibido     | Arquivo original (upload)        | reference.png | sprite.png | thumb.png |
|---------------------|------------------|-----------------------------------|:---:|:---:|:---:|
| jh-de-la-cruz        | JH de la Cruz    | 318f61d8-image.png                | ✅ | ✅ | ✅ |
| fernanfloo           | Fernanfloo       | 0b844e7e-image.png                | ✅ | ✅ | ✅ |
| ibai                 | Ibai             | f0f6be7d-image.png                | ✅ | ✅ | ✅ |
| juan-guarnizo        | Juan Guarnizo    | e78eacbe-image.png                | ✅ | ✅ | ✅ |
| auronplay            | AuronPlay        | 435f8dd5-image.png                | ✅ | ✅ | ✅ |
| davo                 | Davo             | 0e8c35ec-image.png                | ✅ | ✅ | ✅ |
| roro                 | Roro             | e7138c34-image.png                | ✅ | ✅ | ✅ |
| rivers               | Rivers           | 8b84c35e-image.png                | ✅ | ✅ | ✅ |
| la-cobra             | La Cobra         | 55f6261e-image.png                | ✅ | ✅ | ✅ |

## Estado da animação

- **Placeholder atual:** cada lutador é a mesma imagem estática (`sprite.png` / `sprite_mirrored.png`, espelhada conforme o lado do ringue) animada **proceduralmente** via transformações CSS/canvas (translação, rotação leve, escala) para idle, avanço, soco, guarda, esquiva, atordoamento e queda. Isso dá leitura clara de gameplay sem inventar frames de desenho que não existem.
- **Não é uma caricatura "final animada"** — para o pipeline definitivo, recomenda-se um spritesheet desenhado (8–12 poses por personagem) ou rig 2D por ossos (ex. Spine/DragonBones) usando a arte de referência como guia de estilo. Isso está fora do escopo desta primeira entrega.
- Pasta de arena (`assets/arena/`) e UI (`assets/ui/`) ainda não têm arte própria; o jogo atual desenha o ringue/plateia/telão em CSS/canvas (gradientes e formas) como placeholder visual.
- Áudio (`assets/audio/`) está vazio; o jogo roda sem som nesta primeira versão.
