const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const admin = require('firebase-admin');

// 1. Inicializa o Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://SEU-PROJETO-DEFAULT-RTDB.firebaseio.com" // Substitua pela URL do seu Realtime Database
});

const db = admin.database();
const stateRef = db.ref('raffle_state');

// 2. Estado Global do Servidor
let appState = {
  prize: '',
  coinsPerTicket: 1,
  participants: {},
  availableTicketsPool: []
};

// Algoritmo Fisher-Yates para embaralhamento de bilhetes
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function generateRandomTicketsPool() {
  const numbers = [];
  for (let i = 1000; i < 101000; i++) {
    numbers.push(i);
  }
  return shuffleArray(numbers);
}

// Carrega o estado salvo no Firebase ao iniciar o servidor
async function loadStateFromFirebase() {
  const snapshot = await stateRef.once('value');
  const data = snapshot.val();
  if (data) {
    appState = {
      prize: data.prize || '',
      coinsPerTicket: data.coinsPerTicket || 1,
      participants: data.participants || {},
      availableTicketsPool: data.availableTicketsPool || generateRandomTicketsPool()
    };
  } else {
    appState.availableTicketsPool = generateRandomTicketsPool();
    await saveStateToFirebase();
  }
}

async function saveStateToFirebase() {
  await stateRef.set(appState);
}

loadStateFromFirebase();

// 3. Inicializa Express e Socket.IO
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let tiktokLiveConnection = null;
let activeStreamer = "";

// Função para processar a contribuição
async function processContribution(username, coins) {
  const coinsNum = Number(coins);
  if (!appState.participants[username]) {
    appState.participants[username] = { coins: 0, tickets: [] };
  }

  appState.participants[username].coins += coinsNum;
  const targetTicketsCount = Math.floor(appState.participants[username].coins / appState.coinsPerTicket);

  while (appState.participants[username].tickets.length < targetTicketsCount && appState.availableTicketsPool.length > 0) {
    const randomTicketNumber = appState.availableTicketsPool.pop();
    appState.participants[username].tickets.push(randomTicketNumber);
  }

  await saveStateToFirebase();
  io.emit('stateUpdated', appState);
}

// Webhook TikFinity
const handleTikfinityWebhook = async (req, res) => {
  const donorUser = req.query.username || req.body.username || req.body.uniqueId || req.body.nickname;
  const coins = req.query.coins || req.body.coins || req.body.diamondCount || req.body.repeatCount || 1;

  if (donorUser) {
    console.log(`🎁 [WEBHOOK TIKFINITY] @${donorUser} enviou ${coins} moeda(s)!`);
    await processContribution(donorUser, coins);
    io.emit('giftReceived', { username: donorUser, coins: Number(coins), streamer: activeStreamer });
  }

  res.status(200).send({ success: true });
};

app.post('/webhook/tikfinity', handleTikfinityWebhook);
app.get('/webhook/tikfinity', handleTikfinityWebhook);

// Conexão WebSocket
io.on('connection', (socket) => {
  // Envia o estado atual para novas conexões
  socket.emit('stateUpdated', appState);

  socket.on('updatePrize', async (prizeText) => {
    appState.prize = prizeText;
    await saveStateToFirebase();
    io.emit('stateUpdated', appState);
  });

  socket.on('updateCoinsPerTicket', async (value) => {
    appState.coinsPerTicket = Number(value) || 1;
    await saveStateToFirebase();
    io.emit('stateUpdated', appState);
  });

  socket.on('clearData', async () => {
    appState.participants = {};
    appState.availableTicketsPool = generateRandomTicketsPool();
    await saveStateToFirebase();
    io.emit('stateUpdated', appState);
  });

  socket.on('setLiveUser', ({ username, sessionId }) => {
    activeStreamer = username;
    if (tiktokLiveConnection) {
      try { tiktokLiveConnection.disconnect(); } catch (e) {}
    }

    const options = { enableExtendedGiftInfo: true };
    if (sessionId) options.sessionId = sessionId;

    try {
      tiktokLiveConnection = new WebcastPushConnection(username, options);
      tiktokLiveConnection.connect().then(state => {
        socket.emit('statusUpdate', { status: 'connected', streamer: username });
      }).catch(err => {
        socket.emit('statusUpdate', { status: 'error', message: err.message || 'Falha na conexão.' });
      });

      tiktokLiveConnection.on('gift', async data => {
        if (data.giftType === 1 && data.repeatEnd === false) return;
        const totalCoins = (data.diamondCount || 1) * (data.repeatCount || 1);
        await processContribution(data.uniqueId, totalCoins);
        io.emit('giftReceived', { username: data.uniqueId, coins: totalCoins, streamer: username });
      });
    } catch (err) {
      socket.emit('statusUpdate', { status: 'error', message: 'Erro na conexão direta.' });
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
