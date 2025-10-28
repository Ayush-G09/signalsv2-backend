const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const signals = require('./signals');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.get('/', (req, res) => res.send('Stock Signal WebSocket Server Running'));

let subscriptions = {};

io.on('connection', socket => {
  subscriptions[socket.id] = [];
  console.log(`[socket] Connected: ${socket.id}`);

  socket.on('subscribe', ({ symbol, strategy }) => {
    if (!subscriptions[socket.id].find(sub => sub.symbol === symbol && sub.strategy === strategy)) {
      subscriptions[socket.id].push({ symbol, strategy });
      console.log(`[socket] ${socket.id} subscribed: ${symbol}, ${strategy}`);
    }
  });

  socket.on('unsubscribe', ({ symbol, strategy }) => {
    subscriptions[socket.id] = subscriptions[socket.id].filter(
      sub => !(sub.symbol === symbol && sub.strategy === strategy)
    );
    console.log(`[socket] ${socket.id} unsubscribed: ${symbol}, ${strategy}`);
  });

  socket.on('disconnect', () => {
    console.log(`[socket] Disconnected: ${socket.id}`);
    delete subscriptions[socket.id];
  });
});

setInterval(async () => {
  for (const [socketId, subs] of Object.entries(subscriptions)) {
    for (const { symbol, strategy } of subs) {
      try {
        const signalFunc = signals[strategy];
        if (typeof signalFunc !== "function") {
          console.error(`[interval] Unknown strategy: ${strategy}`);
          continue;
        }

        const signal = await signalFunc(symbol);
        io.to(socketId).emit('signal', { symbol, strategy, signal });
        console.log(`[interval] Emitted signal: ${symbol}, ${strategy}, ${JSON.stringify(signal)}`);
      } catch (err) {
        io.to(socketId).emit('signal', { symbol, strategy, error: err.message });
        console.error(`[interval] Error for ${symbol}, ${strategy}: ${err.message}`);
      }
    }
  }
}, 60000); // every 20 sec

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
