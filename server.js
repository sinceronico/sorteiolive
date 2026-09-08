const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

// 1. Inicializa o App Express
const app = express();

// 2. Configura os Middlewares
app.use(express.json());
app.use(express.static(__dirname)); // Serve arquivos estáticos como o admin.html

// 3. Cria o Servidor HTTP e Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Variáveis de controle de conexão
let tiktokLiveConnection = null;
let activeStreamer = "";

// ==========================================
// ROTA DE WEBHOOK DO TIKFINITY
// ==========================================
app.post('/webhook/tikfinity', (req, res) => {
  const data = req.body;

  if (data && (data.event === 'gift' || data.type === 'gift')) {
    const donorUser = data.username || data.nickname || data.uniqueId;
    const coins = data.coins || data.diamondCount || data.repeatCount || 1;

    console.log(`🎁 [WEBHOOK TIKFINITY] @${donorUser} enviou ${coins} moeda(s)!`);

    // Dispara o evento de presente para o admin.html
    io.emit('giftReceived', {
      username: donorUser,
      coins: Number(coins),
      streamer: data.streamer || activeStreamer
    });
  }

  res.status(200).send({ success: true });
});

// ==========================================
// CONEXÃO COM SOCKET.IO (PAINEL ADMIN)
// ==========================================
io.on('connection', (socket) => {
  console.log('📱 Painel conectado ao servidor via WebSocket.');

  // Recebe comando do admin.html para se conectar à live do TikTok
  socket.on('setLiveUser', ({ username, sessionId }) => {
    activeStreamer = username;

    if (tiktokLiveConnection) {
      try {
        tiktokLiveConnection.disconnect();
      } catch (e) {}
    }

    const options = {
      enableExtendedGiftInfo: true
    };

    if (sessionId) {
      options.sessionId = sessionId;
    }

    tiktokLiveConnection = new WebcastPushConnection(username, options);

    tiktokLiveConnection.connect().then(state => {
      console.log(`✅ Conectado à live de @${username} (Room ID: ${state.roomId})`);
      socket.emit('statusUpdate', { status: 'connected', streamer: username });
    }).catch(err => {
      console.error(`❌ Erro ao conectar na live de @${username}:`, err);
      socket.emit('statusUpdate', { status: 'error', message: err.message || 'Falha ao conectar' });
    });

    // Escuta presentes do tiktok-live-connector
    tiktokLiveConnection.on('gift', data => {
      if (data.giftType === 1 && data.repeatEnd === false) {
        return; // Ignora se for combo incompleto
      }

      const totalCoins = (data.diamondCount || 1) * (data.repeatCount || 1);

      io.emit('giftReceived', {
        username: data.uniqueId,
        coins: totalCoins,
        streamer: username
      });
    });

    tiktokLiveConnection.on('streamEnd', () => {
      socket.emit('statusUpdate', { status: 'ended', streamer: username });
    });
  });
});

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR
// ==========================================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando com sucesso na porta ${PORT}`);
});
