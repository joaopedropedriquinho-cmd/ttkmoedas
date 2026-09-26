const BASE_FOLLOWERS = [
  'Joao123',
  'gatun0010203',
  'Builderman',
  'Player_Roblox',
  'LuanGames',
  'PedroFPS',
  'MariaLive',
  'LucasBR',
  'AnaRoblox',
  'Gamer_2026',
  'RobloxPlayer',
  'PedroBR',
  'LucasFPS',
  'Player2026',
  'GamerBR',
  'RafaLive',
  'NinjaZone',
  'MayaraPlay',
  'KikoRush',
  'RinTecs'
];

const REWARD_AMOUNT = 5000;
const INITIAL_BALANCE = 8000000000;
const MAX_TOP = 10;

const balanceValueEl = document.getElementById('balanceValue');
const liveStatusTextEl = document.getElementById('liveStatusText');
const liveStatusPillEl = document.getElementById('liveStatusPill');
const top10ListEl = document.getElementById('top10List');
const typedNameEl = document.getElementById('typedName');
const roseNumberEl = document.getElementById('roseNumber');
const roseMeterEl = document.getElementById('roseMeter');
const roseStatusEl = document.getElementById('roseStatus');
const winnerBadgeEl = document.getElementById('winnerBadge');
const profileCardEl = document.getElementById('profileCard');
const profileAvatarEl = document.getElementById('profileAvatar');
const profileUsernameEl = document.getElementById('profileUsername');
const confirmButtonEl = document.getElementById('confirmButton');
const rewardButtonEl = document.getElementById('rewardButton');
const rewardDisplayEl = document.getElementById('rewardDisplay');
const rewardAmountEl = document.getElementById('rewardAmount');
const rewardHistoryEl = document.getElementById('rewardHistory');
const confettiLayerEl = document.getElementById('confettiLayer');
const finalAwardEl = document.getElementById('finalAward');
const finalNameEl = document.getElementById('finalName');
const finalAvatarEl = document.getElementById('finalAvatar');

const socket = window.io ? window.io() : null;

const state = {
  followers: [],
  rewardQueue: [],
  rewardHistory: [],
  balance: INITIAL_BALANCE,
  activePrize: null,
  processingReward: false,
  nextId: 1,
  connected: false,
  mode: 'simulation'
};

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(value);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFollower(name, roses = 0) {
  return {
    id: state.nextId++,
    name,
    roses
  };
}

function generateFollowerName() {
  const patterns = [
    'NovaGamer',
    'PlayerBR',
    'LiveNova',
    'SkyRoblox',
    'MestrePlay',
    'TurboBR',
    'DreamArena',
    'PixelLive',
    'MercuryX',
    'ZetaPlay',
    'CrewBoost',
    'BlueRush',
    'RoadLive'
  ];

  const base = patterns[Math.floor(Math.random() * patterns.length)];
  const suffix = Math.floor(Math.random() * 900 + 100);
  return `${base}${suffix}`;
}

function generateAvatarDataUri(username) {
  const initials = username.slice(0, 2).toUpperCase();
  const colors = ['#1f5fff', '#ff4ca6', '#4f7cff', '#ff7cbf', '#3d7af6'];
  const bg = colors[Math.abs(username.length) % colors.length];

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="${bg}"/>
          <stop offset="100%" stop-color="#ffc8e8"/>
        </linearGradient>
      </defs>
      <rect width="160" height="160" rx="80" fill="url(#g)"/>
      <circle cx="80" cy="62" r="28" fill="#ffffff" opacity="0.9"/>
      <path d="M40 134c10-23 32-36 40-36s30 13 40 36" fill="#ffffff" opacity="0.9"/>
      <text x="80" y="88" text-anchor="middle" font-size="32" font-family="Arial, sans-serif" font-weight="700" fill="#1f2a44">${initials}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function lookupProfile(username) {
  return {
    id: `user-${username.toLowerCase()}`,
    username,
    avatar: generateAvatarDataUri(username)
  };
}

function seedFollowers() {
  BASE_FOLLOWERS.forEach((name, index) => {
    const baseRoses = index % 4 === 0 ? 1 : index % 3 === 0 ? 2 : 0;
    state.followers.push(createFollower(name, baseRoses));
  });

  const extraCount = 6;
  for (let i = 0; i < extraCount; i += 1) {
    state.followers.push(createFollower(generateFollowerName(), Math.random() > 0.6 ? 1 : 0));
  }
}

function getSortedRanking() {
  return [...state.followers]
    .filter((follower) => follower.roses < 3)
    .sort((a, b) => b.roses - a.roses || a.name.localeCompare(b.name));
}

function renderTop10() {
  const ranking = getSortedRanking().slice(0, MAX_TOP);
  top10ListEl.innerHTML = '';

  ranking.forEach((follower, index) => {
    const item = document.createElement('li');
    item.className = 'top10-item';
    item.innerHTML = `
      <span class="position">${index + 1}.</span>
      <span class="user">@${follower.name}</span>
      <span class="rose-count">🌹 ${follower.roses}</span>
    `;
    top10ListEl.appendChild(item);
  });

  while (top10ListEl.children.length < MAX_TOP) {
    const filler = document.createElement('li');
    filler.className = 'top10-item';
    filler.innerHTML = `
      <span class="position">${top10ListEl.children.length + 1}.</span>
      <span class="user">@seguindo...</span>
      <span class="rose-count">🌹 0</span>
    `;
    top10ListEl.appendChild(filler);
  }
}

function renderRewardHistory() {
  rewardHistoryEl.innerHTML = '';

  state.rewardHistory.slice(0, 6).forEach((winner) => {
    const item = document.createElement('li');
    item.className = 'reward-item';
    item.innerHTML = `
      <div class="reward-user">
        <span class="tag">@</span>
        <span class="name">${winner.name}</span>
      </div>
      <div class="reward-meta">
        <span class="rose">🌹</span>
        <span>${winner.roses}</span>
        <span>+ ${formatNumber(winner.amount)}</span>
      </div>
    `;
    rewardHistoryEl.appendChild(item);
  });
}

function triggerBalanceAnimation() {
  balanceValueEl.parentElement.parentElement.classList.remove('pulse');
  void balanceValueEl.offsetWidth;
  balanceValueEl.parentElement.parentElement.classList.add('pulse');
}

function updateBalance() {
  balanceValueEl.textContent = formatNumber(state.balance);
  triggerBalanceAnimation();
}

function updateLiveStatus() {
  const isConnected = state.connected;
  liveStatusTextEl.textContent = isConnected ? '● LIVE CONECTADA' : '○ AGUARDANDO LIVE';
  liveStatusPillEl.classList.toggle('connected', isConnected);
  liveStatusPillEl.classList.toggle('offline', !isConnected);
}

function createConfettiBurst() {
  const colors = ['#ff4ca6', '#1f5fff', '#ff9bd2', '#70a3ff', '#ffffff'];

  for (let i = 0; i < 22; i += 1) {
    const confetti = document.createElement('span');
    confetti.className = 'confetti';
    confetti.style.background = colors[i % colors.length];
    confetti.style.setProperty('--x', `${(Math.random() - 0.5) * 220}px`);
    confetti.style.setProperty('--y', `${-40 - Math.random() * 120}px`);
    confetti.style.setProperty('--rot', `${(Math.random() * 260 - 130).toFixed(0)}deg`);
    confettiLayerEl.appendChild(confetti);
    setTimeout(() => confetti.remove(), 1200);
  }
}

function resetPrizeStage() {
  profileCardEl.classList.add('hidden');
  profileCardEl.classList.remove('show');
  confirmButtonEl.classList.add('hidden');
  confirmButtonEl.disabled = false;
  rewardButtonEl.classList.add('hidden');
  rewardButtonEl.disabled = false;
  rewardDisplayEl.classList.add('hidden');
  rewardDisplayEl.classList.remove('show');
  finalAwardEl.classList.add('hidden');
  finalAwardEl.classList.remove('show');
  rewardAmountEl.textContent = '+5.000';
  winnerBadgeEl.classList.remove('show');
  roseStatusEl.classList.remove('show');
  roseMeterEl.classList.remove('complete', 'pulse');
  roseNumberEl.textContent = '0';
  typedNameEl.textContent = '';
}

async function typeUsername(name) {
  typedNameEl.textContent = '';

  for (let index = 1; index <= name.length; index += 1) {
    typedNameEl.textContent = name.slice(0, index);
    await wait(90 + Math.random() * 35);
  }

  await wait(180);
}

function showProfileCard(profile) {
  profileCardEl.classList.remove('hidden');
  profileCardEl.classList.add('show');
  profileAvatarEl.src = profile.avatar;
  profileUsernameEl.textContent = `@${profile.username}`;
}

function showConfirmButton() {
  confirmButtonEl.classList.remove('hidden');
  confirmButtonEl.disabled = false;
}

function showRewardInput() {
  rewardDisplayEl.classList.remove('hidden');
  rewardDisplayEl.classList.add('show');
}

function showRewardButton() {
  rewardButtonEl.classList.remove('hidden');
  rewardButtonEl.disabled = false;
}

function waitForClick(button) {
  return new Promise((resolve) => {
    const handleClick = () => {
      button.removeEventListener('click', handleClick);
      resolve();
    };

    button.addEventListener('click', handleClick, { once: true });
  });
}

async function typeRewardValue() {
  const steps = ['+5', '+50', '+500', '+5.000'];

  rewardDisplayEl.classList.remove('hidden');
  rewardDisplayEl.classList.add('show');

  for (const step of steps) {
    rewardAmountEl.textContent = step;
    await wait(210);
  }

  rewardAmountEl.textContent = '+5.000';
  await wait(200);
}

function showFinalAward(profile) {
  finalAwardEl.classList.remove('hidden');
  finalAwardEl.classList.add('show');
  finalAvatarEl.src = profile.avatar;
  finalNameEl.textContent = `@${profile.username}`;
  createConfettiBurst();
}

function updateTop10AndFinishWinner(winner) {
  state.followers = state.followers.filter((follower) => follower.id !== winner.id);
  renderTop10();
}

async function processPrizeWinner(winner) {
  const profile = lookupProfile(winner.name);

  state.processingReward = true;
  state.activePrize = winner;
  resetPrizeStage();

  roseNumberEl.textContent = '3';
  roseMeterEl.classList.add('complete');
  roseStatusEl.textContent = '🌹 3 ROSAS';
  roseStatusEl.classList.add('show');
  winnerBadgeEl.classList.add('show');

  await typeUsername(winner.name);

  showProfileCard(profile);
  await wait(260);
  showConfirmButton();
  await waitForClick(confirmButtonEl);
  confirmButtonEl.classList.add('hidden');

  await typeRewardValue();
  showRewardButton();
  await waitForClick(rewardButtonEl);
  rewardButtonEl.classList.add('hidden');

  state.balance += REWARD_AMOUNT;
  updateBalance();

  state.rewardHistory.unshift({ name: winner.name, roses: 3, amount: REWARD_AMOUNT });
  renderRewardHistory();

  showFinalAward(profile);
  await wait(1700);

  updateTop10AndFinishWinner(winner);

  state.activePrize = null;
  state.processingReward = false;
  resetPrizeStage();
}

function queueWinner(winner) {
  state.rewardQueue.push(winner);
  if (!state.processingReward) {
    processQueue();
  }
}

async function processQueue() {
  if (state.processingReward || state.rewardQueue.length === 0) {
    return;
  }

  const nextWinner = state.rewardQueue.shift();
  await processPrizeWinner(nextWinner);

  if (state.rewardQueue.length > 0) {
    processQueue();
  }
}

function addRoseToRandomFollower() {
  const ranking = getSortedRanking();
  if (!ranking.length) {
    const follower = createFollower(generateFollowerName(), 0);
    state.followers.push(follower);
    renderTop10();
    return;
  }

  const target = ranking[Math.floor(Math.random() * ranking.length)];
  const existing = state.followers.find((follower) => follower.id === target.id);

  if (!existing) {
    return;
  }

  existing.roses += 1;

  if (existing.roses >= 3) {
    state.followers = state.followers.filter((follower) => follower.id !== existing.id);
    queueWinner({ id: existing.id, name: existing.name, roses: 3 });
  }

  renderTop10();
}

function addNewFollower() {
  const randomName = generateFollowerName();
  const existing = state.followers.some((follower) => follower.name === randomName);

  if (!existing) {
    const follower = createFollower(randomName, Math.random() > 0.7 ? 1 : 0);
    state.followers.push(follower);
  }

  renderTop10();
}

function simulateLiveEvent() {
  const shouldAddNew = Math.random() < 0.38 || state.followers.length < 10;

  if (shouldAddNew) {
    addNewFollower();
  }

  if (state.followers.length > 0 && Math.random() < 0.72) {
    addRoseToRandomFollower();
  }
}

function applyStateFromServer(payload = {}) {
  if (!payload) return;

  const ranking = Array.isArray(payload.ranking) ? payload.ranking : [];
  const rewardQueue = Array.isArray(payload.rewardQueue) ? payload.rewardQueue : [];
  const rewardHistory = Array.isArray(payload.rewardHistory) ? payload.rewardHistory : [];

  state.balance = Number(payload.balance || state.balance);
  state.followers = ranking.map((user, index) => ({
    id: user.id || `${user.username || 'user'}-${index}`,
    name: user.username || user.name || 'usuario',
    username: user.username || user.name || 'usuario',
    roses: Number(user.roses || 0),
    position: index + 1,
    avatar: user.avatar || generateAvatarDataUri(user.username || user.name || 'user')
  }));
  state.rewardQueue = rewardQueue;
  state.rewardHistory = rewardHistory;
  state.connected = Boolean(payload.connected);
  state.mode = payload.liveUsername ? 'tiktok' : 'simulation';

  updateBalance();
  updateLiveStatus();
  renderTop10();
  renderRewardHistory();
}

function initializeSocket() {
  if (!socket) {
    return;
  }

  socket.on('connect', () => {
    state.connected = true;
    updateLiveStatus();
  });

  socket.on('state:update', (payload) => {
    applyStateFromServer(payload);
  });
}

function initialize() {
  state.followers = [];
  state.rewardQueue = [];
  state.rewardHistory = [];
  state.balance = INITIAL_BALANCE;

  seedFollowers();
  updateBalance();
  renderTop10();
  renderRewardHistory();
  resetPrizeStage();
  updateLiveStatus();
  initializeSocket();

  if (!socket) {
    setInterval(simulateLiveEvent, 1800);
  }
}

initialize();
