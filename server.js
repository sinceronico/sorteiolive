const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let currentConfig = { coinsPerTicket: 1, maxTicketsLimit: 100000 };
let prizeText = "";

io.on('connection', (socket) => {
  // Envia configurações atuais ao conectar
  socket.emit('configUpdated', currentConfig);
  socket.emit('prizeUpdated', prizeText);

  // Atualização de regra enviada pelo Admin
  socket.on('updateConfig', (configData) => {
    currentConfig.coinsPerTicket = parseInt(configData.coinsPerTicket) || 1;
    currentConfig.maxTicketsLimit = parseInt(configData.maxTicketsLimit) || 100000;
    io.emit('configUpdated', currentConfig);
  });

  // Atualização do Prêmio
  socket.on('updatePrize', (text) => {
    prizeText = text;
    io.emit('prizeUpdated', prizeText);
  });

  // Evento para zerar dados
  socket.on('clearData', () => {
    io.emit('clearDataReceived');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
