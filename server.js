const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// 1. Inicializa o Express (Cria a variável 'app')
const app = express();

// 2. Configura os middlewares (agora o 'app' já existe!)
app.use(express.json());
app.use(express.static(__dirname)); // Serve os arquivos estáticos (como admin.html)

// 3. Cria o servidor HTTP e o Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
// Habilita o servidor a ler requisições em formato JSON
app.use(express.json());

// ROTA DE WEBHOOK DO TIKFINITY
app.post('/webhook/tikfinity', (req, res) => {
  const data = req.body;

  // Verifica se o evento recebido é de um presente (Gift)
  if (data && (data.event === 'gift' || data.type === 'gift')) {
    const donorUser = data.username || data.nickname || data.uniqueId;
    const coins = data.coins || data.diamondCount || data.repeatCount || 1;

    console.log(`🎁 [WEBHOOK TIKFINITY] @${donorUser} enviou ${coins} moeda(s)!`);

    // Dispara para o seu painel admin.html via Socket.IO
    io.emit('giftReceived', {
      username: donorUser,
      coins: Number(coins),
      streamer: data.streamer || activeStreamer
    });
  }

  // Responde OK para o TikFinity
  res.status(200).send({ success: true });
});
