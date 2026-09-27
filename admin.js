const playerForm = document.getElementById("playerForm");
const adminPlayerList = document.getElementById("adminPlayerList");
const adminMessage = document.getElementById("adminMessage");
const playerCount = document.getElementById("playerCount");
const playerDialog = document.getElementById("playerDialog");
const coinDialog = document.getElementById("coinDialog");
const numberFormat = new Intl.NumberFormat("pt-BR");

function showMessage(message, isError = false) {
  adminMessage.textContent = message;
  adminMessage.classList.toggle("error", isError);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível concluir a operação.");
  return result;
}

function addActionButton(actions, text, action, player) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `admin-action ${action}`;
  button.textContent = text;
  button.dataset.action = action;
  button.dataset.playerId = player.id;
  actions.appendChild(button);
}

function renderPlayers(players) {
  playerCount.textContent = `${players.length} ${players.length === 1 ? "JOGADOR" : "JOGADORES"}`;
  adminPlayerList.replaceChildren();

  if (!players.length) {
    const empty = document.createElement("p");
    empty.className = "ranking-empty admin-empty";
    empty.textContent = "Nenhum jogador cadastrado.";
    adminPlayerList.appendChild(empty);
    return;
  }

  players.forEach((player) => {
    const card = document.createElement("article");
    card.className = "admin-player-card";

    const info = document.createElement("div");
    info.className = "admin-player-info";

    const name = document.createElement("h3");
    name.textContent = player.name;
    const coins = document.createElement("p");
    coins.className = "admin-player-coins";
    coins.textContent = `🪙 ${numberFormat.format(player.coins)} moedas`;
    info.append(name, coins);

    const actions = document.createElement("div");
    actions.className = "admin-actions";
    addActionButton(actions, "+ MOEDAS", "add-coins", player);
    addActionButton(actions, "- MOEDAS", "remove-coins", player);
    addActionButton(actions, "EDITAR", "edit-player", player);
    addActionButton(actions, "EXCLUIR", "delete-player", player);

    card.append(info, actions);
    adminPlayerList.appendChild(card);
  });
}

async function loadPlayers() {
  renderPlayers(await request("/api/players"));
}

playerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = playerForm.querySelector("button[type=submit]");
  submitButton.disabled = true;

  try {
    await request("/api/players", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("playerName").value,
        coins: Number(document.getElementById("playerCoins").value)
      })
    });
    playerForm.reset();
    showMessage("Jogador adicionado ao ranking.");
    await loadPlayers();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

adminPlayerList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const playerId = button.dataset.playerId;
  const action = button.dataset.action;

  try {
    const players = await request("/api/players");
    const player = players.find((item) => item.id === playerId);
    if (!player) throw new Error("Jogador não encontrado.");

    if (action === "edit-player") {
      document.getElementById("editPlayerId").value = player.id;
      document.getElementById("editPlayerName").value = player.name;
      document.getElementById("editPlayerCoins").value = player.coins;
      playerDialog.showModal();
      return;
    }

    if (action === "add-coins" || action === "remove-coins") {
      const adding = action === "add-coins";
      document.getElementById("coinPlayerId").value = player.id;
      document.getElementById("coinDialogTitle").textContent = adding ? "Adicionar moedas" : "Remover moedas";
      document.getElementById("coinDialogPlayer").textContent = `${player.name} · ${numberFormat.format(player.coins)} moedas`;
      coinDialog.dataset.operation = adding ? "add" : "remove";
      document.getElementById("coinAmount").value = "";
      coinDialog.showModal();
      return;
    }

    if (action === "delete-player" && window.confirm(`Excluir ${player.name} do ranking? Esta ação não pode ser desfeita.`)) {
      await request(`/api/players/${encodeURIComponent(player.id)}`, { method: "DELETE" });
      showMessage(`${player.name} foi removido do ranking.`);
      await loadPlayers();
    }
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.getElementById("playerDialogForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const playerId = document.getElementById("editPlayerId").value;

  try {
    await request(`/api/players/${encodeURIComponent(playerId)}`, {
      method: "PUT",
      body: JSON.stringify({
        name: document.getElementById("editPlayerName").value,
        coins: Number(document.getElementById("editPlayerCoins").value)
      })
    });
    playerDialog.close();
    showMessage("Dados do jogador atualizados.");
    await loadPlayers();
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.getElementById("coinDialogForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const playerId = document.getElementById("coinPlayerId").value;

  try {
    await request(`/api/players/${encodeURIComponent(playerId)}/coins`, {
      method: "POST",
      body: JSON.stringify({
        operation: coinDialog.dataset.operation,
        amount: Number(document.getElementById("coinAmount").value)
      })
    });
    coinDialog.close();
    showMessage("Saldo atualizado.");
    await loadPlayers();
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

loadPlayers().catch((error) => showMessage(error.message, true));

if (window.io) {
  const socket = window.io();
  socket.on("state:update", (state) => {
    if (Array.isArray(state.players)) renderPlayers(state.players);
  });
}