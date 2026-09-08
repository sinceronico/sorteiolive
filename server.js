const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TikTokLiveConnector = require('tiktok-live-connector');

// Resolve o construtor correto da biblioteca de forma compatível
const WebcastConnection = TikTokLiveConnector.WebcastPushConnection || TikTokLiveConnector.default || TikTokLiveConnector;

// 1. Inicializa o App Express
const app = express();

// 2. Configura os Middlewares (Interpreta JSON, formulários e arquivos estáticos)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname)); 

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
// ROTA DE WEBHOOK DO TIKFINITY (GET e POST)
// ==========================================
const handleTikfinityWebhook = (req, res) => {
  // Captura dados tanto de parâmetros da URL (?username=...&coins=...) quanto do corpo
  const donorUser = req.query.username || req.body.username || req.body.uniqueId || req.body.nickname;
  const coins = req.query.coins || req.body.coins || req.body.diamondCount || req.body.repeatCount || 1;

  if (donorUser) {
    console.log(`🎁 [WEBHOOK TIKFINITY] @${donorUser} enviou ${coins} moeda(s)!`);

    // Dispara o evento de presente para o admin.html via Socket.IO
    io.emit('giftReceived', {
      username: donorUser,
      coins: Number(coins),
      streamer: activeStreamer
    });
  } else {
    console.log('⚠️ Webhook recebido sem usuário. Query:', req.query, 'Body:', req.body);
  }

  res.status(200).send({ success: true });
};

// Suporte para requisições HTTP GET e POST do TikFinity
app.post('/webhook/tikfinity', handleTikfinityWebhook);
app.get('/webhook/tikfinity', handleTikfinityWebhook);

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

    // Instancia usando a conexão corrigida
    try {
      tiktokLiveConnection = new WebcastConnection(username, options);

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
    } catch (err) {
      console.error(`❌ Erro de inicialização com a live de @${username}:`, err);
      socket.emit('statusUpdate', { status: 'error', message: 'Erro ao inicializar conexão.' });
    }
  });
});

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR
// ==========================================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando com sucesso na porta ${PORT}`);
});
