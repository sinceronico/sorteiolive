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

  // Configuração avançada de conexão
  tiktokLiveConnection = new WebcastPushConnection(activeStreamer, {
    processInitialData: true,
    enableExtendedGiftInfo: true,
    requestPollingIntervalMs: 1000,
    clientParams: {
      "app_language": "pt-BR",
      "device_platform": "web",
      "webcast_language": "pt-BR"
    },
    requestOptions: {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
      }
    }
  });

  tiktokLiveConnection.connect().then(state => {
    console.log(`✅ CONECTADO à live de @${activeStreamer} (Room ID: ${state.roomId})`);
    io.emit('statusUpdate', { status: 'connected', streamer: activeStreamer });
  }).catch(err => {
    console.error(`❌ Falha ao conectar em @${activeStreamer}:`, err.message || err);
    io.emit('statusUpdate', { status: 'error', message: 'Live offline ou não encontrada' });
  });

  // OUVINTE DE PRESENTES (GIFTS)
  tiktokLiveConnection.on('gift', data => {
    // Tenta pegar o nome do usuário por diferentes propriedades possíveis
    const donorUser = data.uniqueId || data.nickname || (data.userDetails && data.userDetails.uniqueId);
    
    // Log para depurar se o pacote está chegando
    console.log(`📦 [EVENTO GIFT BRUTO CHEGOU]: Doador: ${donorUser} | Tipo: ${data.giftType} | RepeatEnd: ${data.repeatEnd}`);

    if (!donorUser) return;

    // Se for presente contínuo/combo e ainda não terminou a animação, ignora
    if (data.giftType === 1 && data.repeatEnd === false) {
      return;
    }

    // Cálculo das moedas
    const diamondUnit = data.diamondCount || data.diamond_count || (data.gift && data.gift.diamond_count) || 1;
    const count = data.repeatCount || data.repeat_count || 1;
    const giftCoins = diamondUnit * count;

    console.log(`🎁 [PRESENTE COMPUTADO] @${donorUser} enviou ${giftCoins} moeda(s) (Presente: ${data.giftName || 'Desconhecido'})`);

    // Dispara via Socket.IO para o painel
    io.emit('giftReceived', {
      username: donorUser,
      coins: giftCoins,
      streamer: activeStreamer
    });
  });

  // Teste de recebimento de chat/interação na live
  tiktokLiveConnection.on('chat', data => {
    console.log(`💬 [CHAT] @${data.uniqueId}: ${data.comment}`);
  });

  tiktokLiveConnection.on('streamEnd', () => {
    console.log(`🔴 Live de @${activeStreamer} foi encerrada.`);
    io.emit('statusUpdate', { status: 'ended', streamer: activeStreamer });
  });
}

// CONEXÃO VIA SOCKET.IO COM O PAINEL
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
