const { WebcastPushConnection } = require('tiktok-live-connector');
const io = require('socket.io')(3000, { cors: { origin: "*" } });

// Substitua pelo seu nome de usuário do TikTok
let tiktokUsername = "SEU_USUARIO_TIKTOK";
let tiktokConnection = new WebcastPushConnection(tiktokUsername);

tiktokConnection.connect().then(state => {
    console.log(`Conectado à live de ${tiktokUsername}`);
}).catch(err => {
    console.error('Erro ao conectar na live:', err);
});

// Escuta evento de presente
tiktokConnection.on('gift', data => {
    // data.diamondCount é o valor em moedas do presente
    // data.repeatCount informa a quantidade
    const totalCoins = data.diamondCount * data.repeatCount;

    console.log(`${data.uniqueId} enviou ${totalCoins} moedas!`);

    // Envia o evento via WebSocket para a tela do sorteio
    io.emit('giftReceived', {
        username: data.uniqueId,
        coins: totalCoins
    });
});
