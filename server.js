const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const admin = require('firebase-admin');

// ==========================================
// 1. INICIALIZAÇÃO DO FIREBASE ADMIN
// ==========================================
// Configuração utilizando as variáveis de ambiente (Render/Heroku/Local)
const serviceAccount = {
  type: process.env.FIREBASE_TYPE || "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID || "sorteiolive-ec896",
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY 
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
    : undefined,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
};

// Verifica se as variáveis de ambiente essenciais do Firebase estão presentes
if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://sorteiolive-ec896-default-rtdb.firebaseio.com"
  });
  console.log('🔥 Firebase Admin conectado com sucesso via Variáveis de Ambiente!');
} else {
  // Fallback para arquivo local caso esteja rodando na sua máquina de testes
  try {
    const localServiceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(localServiceAccount),
      databaseURL: "https://sorteiolive-ec896-default-rtdb.firebaseio.com"
    });
    console.log('🔥 Firebase Admin conectado via arquivo local serviceAccountKey.json!');
  } catch (e) {
    console.warn('⚠️ Nenhuma credencial do Firebase encontrada. O servidor usará memória temporária.');
  }
}

// Referência do Realtime Database
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

// Algoritmo Fisher-Yates para embaralhamento perfeito de bilhetes
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Gera o pool de 100.000 bilhetes aleatórios
function generateRandomTicketsPool() {
  const numbers = [];
  for (let i = 1000; i < 101000; i++) {
    numbers.push(i);
  }
  return shuffleArray(numbers);
}

// Carrega os dados persistidos no Firebase ao iniciar o servidor
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
      console.log('📦 Estado do sorteio recuperado do Firebase.');
    } else {
      appState.availableTicketsPool = generateRandomTicketsPool();
      await saveStateToFirebase();
      console.log('✨ Novo estado criado no Firebase.');
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

// Executa a carga inicial
loadStateFromFirebase();

// ==========================================
// 3. EXPRESS E SOCKET.IO
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

// Função centralizada para processar presentes e gerar bilhetes
async function processContribution(username, coins) {
  const coinsNum = Number(coins);
  if (!appState.participants[username]) {
    appState.participants[username] = { coins: 0, tickets: [] };
  }

  appState.participants[username].coins += coinsNum;
  const targetTicketsCount = Math.floor(appState.participants[username].coins / appState.coinsPerTicket);

  // Atribui números aleatórios do pool
  while (appState.participants[username].tickets.length < targetTicketsCount && appState.availableTicketsPool.length > 0) {
    const randomTicketNumber = appState.availableTicketsPool.pop();
    appState.participants[username].tickets.push(randomTicketNumber);
  }

  // Persiste e sincroniza com todos os clientes
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
  } else {
    console.log('⚠️ Webhook recebido sem usuário:', req.query, req.body);
  }

  res.status(200).send({ success: true });
};

app.post('/webhook/tikfinity', handleTikfinityWebhook);
app.get('/webhook/tikfinity', handleTikfinityWebhook);

// ==========================================
// 5. EVENTOS DO SOCKET.IO
// ==========================================
io.on('connection', (socket) => {
  console.log('📱 Cliente conectado via WebSocket.');

  // Envia o estado atual assim que o cliente conecta
  socket.emit('stateUpdated', appState);

  // Atualização do Prêmio
  socket.on('updatePrize', async (prizeText) => {
    appState.prize = prizeText;
    await saveStateToFirebase();
    io.emit('stateUpdated', appState);
  });

  // Atualização do Valor em Moedas por Bilhete
  socket.on('updateCoinsPerTicket', async (value) => {
    appState.coinsPerTicket = Number(value) || 1;
    await saveStateToFirebase();
    io.emit('stateUpdated', appState);
  });

  // Comando para Zerar Sorteio
  socket.on('clearData', async () => {
    appState.participants = {};
    appState.availableTicketsPool = generateRandomTicketsPool();
    await saveStateToFirebase();
    io.emit('stateUpdated', appState);
  });

  // Conexão TikTok Live Connector
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
        console.log(`✅ Conectado à live de @${username} (Room ID: ${state.roomId})`);
        socket.emit('statusUpdate', { status: 'connected', streamer: username });
      }).catch(err => {
        console.error(`❌ Erro ao conectar na live de @${username}:`, err);
        socket.emit('statusUpdate', { status: 'error', message: err.message || 'Falha ao conectar via servidor.' });
      });

      tiktokLiveConnection.on('gift', async data => {
        if (data.giftType === 1 && data.repeatEnd === false) return; // Ignora combos incompletos

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
      console.error(`❌ Erro na conexão direta:`, err);
      socket.emit('statusUpdate', { status: 'error', message: 'Bloqueio na conexão direta. Use o TikFinity.' });
    }
  });
});

// ==========================================
// 6. INICIALIZAÇÃO DO SERVIDOR
// ==========================================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando com sucesso na porta ${PORT}`);
});
