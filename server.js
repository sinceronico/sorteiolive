const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const admin = require('firebase-admin');

// -------------------------------------------------------------
// INICIALIZAÇÃO DO FIREBASE ADMIN NO SERVIDOR
// -------------------------------------------------------------
admin.initializeApp({
  projectId: "sorteiolive-ec896"
});

const db = admin.firestore();
const sessionRef = db.collection('sorteio_live').doc('current_session');

// Estrutura em memória local para resposta ultra-rápida (sincronizada com o Firebase)
let state = {
  isSessionActive: false,
  currentPrize: "",
  participants: {},
  availableTicketsPool: []
};

// Algoritmo Fisher-Yates para gerar e embaralhar o pool de números
function generateRandomTicketsPool() {
  const numbers = [];
  for (let i = 1000; i < 101000; i++) {
    numbers.push(i);
  }
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers;
}

// Carrega os dados do Firebase quando o servidor inicia
async function loadStateFromFirebase() {
  try {
    const doc = await sessionRef.get();
    if (doc.exists) {
      const data = doc.data();
      state.isSessionActive = data.isSessionActive ?? false;
      state.currentPrize = data.currentPrize ?? "";
      state.participants = data.participants ?? {};
      state.availableTicketsPool = data.availableTicketsPool ?? generateRandomTicketsPool();
    } else {
      state.availableTicketsPool = generateRandomTicketsPool();
      await saveStateToFirebase();
    }
    console.log("🔥 Dados carregados do Firebase Firestore com sucesso!");
  } catch (error) {
    console.error("Erro ao carregar do Firebase:", error);
    state.availableTicketsPool = generateRandomTicketsPool();
  }
}

// Salva o estado atual no Firebase
async function saveStateToFirebase() {
  try {
    await sessionRef.set({
      isSessionActive: state.isSessionActive,
      currentPrize: state.currentPrize,
      participants: state.participants,
      availableTicketsPool: state.availableTicketsPool,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error("Erro ao salvar no Firebase:", error);
  }
}

loadStateFromFirebase();

// -------------------------------------------------------------
// EVENTOS DO SOCKET.IO (TIKFINITY & CLIENTES)
// -------------------------------------------------------------
io.on('connection', (socket) => {

  // Sincroniza quem entra ou atualiza a página (Acompanhar ou Admin)
  socket.emit('syncState', {
    isSessionActive: state.isSessionActive,
    currentPrize: state.currentPrize,
    participants: state.participants
  });

  // Alterar Status (Iniciar / Parar)
  socket.on('toggleSession', async (status) => {
    state.isSessionActive = status;
    io.emit('sessionStatusUpdated', state.isSessionActive);
    await saveStateToFirebase();
  });

  // Atualizar Prêmio
  socket.on('updatePrize', async (prizeText) => {
    state.currentPrize = prizeText;
    io.emit('prizeUpdated', state.currentPrize);
    await saveStateToFirebase();
  });

  // RECEPTOR DO TIKFINITY / PRESENTES
  // (Compatível com o formato padrão enviado pelo webhook do TikFinity)
  socket.on('giftReceived', async (data) => {
    if (!state.isSessionActive) return; // Se estiver parado, ignora

    const username = data.username;
    const coins = Number(data.coins) || 1;
    const coinsPerTicket = Number(data.coinsPerTicket) || 1;

    if (!state.participants[username]) {
      state.participants[username] = { coins: 0, tickets: [] };
    }

    state.participants[username].coins += coins;
    const targetTicketsCount = Math.floor(state.participants[username].coins / coinsPerTicket);

    // Atribui números sorteados do pool pré-embaralhado
    while (state.participants[username].tickets.length < targetTicketsCount && state.availableTicketsPool.length > 0) {
      state.participants[username].tickets.push(state.availableTicketsPool.pop());
    }

    // Notifica todos em tempo real e persiste no Firebase
    io.emit('participantsUpdated', state.participants);
    io.emit('newGiftNotification', { username, coins });
    await saveStateToFirebase();
  });

  // Zerar Rifa
  socket.on('clearData', async () => {
    state.participants = {};
    state.availableTicketsPool = generateRandomTicketsPool();
    state.isSessionActive = false;
    
    io.emit('dataCleared');
    await saveStateToFirebase();
  });
});

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
