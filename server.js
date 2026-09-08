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

  // Se ja estiver conectado no mesmo usuario, ignora
  if (tiktokLiveConnection && activeStreamer === cleanUsername) {
    console.log(`⚠️ Ja conectado a live de @${cleanUsername}`);
    return;
  }

  // Desconecta live anterior com seguranca
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
  console.log(`📡 Tentando conectar a live de: @${activeStreamer}...`);

  // Cria nova conexao configurada para evitar bloqueios do TikTok
  tiktokLiveConnection = new WebcastPushConnection(activeStreamer, {
    processInitialData: false,
    enableExtendedGiftInfo: true,
    requestPollingIntervalMs: 1000,
    clientParams: {
      "app_language": "pt-BR",
      "device_platform": "web",
      "webcast_language": "pt-BR"
    },
    requestOptions: {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      }
    }
  });

  tiktokLiveConnection.connect().then(state => {
    console.log(`✅ CONECTADO com sucesso a live de @${activeStreamer} (Room ID: ${state.roomId})`);
    io.emit('statusUpdate', { status: 'connected', streamer: activeStreamer });
  }).catch(err => {
    console.error(`❌ Falha ao conectar em @${activeStreamer}:`, err.message || err);
    io.emit('statusUpdate', { status: 'error', message: 'Live offline ou nao encontrada' });
  });

  // OUVINTE DE PRESENTES (GIFTS) REVISADO
  tiktokLiveConnection.on('gift', data => {
    const donorUser = data.uniqueId || data.nickname;
    if (!donorUser) return;

    // Se for presente continuo (combo) e ainda nao acabou, aguarda finalizar
    if (data.giftType === 1 && data.repeatEnd === false) {
      return; 
    }

    const diamondUnit = data.diamondCount || data.diamond_count || data.gift?.diamond_count || 1;
    const count = data.repeatCount || data.repeat_count || 1;
    const giftCoins = diamondUnit * count;

    console.log(`🎁 [PRESENTE RECONHECIDO] @${donorUser} enviou ${giftCoins} moeda(s)`);

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

// CONEXAO VIA SOCKET.IO COM O PAINEL
io.on('connection', (socket) => {
  console.log(`⚡ Cliente conectado ao Socket: ${socket.id}`);

  if (activeStreamer) {
    socket.emit('statusUpdate', { status: 'connected', streamer: activeStreamer });
  }

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
