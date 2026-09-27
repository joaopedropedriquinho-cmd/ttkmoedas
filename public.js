const rankingList = document.getElementById("top10List");
const featuredPlayer = document.getElementById("featuredPlayer");
const playerCount = document.getElementById("playerCount");
const balanceValue = document.getElementById("balanceValue");
const numberFormat = new Intl.NumberFormat("pt-BR");
let previousCoins = new Map();

function formatCoins(value) {
  return numberFormat.format(value);
}

function createCoinLabel(coins) {
  const label = document.createElement("span");
  label.className = "rose-count";
  label.textContent = `🪙 ${formatCoins(coins)}`;
  return label;
}

function renderFeatured(player) {
  featuredPlayer.replaceChildren();

  if (!player) {
    const empty = document.createElement("span");
    empty.className = "featured-name";
    empty.textContent = "Adicione jogadores pelo painel";
    featuredPlayer.append(empty, createCoinLabel(0));
    return;
  }

  const medal = document.createElement("span");
  medal.className = "featured-medal";
  medal.textContent = "🏆";
  medal.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  name.className = "featured-name";
  name.textContent = player.name;

  const coins = createCoinLabel(player.coins);
  coins.classList.add("featured-coins");
  featuredPlayer.append(medal, name, coins);
}

function renderPlayers(players) {
  const sortedPlayers = [...players].sort((a, b) => b.coins - a.coins || a.name.localeCompare(b.name, "pt-BR"));
  const totalCoins = sortedPlayers.reduce((total, player) => total + BigInt(player.coins), 0n);
  balanceValue.textContent = formatCoins(totalCoins);
  playerCount.textContent = `${sortedPlayers.length} ${sortedPlayers.length === 1 ? "JOGADOR" : "JOGADORES"}`;
  renderFeatured(sortedPlayers[0]);
  rankingList.replaceChildren();

  if (!sortedPlayers.length) {
    const empty = document.createElement("li");
    empty.className = "ranking-empty";
    empty.textContent = "O ranking ainda não tem jogadores.";
    rankingList.appendChild(empty);
    previousCoins = new Map();
    return;
  }

  const nextCoins = new Map();
  sortedPlayers.forEach((player, index) => {
    const position = index + 1;
    const item = document.createElement("li");
    item.className = `top10-item leaderboard-item${position <= 3 ? ` place-${position}` : ""}`;
    item.setAttribute("aria-label", `${position}º lugar, ${player.name}, ${formatCoins(player.coins)} moedas`);

    const positionLabel = document.createElement("span");
    positionLabel.className = "position";
    positionLabel.textContent = ["🥇", "🥈", "🥉"][index] || `${position}.`;

    const name = document.createElement("span");
    name.className = "user";
    name.textContent = player.name;

    const coins = createCoinLabel(player.coins);
    if (previousCoins.has(player.id) && previousCoins.get(player.id) !== player.coins) {
      coins.classList.add("coin-updated");
    }

    item.append(positionLabel, name, coins);
    rankingList.appendChild(item);
    nextCoins.set(player.id, player.coins);
  });

  previousCoins = nextCoins;
}

async function loadPlayers() {
  const response = await fetch("/api/players");
  if (!response.ok) throw new Error("Não foi possível carregar o ranking.");
  renderPlayers(await response.json());
}

loadPlayers().catch((error) => {
  const message = document.createElement("li");
  message.className = "ranking-empty";
  message.textContent = error.message;
  rankingList.replaceChildren(message);
});

if (window.io) {
  const socket = window.io();
  socket.on("state:update", (state) => {
    if (Array.isArray(state.players)) renderPlayers(state.players);
  });
}