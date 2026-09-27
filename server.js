const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const INITIAL_BALANCE = 1000000000;

const TIKTOK_USERNAME = (
  process.env.TIKTOK_USERNAME ||
  process.env.TTK_TIKTOK_USERNAME ||
  "quiz_azul"
).trim();

const SIMULATION_MODE = true;
const PLAYERS_FILE = process.env.PLAYERS_FILE || path.join(DATA_DIR, "players.json");
const REWARDS_FILE = process.env.REWARDS_FILE || path.join(DATA_DIR, "rewards.json");

const RECONNECT_MS = 15000;


// ============================================================
// ESTADO
// ============================================================

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


let connectorInstance = null;
let reconnectTimer = null;
let tiktokApi = null;
let players = loadPlayers();
const rewardStore = loadRewards();
let rewards = rewardStore.rewards;
let balance = rewardStore.balance;
const profileCache = new Map();


// ============================================================
// UTILIDADES
// ============================================================

function sanitizeUsername(value) {
  const cleanName = String(value || "")
    .trim()
    .replace(/^@/, "");

  const lowerName = cleanName.toLowerCase();

  if (
    !cleanName ||
    lowerName === "usuario" ||
    lowerName === "user" ||
    lowerName === "nome" ||
    lowerName === "seguindo..." ||
    lowerName.includes("seguindo")
  ) {
    return null;
  }

  return cleanName;
}


function getUserAvatar(user, username) {
  if (user && user.avatar) {
    return user.avatar;
  }

  if (user && user.profilePicture) {
    return user.profilePicture;
  }

  if (user && user.avatarThumb) {
    return user.avatarThumb;
  }

  return (
    "https://api.dicebear.com/7.x/initials/svg?seed=" +
    encodeURIComponent(username)
  );
}


function getTikTokUsername(user) {
  if (!user) {
    return null;
  }

  return sanitizeUsername(
    user.uniqueId ||
    user.username ||
    user.nickname ||
    user.name
  );
}


function getNickname(user, username) {
  if (!user) {
    return username;
  }

  return (
    user.nickname ||
    user.displayName ||
    username
  );
}


function loadPlayers() {
  fs.mkdirSync(path.dirname(PLAYERS_FILE), { recursive: true });

  if (!fs.existsSync(PLAYERS_FILE)) {
    fs.writeFileSync(PLAYERS_FILE, "[]\n", "utf8");
  }

  const storedPlayers = JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8"));

  if (!Array.isArray(storedPlayers)) {
    throw new Error("O arquivo de jogadores precisa conter uma lista JSON.");
  }

  return storedPlayers;
}


function loadRewards() {
  fs.mkdirSync(path.dirname(REWARDS_FILE), { recursive: true });

  if (!fs.existsSync(REWARDS_FILE)) {
    const initialStore = { balance: INITIAL_BALANCE, rewards: [] };
    writeRewardStore(initialStore);
    return initialStore;
  }

  const storedData = JSON.parse(fs.readFileSync(REWARDS_FILE, "utf8"));
  const storedStore = Array.isArray(storedData)
    ? { balance: INITIAL_BALANCE, rewards: storedData }
    : storedData;

  if (
    !storedStore ||
    !Array.isArray(storedStore.rewards) ||
    !Number.isSafeInteger(storedStore.balance) ||
    storedStore.balance < 0
  ) {
    throw new Error("O arquivo de premiações ou saldo geral está inválido.");
  }

  if (Array.isArray(storedData)) {
    writeRewardStore(storedStore);
  }

  return storedStore;
}


function writeRewardStore(store) {
  const temporaryFile = REWARDS_FILE + ".tmp";
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2) + "\n", "utf8");
  fs.renameSync(temporaryFile, REWARDS_FILE);
}


function saveRewards(nextRewards, nextBalance = balance) {
  writeRewardStore({ balance: nextBalance, rewards: nextRewards });
  rewards = nextRewards;
  balance = nextBalance;
  io.emit("rewards:update");
  io.emit("balance:update", { balance });
}


function validateTikTokUsername(value) {
  const username = String(value || "").trim().replace(/^@/, "");

  if (!/^[a-zA-Z0-9._]{2,24}$/.test(username)) {
    return null;
  }

  return username;
}


function parseProfileFromPage(html, requestedUsername) {
  const scripts = [
    html.match(/<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i),
    html.match(/<script[^>]+id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i)
  ].filter(Boolean);

  for (const match of scripts) {
    try {
      const pending = [JSON.parse(match[1])];
      let inspected = 0;

      while (pending.length && inspected < 50000) {
        const value = pending.pop();
        inspected += 1;

        if (!value || typeof value !== "object") continue;

        const uniqueId = value.uniqueId || value.unique_id;
        const avatarUrl = value.avatarLarger || value.avatarMedium || value.avatarThumb || value.avatar_url;

        if (
          typeof uniqueId === "string" &&
          uniqueId.toLowerCase() === requestedUsername.toLowerCase() &&
          typeof avatarUrl === "string" &&
          avatarUrl.startsWith("https://")
        ) {
          return {
            username: uniqueId,
            displayName: String(value.nickname || value.display_name || uniqueId),
            avatarUrl,
            verified: Boolean(value.verified || value.is_verified),
            profileVerified: true
          };
        }

        for (const item of Object.values(value)) {
          if (item && typeof item === "object") pending.push(item);
        }
      }
    } catch (_error) {
      continue;
    }
  }

  const meta = {};
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attributes = {};
    const attributePattern = /([\w:-]+)=["']([^"']*)["']/g;
    let attribute;
    while ((attribute = attributePattern.exec(tag))) {
      attributes[attribute[1].toLowerCase()] = attribute[2];
    }
    if (attributes.property) meta[attributes.property.toLowerCase()] = attributes.content || "";
  }

  const pageUrl = meta["og:url"] || "";
  const pageTitle = meta["og:title"] || "";
  const avatarUrl = meta["og:image"] || "";
  const pageUsername = pageUrl.match(/@([a-zA-Z0-9._]+)/)?.[1];

  if (
    pageUsername &&
    pageUsername.toLowerCase() === requestedUsername.toLowerCase() &&
    avatarUrl.startsWith("https://")
  ) {
    const displayName = pageTitle.split("(@")[0].replace(/\s*\|\s*TikTok\s*$/i, "").trim();
    return {
      username: pageUsername,
      displayName: displayName || pageUsername,
      avatarUrl,
      verified: false,
      profileVerified: true
    };
  }

  return null;
}


async function fetchTikTokProfile(username) {
  const cacheKey = username.toLowerCase();
  const cached = profileCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;

  let response;
  try {
    response = await fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(12000)
    });
  } catch (error) {
    const unavailable = new Error(error.name === "TimeoutError" ? "A busca no TikTok excedeu o tempo limite." : "Não foi possível consultar o TikTok agora.");
    unavailable.status = error.name === "TimeoutError" ? 504 : 502;
    unavailable.code = "TIKTOK_UNAVAILABLE";
    throw unavailable;
  }

  if (response.status === 404) {
    const notFound = new Error("Usuário do TikTok não encontrado.");
    notFound.status = 404;
    notFound.code = "TIKTOK_USER_NOT_FOUND";
    throw notFound;
  }

  if (!response.ok) {
    const unavailable = new Error("O TikTok recusou a consulta do perfil.");
    unavailable.status = 502;
    unavailable.code = "TIKTOK_UNAVAILABLE";
    throw unavailable;
  }

  const html = await response.text();
  if (html.length > 5_000_000) {
    const unavailable = new Error("A resposta do TikTok excedeu o tamanho permitido.");
    unavailable.status = 502;
    unavailable.code = "TIKTOK_UNAVAILABLE";
    throw unavailable;
  }

  if (/Please wait\.\.\.|slardarWAF|_wafchallengeid|waforiginalreid/i.test(html)) {
    const blocked = new Error("O TikTok bloqueou a busca automatizada neste momento.");
    blocked.status = 503;
    blocked.code = "TIKTOK_BLOCKED";
    throw blocked;
  }

  const profile = parseProfileFromPage(html, username);
  if (!profile) {
    const missingProfile = /user not found|couldn.t find this account|account doesn.t exist/i.test(html);
    const error = new Error(missingProfile ? "Usuário do TikTok não encontrado." : "O TikTok não forneceu os dados públicos deste perfil.");
    error.status = missingProfile ? 404 : 503;
    error.code = missingProfile ? "TIKTOK_USER_NOT_FOUND" : "TIKTOK_PROFILE_UNAVAILABLE";
    throw error;
  }

  profileCache.set(cacheKey, { profile, expiresAt: Date.now() + 5 * 60 * 1000 });
  return profile;
}


function savePlayers(nextPlayers) {
  const temporaryFile = PLAYERS_FILE + ".tmp";
  fs.writeFileSync(temporaryFile, JSON.stringify(nextPlayers, null, 2) + "\n", "utf8");
  fs.renameSync(temporaryFile, PLAYERS_FILE);
  players = nextPlayers;
  emitState();
}


function getSortedPlayers() {
  return players
    .slice()
    .sort((a, b) => b.coins - a.coins || a.name.localeCompare(b.name, "pt-BR"))
    .map((player, index) => ({ ...player, position: index + 1 }));
}


function validatePlayerInput(body) {
  const name = String(body && body.name || "").trim();
  const coins = body && body.coins;

  if (!name || name.length > 40) {
    return { error: "Informe um nome com até 40 caracteres." };
  }

  if (!Number.isSafeInteger(coins) || coins < 0) {
    return { error: "As moedas devem ser um número inteiro não negativo." };
  }

  return { name, coins };
}


function hasNameConflict(name, exceptId) {
  return players.some((player) =>
    player.id !== exceptId && player.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")
  );
}


// ============================================================
// USUÁRIOS
// ============================================================

function ensureUser(username, extra = {}) {
  const cleanName = sanitizeUsername(username);

  if (!cleanName) {
    return null;
  }

  const key = cleanName.toLowerCase();

  const existing = state.usersByName.get(key);

  if (existing) {
    Object.assign(existing, extra);

    return existing;
  }

  const user = {
    id: extra.id || "user-" + key,

    username: cleanName,

    nickname:
      sanitizeUsername(extra.nickname) ||
      cleanName,

    avatar:
      extra.avatar ||
      getUserAvatar(extra, cleanName),

    roses: Number(extra.roses || 0),

    position: 0,

    createdAt: Date.now(),

    reachedRoseCountAt: {}
  };

  state.usersByName.set(key, user);

  state.followers.push(user);

  return user;
}


function getPublicUser(user) {
  const username = getTikTokUsername(user);

  if (!username) {
    return null;
  }

  return {
    username: username,

    nickname: getNickname(user, username),

    avatar: getUserAvatar(user, username),

    id:
      user.userId ||
      user.id ||
      username,

    roses: 0,

    position: 0
  };
}


// ============================================================
// RANKING
// ============================================================

function getSortedRanking() {
  const entries = state.followers
    .filter(function (user) {
      return (
        user &&
        sanitizeUsername(user.username) &&
        Number(user.roses || 0) < 3
      );
    })
    .sort(function (a, b) {
      const roseDifference =
        Number(b.roses || 0) -
        Number(a.roses || 0);

      if (roseDifference !== 0) {
        return roseDifference;
      }

      const aTime =
        Number(
          a.reachedRoseCountAt &&
          a.reachedRoseCountAt[a.roses]
            ? a.reachedRoseCountAt[a.roses]
            : a.createdAt
        );

      const bTime =
        Number(
          b.reachedRoseCountAt &&
          b.reachedRoseCountAt[b.roses]
            ? b.reachedRoseCountAt[b.roses]
            : b.createdAt
        );

      return aTime - bTime;
    });

  entries.forEach(function (user, index) {
    user.position = index + 1;
  });

  state.top10 = entries.slice(0, 10);

  return state.top10;
}


// ============================================================
// ENVIAR ESTADO PARA O SITE
// ============================================================

function emitState() {
  io.emit("state:update", {
    connected: state.connected,

    balance: state.balance,

    players: getSortedPlayers(),

    ranking: getSortedRanking(),

    rewardQueue: state.rewardQueue,

    rewardHistory: state.rewardHistory,

    liveUsername: state.liveUsername,

    status: state.connected
      ? "● LIVE CONECTADA"
      : "○ AGUARDANDO LIVE"
  });
}


// ============================================================
// FILA DE RECOMPENSA
// ============================================================

function queueReward(user) {
  if (!user) {
    return;
  }

  const alreadyQueued = state.rewardQueue.some(function (item) {
    return (
      item.username.toLowerCase() ===
      user.username.toLowerCase()
    );
  });

  if (alreadyQueued) {
    return;
  }

  state.rewardQueue.push({
    id: user.id,

    username: user.username,

    nickname: user.nickname,

    avatar: user.avatar,

    roses: 3,

    amount: 5000,

    queuedAt: Date.now()
  });

  emitState();
}


function reachThreeRoses(user) {
  if (!user) {
    return;
  }

  user.roses = 3;

  queueReward(user);

  state.followers = state.followers.filter(function (item) {
    return (
      item.username.toLowerCase() !==
      user.username.toLowerCase()
    );
  });

  emitState();
}


// ============================================================
// PREMIAR USUÁRIO
// ============================================================

function awardUser(username) {
  const key = String(username || "").toLowerCase();

  const queueIndex = state.rewardQueue.findIndex(function (item) {
    return item.username.toLowerCase() === key;
  });

  if (queueIndex === -1) {
    return false;
  }

  const reward = state.rewardQueue[queueIndex];

  state.balance += 5000;

  state.rewardHistory.unshift({
    username: reward.username,

    nickname: reward.nickname,

    avatar: reward.avatar,

    roses: 3,

    amount: 5000,

    rewardedAt: Date.now()
  });

  state.rewardQueue.splice(queueIndex, 1);

  state.rewardInProgress = false;

  emitState();

  return true;
}


// ============================================================
// SEGUIDOR
// ============================================================

function handleFollow(data) {
  const sourceUser =
    data && data.user
      ? data.user
      : data;

  const publicUser = getPublicUser(sourceUser);

  if (!publicUser) {
    return;
  }

  const follower = ensureUser(
    publicUser.username,
    {
      id: publicUser.id,

      nickname: publicUser.nickname,

      avatar: publicUser.avatar
    }
  );

  if (!follower) {
    return;
  }

  console.log(
    "NOVO SEGUIDOR: @" +
    follower.username
  );

  state.lastEventAt = Date.now();

  emitState();
}


// ============================================================
// PRESENTE / ROSA
// ============================================================

function handleGift(data) {
  if (!data) {
    return;
  }

  const userData =
    data.user || {};

  const username =
    getTikTokUsername(userData);

  if (!username) {
    return;
  }

  const giftName =
    data.giftName ||
    (data.gift && data.gift.name) ||
    (data.gift && data.gift.giftName) ||
    "";

  console.log(
    "PRESENTE: @" +
    username +
    " -> " +
    (giftName || "presente")
  );

  const normalizedGiftName =
    String(giftName).toLowerCase();

  const isRose =
    normalizedGiftName.includes("rosa") ||
    normalizedGiftName.includes("rose");

  if (!isRose) {
    return;
  }

  let user =
    state.usersByName.get(
      username.toLowerCase()
    );

  if (!user) {
    user = ensureUser(
      username,
      {
        id:
          userData.userId ||
          userData.id ||
          username,

        nickname:
          userData.nickname ||
          username,

        avatar:
          getUserAvatar(
            userData,
            username
          )
      }
    );
  }

  if (!user) {
    return;
  }

  const previousRoses =
    Number(user.roses || 0);

  if (previousRoses >= 3) {
    return;
  }

  user.roses =
    previousRoses + 1;

  if (!user.reachedRoseCountAt) {
    user.reachedRoseCountAt = {};
  }

  user.reachedRoseCountAt[user.roses] =
    Date.now();

  console.log(
    "ROSA: @" +
    username +
    " agora tem " +
    user.roses +
    "/3"
  );

  if (user.roses >= 3) {
    reachThreeRoses(user);
  } else {
    emitState();
  }

  state.lastEventAt = Date.now();
}


// ============================================================
// COMENTÁRIO
// ============================================================

function handleChat(data) {
  if (!data) {
    return;
  }

  const username =
    getTikTokUsername(data.user);

  const comment =
    String(
      data.comment ||
      data.message ||
      ""
    ).trim();

  if (!username || !comment) {
    return;
  }

  console.log(
    "COMENTÁRIO @" +
    username +
    ": " +
    comment
  );

  // ==========================================================
  // TESTE GRATUITO: gatuno11
  // ==========================================================

  if (
    comment.toLowerCase() ===
    "gatuno11"
  ) {
    console.log(
      "TESTE GATUNO11 RECEBIDO DE @" +
      username
    );

    const user =
      ensureUser(
        username,
        {
          id:
            data.user.userId ||
            data.user.id ||
            username,

          nickname:
            data.user.nickname ||
            username,

          avatar:
            getUserAvatar(
              data.user,
              username
            )
        }
      );

    if (!user) {
      return;
    }

    // O comando gatuno11 NÃO dá rosas.
    // Apenas adiciona a pessoa ao ranking com 0 rosas.

    user.roses = 0;

    emitState();

    return;
  }

  state.lastEventAt = Date.now();
}


// ============================================================
// RECONEXÃO
// ============================================================

function scheduleReconnect() {
  if (
    reconnectTimer ||
    state.connected ||
    SIMULATION_MODE ||
    !TIKTOK_USERNAME
  ) {
    return;
  }

  reconnectTimer = setTimeout(
    function () {
      reconnectTimer = null;

      initTikTokLiveConnector();
    },
    RECONNECT_MS
  );
}


// ============================================================
// CONEXÃO COM TIKTOK
// ============================================================

async function initTikTokLiveConnector() {
  if (
    SIMULATION_MODE ||
    !TIKTOK_USERNAME
  ) {
    state.connected = false;

    emitState();

    return;
  }

  if (connectorInstance) {
    return;
  }

  try {
    if (!tiktokApi) {
      tiktokApi =
        await import(
          "tiktok-live-connector"
        );
    }

    const TikTokLiveConnection =
      tiktokApi.TikTokLiveConnection;

    const WebcastEvent =
      tiktokApi.WebcastEvent;

    if (!TikTokLiveConnection) {
      throw new Error(
        "TikTokLiveConnection não encontrado na biblioteca instalada."
      );
    }

    console.log(
      "Tentando conectar na LIVE @" +
      TIKTOK_USERNAME +
      "..."
    );

    const connector =
      new TikTokLiveConnection(
        TIKTOK_USERNAME,
        {
          processInitialData: false
        }
      );

    connectorInstance =
      connector;


    // ========================================================
    // CONECTADO
    // ========================================================

    connector.on(
      WebcastEvent.CONNECTED,
      function (data) {
        state.connected = true;

        state.liveUsername =
          TIKTOK_USERNAME;

        state.lastEventAt =
          Date.now();

        console.log(
          "======================================"
        );

        console.log(
          "LIVE CONECTADA: @" +
          TIKTOK_USERNAME
        );

        console.log(
          "ROOM ID: " +
          (
            data && data.roomId
              ? data.roomId
              : "desconhecido"
          )
        );

        console.log(
          "======================================"
        );

        emitState();
      }
    );


    // ========================================================
    // DESCONECTADO
    // ========================================================

    connector.on(
      WebcastEvent.DISCONNECTED,
      function () {
        state.connected = false;

        connectorInstance = null;

        console.log(
          "LIVE DESCONECTADA: @" +
          TIKTOK_USERNAME
        );

        emitState();

        scheduleReconnect();
      }
    );


    // ========================================================
    // COMENTÁRIOS
    // ========================================================

    connector.on(
      WebcastEvent.CHAT,
      function (data) {
        handleChat(data);
      }
    );


    // ========================================================
    // SEGUIDORES
    // ========================================================

    connector.on(
      WebcastEvent.FOLLOW,
      function (data) {
        handleFollow(data);
      }
    );


    // ========================================================
    // PRESENTES
    // ========================================================

    connector.on(
      WebcastEvent.GIFT,
      function (data) {
        handleGift(data);
      }
    );


    // ========================================================
    // MEMBROS
    // ========================================================

    if (WebcastEvent.MEMBER) {
      connector.on(
        WebcastEvent.MEMBER,
        function (data) {
          const sourceUser =
            data && data.user
              ? data.user
              : data;

          const username =
            getTikTokUsername(sourceUser);

          if (username) {
            console.log(
              "ENTROU NA LIVE: @" +
              username
            );
          }
        }
      );
    }


    // ========================================================
    // FIM DA LIVE
    // ========================================================

    if (WebcastEvent.STREAM_END) {
      connector.on(
        WebcastEvent.STREAM_END,
        function () {
          state.connected = false;

          connectorInstance = null;

          console.log(
            "LIVE FINALIZADA: @" +
            TIKTOK_USERNAME
          );

          emitState();

          scheduleReconnect();
        }
      );
    }


    // ========================================================
    // ERRO
    // ========================================================

    if (WebcastEvent.ERROR) {
      connector.on(
        WebcastEvent.ERROR,
        function (error) {
          console.warn(
            "ERRO TikTok @" +
            TIKTOK_USERNAME +
            ":",
            error && error.message
              ? error.message
              : error
          );

          state.connected = false;

          connectorInstance = null;

          emitState();

          scheduleReconnect();
        }
      );
    }


    // ========================================================
    // CONECTAR
    // ========================================================

    await connector.connect();

  } catch (error) {
    console.warn(
      "Falha ao conectar @" +
      TIKTOK_USERNAME +
      ":",
      error && error.message
        ? error.message
        : error
    );

    state.connected = false;

    connectorInstance = null;

    emitState();

    scheduleReconnect();
  }
}


// ============================================================
// SIMULAÇÃO
// ============================================================

function runSimulationTest() {
  if (!SIMULATION_MODE) {
    return;
  }

  const username =
    "test_user_" +
    Date.now();

  const user =
    ensureUser(
      username,
      {
        nickname: username,

        avatar:
          "https://api.dicebear.com/7.x/initials/svg?seed=" +
          encodeURIComponent(username)
      }
    );

  if (!user) {
    return;
  }

  user.roses =
    Math.min(
      3,
      Number(user.roses || 0) + 1
    );

  if (user.roses >= 3) {
    reachThreeRoses(user);
  } else {
    emitState();
  }
}


// ============================================================
// EXPRESS
// ============================================================

app.use(express.json());

app.use(
  express.static(__dirname)
);


app.get("/admin", function (_req, res) {
  res.sendFile(path.join(__dirname, "admin.html"));
});


app.get("/admin/players", function (_req, res) {
  res.sendFile(path.join(__dirname, "players.html"));
});


app.get("/api/tiktok/profile", async function (req, res) {
  const username = validateTikTokUsername(req.query.username);
  if (!username) {
    return res.status(400).json({ ok: false, code: "INVALID_USERNAME", error: "Informe um username válido do TikTok." });
  }

  try {
    return res.json({ ok: true, profile: await fetchTikTokProfile(username) });
  } catch (error) {
    return res.json({
      ok: false,
      code: error.code || "TIKTOK_UNAVAILABLE",
      error: error.message || "Não foi possível consultar o TikTok."
    });
  }
});


app.get("/api/rewards", function (req, res) {
  const search = String(req.query.search || "").trim().toLocaleLowerCase("pt-BR");
  const matchingRewards = rewards
    .filter((reward) => !search || reward.username.toLocaleLowerCase("pt-BR").includes(search) || reward.displayName.toLocaleLowerCase("pt-BR").includes(search))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  res.json(matchingRewards);
});


app.get("/api/balance", function (_req, res) {
  res.json({ balance });
});


app.post("/api/rewards", async function (req, res) {
  const username = validateTikTokUsername(req.body && req.body.username);
  const coins = req.body && req.body.coins;

  if (!username) {
    return res.status(400).json({ ok: false, error: "Informe um username válido do TikTok." });
  }

  if (!Number.isSafeInteger(coins) || coins <= 0) {
    return res.status(400).json({ ok: false, error: "O prêmio deve ser um número inteiro positivo de moedas." });
  }

  if (coins > balance) {
    return res.status(400).json({ ok: false, error: "Saldo insuficiente." });
  }

  const cached = profileCache.get(username.toLowerCase());
  let profile = cached && cached.expiresAt > Date.now() ? cached.profile : null;

  if (!profile && req.body.manualVerified !== true) {
    try {
      profile = await fetchTikTokProfile(username);
    } catch (error) {
      return res.status(error.status || 502).json({ ok: false, code: error.code, error: error.message });
    }
  }

  if (!profile && req.body.manualVerified !== true) {
    return res.status(422).json({ ok: false, error: "Busque e confirme o perfil antes de registrar o prêmio." });
  }

  if (coins > balance) {
    return res.status(400).json({ ok: false, error: "Saldo insuficiente." });
  }

  const rewardedAt = new Date();
  const balanceBefore = balance;
  const balanceAfter = balanceBefore - coins;
  const reward = {
    id: randomUUID(),
    username: profile ? profile.username : username,
    displayName: profile ? profile.displayName : username,
    avatarUrl: profile ? profile.avatarUrl : null,
    profileVerified: Boolean(profile && profile.profileVerified),
    verifiedBadge: Boolean(profile && profile.verified),
    coins,
    balanceBefore,
    balanceAfter,
    status: "sent",
    createdAt: rewardedAt.toISOString(),
    redeemBy: new Date(rewardedAt.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString()
  };

  saveRewards([reward, ...rewards], balanceAfter);
  return res.status(201).json({ ok: true, reward, balance: balanceAfter });
});


app.patch("/api/rewards/:id/status", function (req, res) {
  const allowedStatuses = ["sent", "processing", "redeemed", "cancelled"];
  const status = req.body && req.body.status;
  const existing = rewards.find((reward) => reward.id === req.params.id);

  if (!existing) {
    return res.status(404).json({ ok: false, error: "Premiação não encontrada." });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ ok: false, error: "Status de premiação inválido." });
  }

  const reward = { ...existing, status, updatedAt: new Date().toISOString() };
  saveRewards(rewards.map((item) => item.id === existing.id ? reward : item));
  return res.json({ ok: true, reward });
});


app.get("/api/players", function (_req, res) {
  res.json(getSortedPlayers());
});


app.post("/api/players", function (req, res) {
  const input = validatePlayerInput(req.body);

  if (input.error) {
    return res.status(400).json({ ok: false, error: input.error });
  }

  if (hasNameConflict(input.name)) {
    return res.status(409).json({ ok: false, error: "Já existe um jogador com esse nome." });
  }

  const player = {
    id: randomUUID(),
    name: input.name,
    coins: input.coins,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  savePlayers(players.concat(player));
  return res.status(201).json({ ok: true, player, players: getSortedPlayers() });
});


app.put("/api/players/:id", function (req, res) {
  const existing = players.find((player) => player.id === req.params.id);

  if (!existing) {
    return res.status(404).json({ ok: false, error: "Jogador não encontrado." });
  }

  const input = validatePlayerInput(req.body);

  if (input.error) {
    return res.status(400).json({ ok: false, error: input.error });
  }

  if (hasNameConflict(input.name, existing.id)) {
    return res.status(409).json({ ok: false, error: "Já existe um jogador com esse nome." });
  }

  const player = {
    ...existing,
    name: input.name,
    coins: input.coins,
    updatedAt: new Date().toISOString()
  };

  savePlayers(players.map((item) => item.id === existing.id ? player : item));
  return res.json({ ok: true, player, players: getSortedPlayers() });
});


app.post("/api/players/:id/coins", function (req, res) {
  const existing = players.find((player) => player.id === req.params.id);

  if (!existing) {
    return res.status(404).json({ ok: false, error: "Jogador não encontrado." });
  }

  const amount = req.body && req.body.amount;
  const operation = req.body && req.body.operation;

  if (!Number.isSafeInteger(amount) || amount <= 0 || !["add", "remove"].includes(operation)) {
    return res.status(400).json({ ok: false, error: "Informe uma quantidade inteira positiva e uma operação válida." });
  }

  const coins = operation === "add" ? existing.coins + amount : existing.coins - amount;

  if (!Number.isSafeInteger(coins) || coins < 0) {
    return res.status(400).json({ ok: false, error: "A operação deixaria o saldo inválido." });
  }

  const player = { ...existing, coins, updatedAt: new Date().toISOString() };
  savePlayers(players.map((item) => item.id === existing.id ? player : item));
  return res.json({ ok: true, player, players: getSortedPlayers() });
});


app.delete("/api/players/:id", function (req, res) {
  const existing = players.find((player) => player.id === req.params.id);

  if (!existing) {
    return res.status(404).json({ ok: false, error: "Jogador não encontrado." });
  }

  savePlayers(players.filter((player) => player.id !== existing.id));
  return res.json({ ok: true });
});


// ============================================================
// STATUS
// ============================================================

app.get(
  "/api/status",
  function (_req, res) {
    res.json({
      connected:
        state.connected,

      liveUsername:
        state.liveUsername,

      status:
        state.connected
          ? "● LIVE CONECTADA"
          : "○ AGUARDANDO LIVE"
    });
  }
);


// ============================================================
// CONFIG
// ============================================================

app.get(
  "/api/config",
  function (_req, res) {
    res.json({
      liveUsername:
        state.liveUsername,

      simulationMode:
        SIMULATION_MODE
    });
  }
);


// ============================================================
// CONECTAR MANUALMENTE
// ============================================================

app.post(
  "/api/connect",
  function (_req, res) {
    res.status(410).json({
      ok: false,
      error: "A integração automática está desativada nesta versão manual."
    });
  }
);


// ============================================================
// DESCONECTAR
// ============================================================

app.post(
  "/api/disconnect",
  async function (_req, res) {
    try {
      if (connectorInstance) {
        if (
          typeof connectorInstance.disconnect ===
          "function"
        ) {
          await connectorInstance.disconnect();
        }
      }
    } catch (error) {
      console.warn(
        "Erro ao desconectar:",
        error && error.message
          ? error.message
          : error
      );
    }

    connectorInstance = null;

    state.connected = false;

    emitState();

    res.json({
      ok: true,

      connected: false
    });
  }
);


// ============================================================
// PREMIAR
// ============================================================

app.post(
  "/api/reward",
  function (req, res) {
    const username =
      sanitizeUsername(
        req.body &&
        req.body.username
      );

    if (!username) {
      return res.status(400).json({
        ok: false,

        error:
          "Usuário inválido"
      });
    }

    const rewarded =
      awardUser(username);

    if (!rewarded) {
      return res.status(404).json({
        ok: false,

        error:
          "Usuário não está na fila de recompensa"
      });
    }

    return res.json({
      ok: true,

      username: username,

      amount: 5000,

      balance:
        state.balance
    });
  }
);


// ============================================================
// EVENT STREAM
// ============================================================

app.get(
  "/api/event-stream",
  function (_req, res) {
    res.setHeader(
      "Content-Type",
      "text/event-stream"
    );

    res.setHeader(
      "Cache-Control",
      "no-cache, no-transform"
    );

    res.setHeader(
      "Connection",
      "keep-alive"
    );

    if (res.flushHeaders) {
      res.flushHeaders();
    }

    function send(payload) {
      res.write(
        "data: " +
        JSON.stringify(payload) +
        "\n\n"
      );
    }

    send({
      type: "state",

      payload: {
        connected:
          state.connected,

        balance:
          state.balance,

        ranking:
          getSortedRanking(),

        rewardQueue:
          state.rewardQueue,

        rewardHistory:
          state.rewardHistory,

        liveUsername:
          state.liveUsername
      }
    });

    const interval =
      setInterval(
        function () {
          send({
            type: "ping"
          });
        },
        20000
      );

    _req.on(
      "close",
      function () {
        clearInterval(interval);
      }
    );
  }
);


// ============================================================
// SOCKET.IO
// ============================================================

io.on(
  "connection",
  function (socket) {
    socket.emit(
      "state:update",
      {
        connected:
          state.connected,

        balance:
          state.balance,

        players:
          getSortedPlayers(),

        ranking:
          getSortedRanking(),

        rewardQueue:
          state.rewardQueue,

        rewardHistory:
          state.rewardHistory,

        liveUsername:
          state.liveUsername,

        status:
          state.connected
            ? "● LIVE CONECTADA"
            : "○ AGUARDANDO LIVE"
      }
    );
  }
);


// ============================================================
// TESTE GLOBAL
// ============================================================

globalThis.runSimulationTest =
  runSimulationTest;


// ============================================================
// SERVIDOR
// ============================================================

server.listen(
  PORT,
  function () {
    console.log(
      "Servidor rodando em http://localhost:" +
      PORT
    );

    console.log(
      "TIKTOK_USERNAME=" +
      TIKTOK_USERNAME
    );

    console.log(
      "SIMULATION_MODE=" +
      SIMULATION_MODE
    );

    emitState();

    if (!SIMULATION_MODE) {
      initTikTokLiveConnector();
    }
  }
);
