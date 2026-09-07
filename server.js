const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const httpServer = createServer(app);

// Configuração do Socket.IO com permissão CORS
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// SUBSTIUA PELO SEU NOME DE USUÁRIO DO TIKTOK (SEM O @)
const TIKTOK_USERNAME = "sinceronico";

// Conexão com a live do TikTok
let tiktokLiveConnection = new WebcastPushConnection(TIKTOK_USERNAME);

tiktokLiveConnection.connect().then(state => {
  console.log(`Conectado com sucesso à live de @${TIKTOK_USERNAME}`);
}).catch(err => {
  console.error('Erro ao conectar na live:', err);
});

// Escuta envio de presentes na live
tiktokLiveConnection.on('gift', data => {
  // Ignora se o presente ainda estiver na animação de combo e não finalizado
  if (data.giftType === 1 && data.repeatEnd === 0) return;

  const coins = data.diamondCount * data.repeatCount;
  
  // Envia a informação para o site (index.html)
  io.emit('giftReceived', {
    username: data.uniqueId,
    coins: coins
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
