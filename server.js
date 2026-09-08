const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let tiktokLiveConnection = null;
let activeStreamer = "";

function connectToTikTok(username) {
  const cleanUsername = username.replace('@', '').trim().toLowerCase();

  if (!cleanUsername) return;

  // Se já estiver conectado no mesmo usuário, ignora
  if (tiktokLiveConnection && activeStreamer === cleanUsername) {
    console.log(`⚠️ Já conectado à live de @${cleanUsername}`);
    return;
  }

  // Desconecta live anterior com segurança
  if (tiktokLiveConnection) {
    try {
      tiktokLiveConnection.disconnect();
      console.log(`🔌 Desconectado da live anterior (@${activeStreamer})`);
    } catch (err) {
      console.error("Erro ao desconectar:", err);
    }
    tiktokLiveConnection = null;
  }

  activeStreamer = cleanUsername;
  console.log(`📡 Tentando conectar à live de: @${activeStreamer}...`);

  // Cria nova conexão configurada para evitar bloqueios do TikTok
  tiktokLiveConnection = new WebcastPushConnection(activeStreamer, {
    processInitialData: false,
    enableExtendedGiftInfo: true,
    requestPollingIntervalMs: 2000,
    clientParams: {
      "app_language": "pt-BR",
      "device_platform": "web"
    }
  });

  tiktokLiveConnection.connect().then(state => {
    console.log(`✅ CONECTADO com sucesso à live de @${activeStreamer} (Room ID: ${state.roomId})`);
    io.emit('statusUpdate', { status: 'connected', streamer: activeStreamer });
  }).catch(err => {
    console.error(`❌ Falha ao conectar em @${activeStreamer}:`, err.message || err);
    io.emit('statusUpdate', { status: 'error', message: 'Live offline ou não encontrada' });
  });

  // OUVINTE DE PRESENTES (GIFTS)
  tiktokLiveConnection.on('gift', data => {
    // Evita duplicação de presentes contínuos (combos) até finalizarem
    if (data.giftType === 1 && data.repeatEnd === false) {
      return;
    }

    const giftCoins = (data.diamondCount || 1) * (data.repeatCount || 1);
    const donorUser = data.uniqueId;

    console.log(`🎁 [GIFT] @${donorUser} enviou ${giftCoins} moedas na live de @${activeStreamer}`);

    // Dispara presente para o admin em tempo real
    io.emit('giftReceived', {
      username: donorUser,
      coins: giftCoins,
      streamer: activeStreamer
    });
  });

  tiktokLiveConnection.on('streamEnd', () => {
    console.log(`🔴 Live de @${activeStreamer} foi encerrada.`);
    io.emit('statusUpdate', { status: 'ended', streamer: activeStreamer });
  });
}

// CONEXÃO VIA SOCKET.IO COM O PAINEL
io.on('connection', (socket) => {
  console.log(`⚡ Cliente conectado ao Socket: ${socket.id}`);

  // Se já houver um streamer ativo, informa o novo cliente
  if (activeStreamer) {
    socket.emit('statusUpdate', { status: 'connected', streamer: activeStreamer });
  }

  // Evento vindo do painel admin ao clicar em "ALTERAR / CONECTAR LIVE"
  socket.on('setLiveUser', (data) => {
    if (data && data.username) {
      connectToTikTok(data.username);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor escutando na porta ${PORT}`);
});
