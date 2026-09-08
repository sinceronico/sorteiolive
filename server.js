const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// ==========================================
// INICIALIZAÇÃO SEGURA DO FIREBASE ADMIN
// ==========================================
let db = null;
let participantsRef = null;
let prizeRef = null;

try {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : null;

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey) {
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: privateKey,
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL
      });
    }
    db = admin.database();
    participantsRef = db.ref('participants');
    prizeRef = db.ref('prize');
    console.log('✅ Firebase Admin inicializado com sucesso.');
  } else {
    console.warn('⚠️ Variáveis de ambiente do Firebase ausentes no Render. Rodando em modo local/temporário.');
  }
} catch (error) {
  console.error('❌ Erro ao inicializar o Firebase Admin:', error.message);
}

// Servir arquivos estáticos (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ==========================================
// ROTAS PARA WEBHOOK / TIKFINITY
// ==========================================
app.post('/webhook-gift', async (req, res) => {
  try {
    const { username, coins } = req.body;

    if (!username || !coins) {
      return res.status(400).json({ error: 'Username e coins são obrigatórios.' });
    }

    const numericCoins = Number(coins);

    // Salva no Firebase se configurado
    if (participantsRef) {
      const sanitizedUser = username.replace(/[.#$\[\]]/g, "_");
      const userRef = participantsRef.child(sanitizedUser);

      await userRef.transaction((currentUser) => {
        if (currentUser) {
          currentUser.coins = (currentUser.coins || 0) + numericCoins;
        } else {
          currentUser = { coins: numericCoins };
        }
        return currentUser;
      });
    }

    // Emite o evento em tempo real via Socket.IO para o Painel
    io.emit('giftReceived', { username, coins: numericCoins });

    return res.status(200).json({ status: 'sucesso', username, coins: numericCoins });
  } catch (err) {
    console.error('Erro no webhook-gift:', err);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// ==========================================
// SOCKET.IO (COMUNICAÇÃO COM O PAINEL)
// ==========================================
io.on('connection', (socket) => {
  console.log('🟢 Novo cliente conectado ao painel:', socket.id);

  // Atualizar Prêmio
  socket.on('updatePrize', async (prizeText) => {
    if (prizeRef) {
      await prizeRef.set(prizeText);
    }
    io.emit('prizeUpdated', prizeText);
  });

  // Zerar Rifa
  socket.on('clearData', async () => {
    if (participantsRef) {
      await participantsRef.remove();
    }
    io.emit('clearDataReceived');
  });

  socket.on('disconnect', () => {
    console.log('🔴 Cliente desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
