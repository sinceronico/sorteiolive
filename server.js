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

function connectToTikTok(username, sessionId = "") {
  const cleanUsername = username.replace('@', '').trim().toLowerCase();

  if (!cleanUsername) return;

  // Desconecta live anterior se houver
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
  const hasSession = sessionId && sessionId.trim() !== "";
  console.log(`📡 Tentando conectar à live de: @${activeStreamer}${hasSession ? ' (Com Session ID)' : ' (Sem Session ID)'}...`);

  // Monta as opções de conexão
  const connectionOptions = {
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
  };

  if (hasSession) {
    connectionOptions.sessionId = sessionId.trim();
  }

  tiktokLiveConnection = new WebcastPushConnection(activeStreamer, connectionOptions);

  tiktokLiveConnection.connect().then(state => {
    console.log(`✅ CONECTADO à live de @${activeStreamer} (Room ID: ${state.roomId})`);
    io.emit('statusUpdate', { status: 'connected', streamer: activeStreamer });
  }).catch(err => {
    console.error(`❌ Falha ao conectar em @${activeStreamer}:`, err.message || err);
    io.emit('statusUpdate', { status: 'error', message: err.message || 'Live offline ou não encontrada' });
  });

  // Captura de Presentes
  tiktokLiveConnection.on('gift', data => {
    const donorUser = data.uniqueId || data.nickname || (data.userDetails && data.userDetails.uniqueId);

    if (!donorUser) return;

    // Se for presente contínuo (combo) e não finalizou a contagem, aguarda
    if (data.giftType === 1 && data.repeatEnd === false) {
      return;
    }

    const diamondUnit = data.diamondCount || data.diamond_count || (data.gift && data.gift.diamond_count) || 1;
    const count = data.repeatCount || data.repeat_count || 1;
    const giftCoins = diamondUnit * count;

    console.log(`🎁 [PRESENTE RECONHECIDO] @${donorUser} enviou ${giftCoins} moeda(s) (Item: ${data.giftName || 'Presente'})`);

    io.emit('giftReceived', {
      username: donorUser,
      coins: giftCoins,
      streamer: activeStreamer
    });
  });

  // Monitor do Chat no terminal para depuração
  tiktokLiveConnection.on('chat', data => {
    console.log(`💬 [@${data.uniqueId}]: ${data.comment}`);
  });

  tiktokLiveConnection.on('streamEnd', () => {
    console.log(`🔴 Live de @${activeStreamer} foi encerrada.`);
    io.emit('statusUpdate', { status: 'ended', streamer: activeStreamer });
  });
}

// Socket.io Handlers
io.on('connection', (socket) => {
  console.log(`⚡ Cliente conectado ao Socket: ${socket.id}`);

  if (activeStreamer) {
    socket.emit('statusUpdate', { status: 'connected', streamer: activeStreamer });
  }

  socket.on('setLiveUser', (data) => {
    if (data && data.username) {
      connectToTikTok(data.username, data.sessionId || "");
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor escutando na porta ${PORT}`);
});
