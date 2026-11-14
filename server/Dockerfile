# Imagem para publicar o servidor multiplayer (WebSocket autoritativo) de La Velada Boxing.
# Build a partir da RAIZ do repositório (precisa enxergar ../shared):
#   docker build -f server/Dockerfile -t la-velada-boxing-server .
#   docker run -p 8787:8787 -e ALLOWED_ORIGINS=https://seu-cliente.exemplo.com la-velada-boxing-server
FROM node:20-alpine

WORKDIR /app
COPY shared ./shared
COPY client ./client
COPY assets ./assets
COPY server ./server
WORKDIR /app/server
RUN npm install --omit=dev --no-audit --no-fund

ENV PORT=8787
EXPOSE 8787
CMD ["node", "server.js"]
