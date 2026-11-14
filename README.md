# LA VELADA BOXING

Jogo de boxe web, 9 lutadores inspirados na Velada del Año, com multiplayer online real (sala privada, dois jogadores, servidor autoritativo), treinamento contra IA e 2 jogadores no mesmo teclado.

## O que já funciona (testado de verdade nesta entrega)

- **Motor de combate** (`shared/engine.js`): movimento, jab/direto/ganchos, guarda, esquiva, stamina, dano por região (cabeça/corpo), knockdown com contagem até 10, nocaute, 3 rounds, decisão por pontos, empate, 9 habilidades especiais. **7 testes automatizados passando** (`node tests/engine.test.js`), incluindo "guarda reduz dano", "fora de alcance não acerta", "knockdown → nocaute se não levantar".
- **Multiplayer real** (`server/server.js` + `client/net.js`): testado com **dois clientes WebSocket de verdade** conectados ao servidor rodando (`node tests/multiplayer.test.js`) — criação de sala, código de 6 caracteres, entrada por código em outra conexão, terceiro jogador corretamente bloqueado como lutador, seleção de personagem sincronizada, início só quando os dois confirmam "pronto", estado de combate autoritativo transmitido ao cliente a 20Hz, aviso de "oponente saiu" ao desconectar.
- **Interface completa** (tela inicial → modo → lobby/sala → seleção de personagem → VS/contagem → luta → pós-luta → configurações/ajuda), testada com **Playwright em dois contextos de navegador simultâneos** (simulando dois dispositivos, um deles em viewport mobile) — **zero erros de console** nas três sessões testadas (treinamento + multiplayer A + multiplayer B). Capturas de tela da luta, seleção de personagem e sala confirmam a renderização do ringue "VELADA DEL AÑO", barras de vida/stamina/especial e sincronização dos nomes dos dois jogadores.
- **Renderização 3D real** (`client/render3d.js`, Three.js/WebGL, vendorizado localmente em `client/vendor/three/`): o ringue, as cordas, os postes, o telão e a plateia são geometria 3D de verdade (não imagem de fundo), com câmera posicionada em 3/4 para manter o rosto dos dois lutadores legível durante o combate.
- **Ringue 3D com plateia**: piso, 3 fileiras de cordas, 4 postes vermelho/azul com bandeiras "VELADA DEL AÑO", telão suspenso com o nome do evento, e uma plateia real em 3D (`THREE.InstancedMesh`, ~56 figuras em arquibancada nos 3 lados do ringue fora das cordas) — não é mais uma textura plana de fundo.
- **Visual mais próximo das caricaturas de referência**: sombreamento "toon" (faixas de luz chapadas, `MeshToonMaterial`, em vez de iluminação realista) e contorno preto grosso em cada peça do corpo (técnica de "casco invertido" — clone da malha, ligeiramente maior, renderizado por dentro), para lembrar o traço das ilustrações enviadas. Cabeça ~16% maior e pernas ~10% mais curtas que um corpo realista, aproximando da proporção "cabeça grande" das caricaturas.
- **9 "bonecos" 3D articulados** (um rig de braços/pernas/cabeça por junta real, não um sprite 2D): cada um usa a foto real do personagem (recortada das referências enviadas) como textura do rosto na cabeça, e as cores do corpo (camisa, calça, luvas, pele, cabelo) extraídas visualmente de cada referência (`assets/characters/palette.json`). Animações (socos, guarda, esquiva, andar, provocação, atordoado, caído) são poses reais do esqueleto, não troca de imagem.
- **Áudio e efeitos de impacto** (`client/audio.js`, `assets/audio/*.wav`): sons de soco (variam por tipo: jab/direto/gancho), guarda, esquiva, sino de round, contagem, nocaute, vitória e ativação de especial, mais ambiente de torcida — **todos sintetizados por código** (`scripts/make_audio.py`, não incluído no pacote de entrega; os `.wav` já gerados estão em `assets/audio/`), sem usar nenhum áudio de terceiros. Tela cheia de flash branco + tremor de tela + faíscas nos acertos. Botão de mudo no menu e durante a luta.
- **Servidor pronto para publicar de verdade, servindo TUDO sozinho**: o mesmo processo Node (`server/server.js`) agora também serve os arquivos do cliente (`client/`, `shared/`, `assets/`) — publicando **um único serviço** você já tem um link único pra mandar pro outro jogador, sem precisar de um segundo host estático nem editar `client/config.js` (o cliente detecta sozinho o endereço do servidor pela própria URL da página). `Dockerfile`, `render.yaml` (Render) e `fly.toml` (Fly.io) incluídos, com health-check HTTP real (`GET /` responde 200) — ver seção de publicação abaixo.
- **Deploy de serviço único testado de verdade**: com o servidor rodando sozinho numa porta (simulando exatamente o que acontece no Render/Fly), **dois navegadores reais** (um em viewport de desktop, outro em viewport de celular) abriram a MESMA url, um criou sala e o outro entrou pelo código, cada um escolheu um personagem diferente e a partida avançou sincronizada pros dois — sem nenhuma configuração manual e sem erros de console nos dois.

## O que é placeholder / ainda não está pronto

- **Rosto dos "bonecos"**: não é um rosto esculpido em 3D (reconstrução facial real a partir de 1 foto 2D exigiria um pipeline de fotogrametria/geração de malha que não está disponível aqui) — é a foto real do personagem aplicada como textura na face frontal de uma cabeça em caixa articulada. Para isso ficar legível, a câmera e o giro do lutador foram ajustados para um ângulo de 3/4 (não perfil puro); de frente ou de perfil total o rosto perderia a textura.
- **Torneio**: ainda não implementado (o botão mostra um aviso). Treinamento e Multiplayer estão completos.
- **Controles touch (mobile)**: implementados no HTML/CSS/JS (joystick + botões), mas **não foram testados em um dispositivo touch real** nesta entrega — só verificados em navegador desktop/emulado sem toque. Testar num celular real antes de confiar neles.
- **Dois dispositivos físicos diferentes / duas redes diferentes pela internet**: o teste real feito aqui usa dois *processos de navegador* (um deles com viewport de celular) na mesma máquina, conectados ao mesmo servidor — isso prova que o protocolo, a lógica de sala e o deploy de serviço único funcionam de ponta a ponta, mas **não prova** latência/comportamento em duas redes/dispositivos físicos distintos pela internet de verdade. Isso só se confirma publicando o servidor (seção abaixo) e testando com duas pessoas reais, em lugares diferentes.
- **Hospedagem real**: o `Dockerfile` foi escrito e revisado com cuidado (estrutura de pastas e `require("../shared/...")` conferem), mas **não pôde ser testado com `docker build`** neste ambiente — não há daemon Docker disponível aqui. `render.yaml` e `fly.toml` são templates para você usar nessas plataformas; nenhuma URL pública foi criada (eu não tenho como criar conta/credenciais em serviços de hospedagem por você). Veja a seção de publicação para o passo a passo.

## Como rodar localmente

Requisitos: Node.js 18+.

**Mais simples (um processo só — o servidor já serve o jogo):**
```bash
cd server
npm install
npm start
# abra http://localhost:8787/
```

**Alternativa (dois processos separados, útil se for editar só o front-end):**
```bash
cd server && npm install && npm start   # servidor na porta 8787
# em outro terminal:
python3 -m http.server 8080             # cliente estático na porta 8080
# abra http://localhost:8080/client/index.html
```

Para testar o multiplayer sozinho: abra a URL em **duas abas/janelas** (ou dois navegadores). Numa, clique em Multiplayer → Criar sala, copie o código. Na outra, Multiplayer → Entrar com código. O cliente detecta sozinho o endereço do servidor pela própria URL da página (`client/net.js`) — só precisa editar `client/config.js` se for publicar o cliente num host separado do servidor (ver seção de publicação).

## Testes

```bash
# Motor de combate (sem rede) — 7 testes
node tests/engine.test.js

# Fluxo multiplayer ponta a ponta com DOIS clientes WebSocket reais
node tests/multiplayer.test.js
```

## Controles

**Desktop (treinamento / multiplayer, um jogador por dispositivo):**
A/D mover · clique esquerdo Jab · clique direito Direto · Q gancho esquerdo · E gancho direito · F (segurar) guarda · Espaço esquiva · Shift avanço rápido · R especial · T provocar.

**2 jogadores no mesmo teclado:**
Jogador 1 — A/D mover, S guarda, W esquiva, 1 Jab, 2 Direto, 3 Gancho E, 4 Gancho D, 5 Especial, 6 Provocar.
Jogador 2 — Setas mover, ↓ guarda, ↑ esquiva, J Jab, K Direto, N Gancho E, M Gancho D, O Especial, P Provocar.

## Jogar com outra pessoa pelo celular

### Opção rápida — testar agora, sem publicar nada (mesma casa/Wi-Fi)

Serve só pra testar com alguém que está no mesmo lugar que você (mesma rede Wi-Fi), não funciona com alguém em outra cidade/rede — pra isso veja "Publicar de verdade" abaixo.

1. No computador onde o servidor está rodando (`cd server && npm install && npm start`), descubra o IP local da máquina na rede (no Windows: `ipconfig`; Mac/Linux: `ifconfig` ou `ip addr`) — algo como `192.168.0.12`.
2. No celular (conectado ao **mesmo Wi-Fi**), abra o navegador e acesse `http://192.168.0.12:8787/` (troque pelo IP real). O jogo carrega direto — é o mesmo servidor servindo tudo.
3. No outro celular/computador, acesse o **mesmo endereço**. Um cria a sala (Multiplayer → Criar sala), manda o código ou o link (botão "Copiar link de convite") pro outro, que entra com o código.

### Publicar de verdade — jogar com qualquer pessoa, de qualquer lugar

Só precisa publicar **UM serviço** (o servidor também serve o jogo inteiro — não precisa de um segundo host nem editar nenhum arquivo de configuração).

**Render (recomendado — tem plano grátis, sem cartão de crédito):**
1. Suba este projeto inteiro (com as pastas `shared/`, `server/`, `client/`, `assets/`) para um repositório no GitHub.
2. Em [render.com](https://render.com), crie uma conta e clique em **New → Blueprint**, apontando pro seu repositório. Ele lê `server/render.yaml` sozinho e já sobe certo (porta, health-check, build).
3. Espere o deploy terminar (alguns minutos) e pegue a URL pública que o Render te dá, algo como `https://la-velada-boxing-server.onrender.com`.
4. Pronto: **essa URL É o jogo**. Mande ela pra outra pessoa (por WhatsApp, por exemplo) — cada um abre no celular, um cria a sala, manda o código/link pro outro, e jogam.

> No plano grátis do Render o serviço "dorme" depois de um tempo sem uso e demora ~30-50s pra acordar no primeiro acesso do dia — é normal, não é erro. Depois de acordado fica rápido.

**Fly.io (alternativa):**
```bash
fly launch --config server/fly.toml --dockerfile server/Dockerfile --no-deploy
fly deploy --config server/fly.toml --dockerfile server/Dockerfile
```

**VPS/Docker manual (qualquer servidor com Docker):**
```bash
docker build -f server/Dockerfile -t la-velada-boxing-server .
docker run -d -p 8787:8787 la-velada-boxing-server
```
> Nota: o `Dockerfile` foi revisado linha a linha mas não pôde ser executado (`docker build`) neste ambiente por falta do daemon Docker — teste o build antes de confiar cegamente nele em produção.

Em qualquer opção, se quiser travar pra só o seu domínio poder conectar na sala (opcional, mais seguro), configure a variável de ambiente `ALLOWED_ORIGINS` com a URL exata do serviço publicado.

### O que foi validado de verdade nesta entrega

Com o servidor rodando sozinho numa porta — exatamente como fica no Render/Fly — **dois navegadores reais** (um em viewport de celular) abriram a mesma URL, um criou sala e o outro entrou pelo código, escolheram personagens diferentes e a luta começou sincronizada nos dois, sem configuração manual e sem erros de console. Isso prova que o fluxo "um link só, cada um no seu dispositivo" funciona de ponta a ponta.

**O que ainda não foi testado por mim** (preciso que você confirme): duas pessoas reais, em duas redes de internet diferentes de verdade (não a mesma máquina/Wi-Fi), depois do deploy publicado. O comportamento sob latência real de internet só se confirma assim — eu não tenho como criar uma conta no Render por você nem simular duas conexões de internet fisicamente distintas aqui.

## Estrutura

```text
shared/characters.js   — dados dos 9 lutadores (atributos, especiais)
shared/engine.js       — motor de combate determinístico (cliente local + servidor)
client/                — HTML/CSS/JS do jogo (sem build step)
server/                — servidor WebSocket autoritativo (Node + ws)
client/render3d.js     — cena 3D (ringue, plateia, telão, rigs articulados dos lutadores) em Three.js
client/vendor/three/   — Three.js r0.160.0 vendorizado (ES module, sem CDN)
assets/characters/<id>/ — reference.png (original do usuário), sprite.png, thumb.png, face_texture.png (recorte do rosto p/ textura 3D)
assets/characters/palette.json — cores do corpo (pele/cabelo/camisa/calça/sapato/luva) de cada personagem, curadas visualmente a partir das referências
tests/                 — testes automatizados (motor + integração multiplayer)
```
