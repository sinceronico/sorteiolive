const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let tiktokConnection = null;
let currentUsername = "";

function connectToTikTok(username, socket) {
  // Se já estiver conectado a outra live, desconecta primeiro
  if (tiktokConnection) {
    try {
      tiktokConnection.disconnect();
    } catch (e) {
      console.log("Erro ao desconectar live anterior:", e);
    }
  }

  currentUsername = username;
  console.log(`📡 Tentando conectar à live de: @${username}`);

  tiktokConnection = new WebcastPushConnection(username);

  tiktokConnection.connect().then(state => {
    console.log(`✅ Conectado com sucesso à live de @${username} (RoomId: ${state.roomId})`);
  }).catch(err => {
    console.error(`❌ Erro ao conectar na live de @${username}:`, err);
  });

  // OUVINTE DE PRESENTES (GIFTS)
  tiktokConnection.on('gift', data => {
    // Evita contabilizar presentes em lote ainda não finalizados se a API enviar parcial
    if (data.giftType === 1 && data.repeatEnd === false) {
      return; 
    }

    const coins = (data.diamondCount || 1) * data.repeatCount;
    console.log(`🎁 Presente recebido de @${data.uniqueId}: ${coins} moedas`);

    // Envia para o painel admin e público
    io.emit('giftReceived', {
      username: data.uniqueId,
      coins: coins
    });
  });
}

io.on('connection', (socket) => {
  console.log('⚡ Novo cliente conectado ao Socket:', socket.id);

  // Escuta a ordem do Painel Admin para mudar de live
  socket.on('setLiveUser', (data) => {
    if (data && data.username) {
      const cleanUser = data.username.replace('@', '').trim().toLowerCase();
      if (cleanUser !== currentUsername) {
        connectToTikTok(cleanUser, socket);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
