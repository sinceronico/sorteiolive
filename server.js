const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const admin = require('firebase-admin');

// ==========================================
// 1. INICIALIZAÇÃO SEGURA DO FIREBASE ADMIN
// ==========================================
// Não utiliza require('./serviceAccountKey.json') para evitar o erro MODULE_NOT_FOUND no Render.

if (process.env.FIREBASE_PRIVATE_KEY) {
  try {
    const serviceAccount = {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID || "sorteiolive-ec896",
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
    };

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL || "https://sorteiolive-ec896-default-rtdb.firebaseio.com"
    });
    console.log('🔥 Firebase Admin conectado com sucesso via Variáveis de Ambiente!');
  } catch (err) {
    console.error('❌ Erro ao inicializar Firebase Admin:', err.message);
  }
} else {
  console.warn('⚠️ FIREBASE_PRIVATE_KEY não configurada no Render. O servidor executará em memória temporária.');
}

const db = admin.apps.length ? admin.database() : null;
const stateRef = db ? db.ref('raffle_state') : null;

// ==========================================
// 2. ESTADO GLOBAL DO SERVIDOR
// ==========================================
let appState = {
  prize: '',
  coinsPerTicket: 1,
  participants: {},
  availableTicketsPool: []
};

// Embaralhamento Fisher-Yates
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Gera o pool de 100.000 bilhetes numéricos aleatórios
function generateRandomTicketsPool() {
  const numbers = [];
  for (let i = 1000; i < 101000; i++) {
    numbers.push(i);
  }
  return shuffleArray(numbers);
}

// Carrega o estado do banco do Firebase
async function loadStateFromFirebase() {
  if (!stateRef) {
    appState.availableTicketsPool = generateRandomTicketsPool();
    return;
  }

  try {
    const snapshot = await stateRef.once('value');
    const data = snapshot.val();
    if (data) {
      appState = {
        prize: data.prize || '',
        coinsPerTicket: data.coinsPerTicket || 1,
        participants: data.participants || {},
        availableTicketsPool: data.availableTicketsPool || generateRandomTicketsPool()
      };
      console.log('📦 Estado recuperado do Firebase com sucesso.');
    } else {
      appState.availableTicketsPool = generateRandomTicketsPool();
      await saveStateToFirebase();
      console.log('✨ Novo estado inicializado no Firebase.');
    }
  } catch (err) {
    console.error('❌ Erro ao ler dados do Firebase:', err.message);
    appState.availableTicketsPool = generateRandomTicketsPool();
  }
}

// Salva o estado atual no Firebase
async function saveStateToFirebase() {
  if (!stateRef) return;
  try {
    await stateRef.set(appState);
  } catch (err) {
    console.error('❌ Erro ao salvar dados no Firebase:', err.message);
  }
}

loadStateFromFirebase();

// ==========================================
// 3. CONFIGURAÇÃO EXPRESS E SOCKET.IO
// ==========================================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let tiktokLiveConnection = null;
let activeStreamer = "";

// Lógica para atribuição de bilhetes por moedas
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

// ==========================================
// 4. ROTAS E WEBHOOKS
// ==========================================
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

// ==========================================
// 5. COMUNICAÇÃO SOCKET.IO (PAINEL E PÚBLICO)
// ==========================================
io.on('connection', (socket) => {
  console.log('📱 Cliente conectado.');

  // Envia os dados atuais para novas abas/clientes
  socket.emit('stateUpdated', appState);

  // Atualizar Prêmio
  socket.on('updatePrize', async (prizeText) => {
    appState.prize = prizeText;
    await saveStateToFirebase();
    io.emit('stateUpdated', appState);
  });

  // Atualizar Valor por Bilhete
  socket.on('updateCoinsPerTicket', async (value) => {
    appState.coinsPerTicket = Number(value) || 1;
    await saveStateToFirebase();
    io.emit('stateUpdated', appState);
  });

  // Zerar Sorteio
  socket.on('clearData', async () => {
    appState.participants = {};
    appState.availableTicketsPool = generateRandomTicketsPool();
    await saveStateToFirebase();
    io.emit('stateUpdated', appState);
  });

  // TikTok Live Connector Direct
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
        console.log(`✅ Conectado diretamente à live de @${username}`);
        socket.emit('statusUpdate', { status: 'connected', streamer: username });
      }).catch(err => {
        console.error(`❌ Erro na conexão direta com @${username}:`, err);
        socket.emit('statusUpdate', { status: 'error', message: err.message || 'Falha ao conectar via servidor.' });
      });

      tiktokLiveConnection.on('gift', async data => {
        if (data.giftType === 1 && data.repeatEnd === false) return;

        const totalCoins = (data.diamondCount || 1) * (data.repeatCount || 1);
        await processContribution(data.uniqueId, totalCoins);

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
      console.error(`❌ Falha na conexão direta:`, err);
      socket.emit('statusUpdate', { status: 'error', message: 'Erro na conexão direta. Utilize o TikFinity.' });
    }
  });
});

// ==========================================
// 6. INICIALIZAÇÃO DA PORTA
// ==========================================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando com sucesso na porta ${PORT}`);
});
