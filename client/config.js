// Configuração do cliente. Deixe null (padrão) nos casos normais:
// - Em desenvolvimento local (um processo só, `cd server && npm start`, abrindo
//   http://localhost:8787/) ou publicado como serviço único (Render/Fly/Docker, ver
//   README) o cliente detecta sozinho o endereço do servidor pela própria URL da página
//   (ver client/net.js) — não precisa editar nada aqui.
// - Única exceção: se você publicar o CLIENTE (client/+shared/+assets/) num host estático
//   separado (Netlify/Vercel/GitHub Pages) do servidor multiplayer, defina a URL do
//   servidor aqui:
//   window.MP_SERVER_URL = "wss://la-velada-boxing-server.onrender.com";
window.MP_SERVER_URL = null;
