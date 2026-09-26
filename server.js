const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const { WebcastPushConnection } = require('tiktok-live-connector');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = Number(process.env.PORT || 3000);
const TIKTOK_USERNAME = (process.env.TIKTOK_USERNAME || process.env.TTK_TIKTOK_USERNAME || 'quiz_azul').trim();
const SIMULATION_MODE = (process.env.SIMULATION_MODE || 'false').toLowerCase() === 'true';

const state = {
  connected: false,
  followers: [],
  rewardQueue: [],
  rewardHistory: [],
  balance: 8000000000,
  top10: [],
  usersByName: new Map(),
  liveUsername: TIKTOK_USERNAME,
  rewardInProgress: false,
  lastEventAt: Date.now()
};

let reconnectTimer = null;
let connectorInstance = null;
const RECONNECT_MS = 15000;

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(value);
}

function toPublicUser(user) {
  return {
    username: user.username || user.name || 'usuario',
    nickname: user.nickname || user.username || user.name || 'usuario',
    avatar: user.avatar || user.profilePicture || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.username || user.name || 'user')}`,
    roses: user.roses || 0,
    position: user.position || 0,
    id: user.id || user.username || user.name || `user-${Math.random().toString(36).slice(2, 10)}`
  };
}

function ensureUser(username, extra = {}) {
  const cleanName = (username || '').trim();
  if (!cleanName) return null;

  const existing = state.usersByName.get(cleanName.toLowerCase());
  if (existing) {
    return { ...existing, ...extra };
  }

  const user = {
    id: extra.id || `user-${cleanName.toLowerCase()}`,
    username: cleanName,
    nickname: extra.nickname || cleanName,
    avatar: extra.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(cleanName)}`,
    roses: 0,
    position: 0,
    ...extra
  };

  state.usersByName.set(cleanName.toLowerCase(), user);
  state.followers.push(user);
  return user;
}

function getSortedRanking() {
  const entries = state.followers
    .filter((user) => user.roses < 3)
    .sort((a, b) => b.roses - a.roses || (a.position || 0) - (b.position || 0) || a.username.localeCompare(b.username));

  entries.forEach((user, index) => {
    user.position = index + 1;
  });

  state.top10 = entries.slice(0, 10);
  return state.top10;
}

function emitState() {
  io.emit('state:update', {
    connected: state.connected,
    balance: state.balance,
    ranking: getSortedRanking(),
    rewardQueue: state.rewardQueue,
    rewardHistory: state.rewardHistory,
    liveUsername: state.liveUsername,
    status: state.connected ? '● LIVE CONECTADA' : '○ AGUARDANDO LIVE'
  });
}

function queueReward(user) {
  const existing = state.rewardQueue.find((item) => item.username === user.username);
  if (!existing) {
    state.rewardQueue.push({ ...user, roses: 3, amount: 5000, queuedAt: Date.now() });
  }
  emitState();
}

function awardUser(username) {
  const user = state.followers.find((item) => item.username.toLowerCase() === username.toLowerCase());
  if (!user) return;

  state.balance += 5000;
  state.rewardHistory.unshift({
    username: user.username,
    nickname: user.nickname || user.username,
    avatar: user.avatar,
    roses: 3,
    amount: 5000
  });

  state.followers = state.followers.filter((item) => item.username.toLowerCase() !== username.toLowerCase());
  state.rewardQueue = state.rewardQueue.filter((item) => item.username.toLowerCase() !== username.toLowerCase());

  emitState();
}

app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/status', (_req, res) => {
  res.json({ connected: state.connected, liveUsername: state.liveUsername, status: state.connected ? '● LIVE CONECTADA' : '○ AGUARDANDO LIVE' });
});

app.get('/api/config', (_req, res) => {
  res.json({ liveUsername: state.liveUsername, simulationMode: SIMULATION_MODE });
});

app.post('/api/connect', (_req, res) => {
  state.liveUsername = TIKTOK_USERNAME;
  res.json({ ok: true, liveUsername: state.liveUsername, connected: state.connected });
});

app.post('/api/disconnect', (_req, res) => {
  state.connected = false;
  emitState();
  res.json({ ok: true, connected: false });
});

app.get('/api/event-stream', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ type: 'state', payload: { connected: state.connected, balance: state.balance, ranking: getSortedRanking(), rewardQueue: state.rewardQueue, rewardHistory: state.rewardHistory, liveUsername: state.liveUsername } });

  const interval = setInterval(() => send({ type: 'ping' }), 20000);
  req.on('close', () => clearInterval(interval));
});

function handleFollow(user) {
  const normalized = toPublicUser(user);
  const follower = ensureUser(normalized.username, {
    nickname: normalized.nickname,
    avatar: normalized.avatar
  });

  if (follower) {
    follower.roses = follower.roses || 0;
  }

  emitState();
}

function handleGift(user, gift) {
  const username = (user && (user.username || user.nickname)) || gift?.user?.username || 'usuario';
  const profile = toPublicUser({ ...user, username, nickname: user?.nickname || user?.username || username, avatar: user?.avatar || user?.profilePicture || gift?.user?.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username)}` });
  const follower = ensureUser(profile.username, {
    nickname: profile.nickname,
    avatar: profile.avatar
  });

  const giftName = (gift && gift.giftName) || (gift && gift.name) || 'ROSA';
  if (giftName && giftName.toLowerCase().includes('rosa')) {
    follower.roses = (follower.roses || 0) + 1;

    if (follower.roses >= 3) {
      follower.roses = 3;
      queueReward(follower);
      state.followers = state.followers.filter((item) => item.username.toLowerCase() !== follower.username.toLowerCase());
      state.rewardQueue = state.rewardQueue.filter((item) => item.username.toLowerCase() !== follower.username.toLowerCase());
      if (!state.rewardQueue.some((item) => item.username.toLowerCase() === follower.username.toLowerCase())) {
        state.rewardQueue.push({ ...follower, roses: 3, amount: 5000, queuedAt: Date.now() });
      }
    }
  }

  emitState();
}

function scheduleReconnect() {
  if (reconnectTimer || state.connected || SIMULATION_MODE || !TIKTOK_USERNAME) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initTikTokLiveConnector();
  }, RECONNECT_MS);
}

function initTikTokLiveConnector() {
  if (SIMULATION_MODE || !TIKTOK_USERNAME) {
    state.connected = false;
    emitState();
    return;
  }

  if (connectorInstance) {
    return;
  }

  const connector = new WebcastPushConnection(TIKTOK_USERNAME, {
    processInitialData: false,
    enableExtendedGiftInfo: true
  });
  connectorInstance = connector;

  connector.on('connected', () => {
    state.connected = true;
    state.liveUsername = TIKTOK_USERNAME;
    console.log(`LIVE CONECTADA: @${TIKTOK_USERNAME}`);
    emitState();
  });

  connector.on('disconnected', () => {
    state.connected = false;
    connectorInstance = null;
    console.log(`LIVE DESCONECTADA: @${TIKTOK_USERNAME}`);
    emitState();
    scheduleReconnect();
  });

  connector.on('member', (data) => {
    handleFollow(data);
  });

  connector.on('follow', (data) => {
    handleFollow(data);
  });

  connector.on('gift', (data) => {
    const user = data && data.user ? data.user : {};
    const gift = data && data.gift ? data.gift : data;
    handleGift(user, gift);
  });

  connector.on('live', () => {
    state.connected = true;
    state.liveUsername = TIKTOK_USERNAME;
    emitState();
  });

  connector.on('error', (err) => {
    console.warn(`TikTok Live offline/erro em @${TIKTOK_USERNAME}:`, err?.message || err);
    state.connected = false;
    connectorInstance = null;
    emitState();
    scheduleReconnect();
  });

  connector.connect().catch((error) => {
    console.warn(`TikTok connect failed for @${TIKTOK_USERNAME}; aguardando nova tentativa:`, error?.message || error);
    state.connected = false;
    connectorInstance = null;
    emitState();
    scheduleReconnect();
  });
}

if (SIMULATION_MODE) {
  setInterval(() => {
    const names = ['Joao123', 'PedroBR', 'AnaLive', 'GamerBR', 'LucasFPS', 'LuanGames', 'MariaLive', 'Player2026'];
    const name = names[Math.floor(Math.random() * names.length)];
    const user = ensureUser(name, {
      nickname: name,
      avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}`
    });

    if (user) {
      user.roses = Math.min(3, (user.roses || 0) + 1);
      if (user.roses >= 3) {
        user.roses = 3;
        queueReward(user);
      }
    }

    emitState();
  }, 3000);
}

if (!SIMULATION_MODE) {
  initTikTokLiveConnector();
}

io.on('connection', (socket) => {
  socket.emit('state:update', {
    connected: state.connected,
    balance: state.balance,
    ranking: getSortedRanking(),
    rewardQueue: state.rewardQueue,
    rewardHistory: state.rewardHistory,
    liveUsername: state.liveUsername,
    status: state.connected ? '● LIVE CONECTADA' : '○ AGUARDANDO LIVE'
  });
});

server.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`TIKTOK_USERNAME=${TIKTOK_USERNAME}`);
  if (!SIMULATION_MODE) {
    initTikTokLiveConnector();
  }
  emitState();
});
