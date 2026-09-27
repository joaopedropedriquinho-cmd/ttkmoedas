const profileForm = document.getElementById("profileSearchForm");
const usernameInput = document.getElementById("tiktokUsername");
const profileMessage = document.getElementById("profileMessage");
const profilePreview = document.getElementById("profilePreview");
const manualVerificationWrap = document.getElementById("manualVerificationWrap");
const manualVerification = document.getElementById("manualVerification");
const awardForm = document.getElementById("awardForm");
const awardCoins = document.getElementById("awardCoins");
const awardButton = document.getElementById("awardButton");
const roseEquivalent = document.getElementById("roseEquivalent");
const confirmDialog = document.getElementById("confirmRewardDialog");
const balanceValue = document.getElementById("balanceValue");
const availableBalance = document.getElementById("availableBalance");
const awardMessage = document.getElementById("awardMessage");
const numberFormat = new Intl.NumberFormat("pt-BR");
const roseNumberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
let selectedProfile = null;
let profileSearchTimer = null;
let profileRequest = null;
let historyRequestId = 0;
let historyTimer = null;
let awardSubmitted = false;
let pendingAward = null;
let currentBalance = null;

function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@/, "");
}

function setProfileMessage(message, isError = false) {
  profileMessage.textContent = message;
  profileMessage.classList.toggle("error", isError);
}

function setAvatar(image, missing, url) {
  image.onerror = () => {
    image.classList.add("hidden");
    missing.classList.remove("hidden");
  };

  if (url) {
    missing.classList.add("hidden");
    image.src = url;
    image.classList.remove("hidden");
  } else {
    image.removeAttribute("src");
    image.classList.add("hidden");
    missing.classList.remove("hidden");
  }
}

function updateAwardButton() {
  const amount = Number(awardCoins.value);
  const recipientReady = Boolean(selectedProfile || manualVerification.checked);
  const validAmount = Number.isSafeInteger(amount) && amount > 0;
  const insufficient = currentBalance !== null && validAmount && amount > currentBalance;
  updateRoseEquivalent(amount, validAmount);
  awardMessage.textContent = insufficient ? "Saldo insuficiente." : "";
  awardMessage.classList.toggle("error", insufficient);
  awardButton.disabled = !recipientReady || !validAmount || currentBalance === null || insufficient || awardSubmitted;
}

function setAvailableBalance(value) {
  if (!Number.isSafeInteger(value) || value < 0) return;

  const decreased = currentBalance !== null && value < currentBalance;
  currentBalance = value;
  balanceValue.textContent = numberFormat.format(value);
  updateAwardButton();

  if (decreased) {
    availableBalance.classList.remove("balance-decreased");
    void availableBalance.offsetWidth;
    availableBalance.classList.add("balance-decreased");
    setTimeout(() => availableBalance.classList.remove("balance-decreased"), 650);
  }
}

async function loadBalance() {
  const response = await fetch("/api/balance");
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível carregar o saldo.");
  setAvailableBalance(result.balance);
}

function clearProfileSelection() {
  selectedProfile = null;
  manualVerification.checked = false;
  manualVerificationWrap.classList.add("hidden");
  profilePreview.classList.add("hidden");
  document.getElementById("profileExternalLink").classList.add("hidden");
  updateAwardButton();
}

function showProfile(profile) {
  selectedProfile = profile;
  manualVerification.checked = false;
  manualVerificationWrap.classList.add("hidden");
  profilePreview.classList.remove("hidden");
  document.getElementById("profileDisplayName").textContent = profile.displayName || profile.username;
  document.getElementById("profileUsername").textContent = `@${profile.username}`;
  document.getElementById("profileVerification").textContent = profile.profileVerified
    ? `Perfil encontrado${profile.verified ? " · verificado pelo TikTok" : ""} ✓`
    : "Perfil não confirmado automaticamente";
  setAvatar(document.getElementById("profileAvatar"), document.getElementById("profilePhotoMissing"), profile.avatarUrl);

  const externalLink = document.getElementById("profileExternalLink");
  externalLink.href = `https://www.tiktok.com/@${encodeURIComponent(profile.username)}`;
  externalLink.classList.remove("hidden");
  updateAwardButton();
}

function showManualVerification(username, message) {
  showProfile({ username, displayName: username, avatarUrl: null, profileVerified: false, verified: false });
  selectedProfile = null;
  document.getElementById("profileVerification").textContent = "Perfil não confirmado automaticamente";
  manualVerificationWrap.classList.remove("hidden");
  setProfileMessage(message, true);
  updateAwardButton();
}

async function searchProfile() {
  const username = normalizeUsername(usernameInput.value);
  if (!/^[a-zA-Z0-9._]{2,24}$/.test(username)) {
    clearProfileSelection();
    setProfileMessage("Digite um nickname válido com 2 a 24 caracteres.", true);
    return;
  }

  if (profileRequest) profileRequest.abort();
  profileRequest = new AbortController();
  clearProfileSelection();
  awardSubmitted = false;
  document.getElementById("successPanel").classList.add("hidden");
  document.getElementById("profileSearchButton").disabled = true;
  setProfileMessage("Consultando o perfil público do TikTok...");

  try {
    const response = await fetch(`/api/tiktok/profile?username=${encodeURIComponent(username)}`, { signal: profileRequest.signal });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      if (["TIKTOK_BLOCKED", "TIKTOK_UNAVAILABLE", "TIKTOK_PROFILE_UNAVAILABLE"].includes(result.code)) {
        showManualVerification(username, `${result.error} Confira o perfil antes de continuar sem foto automática.`);
      } else {
        setProfileMessage(result.error || "Usuário do TikTok não encontrado.", true);
      }
      return;
    }

    showProfile(result.profile);
    setProfileMessage("Perfil encontrado ✓");
  } catch (error) {
    if (error.name !== "AbortError") {
      showManualVerification(username, "A consulta automática não respondeu. Confira o perfil no TikTok antes de continuar.");
    }
  } finally {
    document.getElementById("profileSearchButton").disabled = false;
  }
}

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearTimeout(profileSearchTimer);
  searchProfile();
});

usernameInput.addEventListener("input", () => {
  clearTimeout(profileSearchTimer);
  if (profileRequest) profileRequest.abort();
  clearProfileSelection();
  awardSubmitted = false;
  document.getElementById("successPanel").classList.add("hidden");

  if (normalizeUsername(usernameInput.value).length >= 2) {
    profileSearchTimer = setTimeout(searchProfile, 650);
  } else {
    setProfileMessage("Digite um nickname para consultar o perfil público.");
  }
});

manualVerification.addEventListener("change", updateAwardButton);
awardCoins.addEventListener("input", updateAwardButton);

awardForm.addEventListener("submit", (event) => {
  event.preventDefault();
  updateAwardButton();
  if (awardButton.disabled) return;

  const username = selectedProfile ? selectedProfile.username : normalizeUsername(usernameInput.value);
  pendingAward = {
    username,
    coins: Number(awardCoins.value),
    manualVerified: !selectedProfile
  };

  document.getElementById("confirmUsername").textContent = `@${username}`;
  document.getElementById("confirmCoins").textContent = `🪙 ${numberFormat.format(pendingAward.coins)} moedas`;
  document.getElementById("confirmVerificationNote").textContent = pendingAward.manualVerified
    ? "Identidade conferida manualmente. A foto do perfil não foi obtida automaticamente."
    : "Perfil e foto obtidos da página pública do TikTok.";
  setAvatar(document.getElementById("confirmAvatar"), document.getElementById("confirmPhotoMissing"), selectedProfile && selectedProfile.avatarUrl);
  confirmDialog.showModal();
});

document.getElementById("cancelRewardButton").addEventListener("click", () => confirmDialog.close());

document.getElementById("confirmRewardForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingAward) return;

  const confirmButton = document.getElementById("confirmRewardButton");
  confirmButton.disabled = true;

  try {
    const response = await fetch("/api/rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pendingAward)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível registrar o prêmio.");

    confirmDialog.close();
    const reward = result.reward;
    document.getElementById("successPanel").classList.remove("hidden");
    document.getElementById("successUsername").textContent = `@${reward.username}`;
    document.getElementById("successCoins").textContent = `🪙 ${numberFormat.format(reward.coins)} moedas`;
    document.getElementById("successSummary").textContent = `Resgate previsto até ${dateFormat.format(new Date(reward.redeemBy))}.`;
    document.getElementById("successBalance").textContent = `Saldo: ${numberFormat.format(reward.balanceBefore)} -> ${numberFormat.format(reward.balanceAfter)}`;
    setAvatar(document.getElementById("successAvatar"), document.getElementById("successPhotoMissing"), reward.avatarUrl);
    setAvailableBalance(result.balance);
    awardSubmitted = true;
    updateAwardButton();
    pendingAward = null;
    await loadRewards(document.getElementById("rewardSearch").value);
  } catch (error) {
    setProfileMessage(error.message, true);
    confirmDialog.close();
  } finally {
    confirmButton.disabled = false;
  }
});

function createHistoryItem(reward) {
  const item = document.createElement("article");
  item.className = "reward-history-item";

  const photo = document.createElement("div");
  photo.className = "history-photo-wrap";
  if (reward.avatarUrl) {
    const image = document.createElement("img");
    image.src = reward.avatarUrl;
    image.alt = `Foto de ${reward.displayName || reward.username}`;
    image.onerror = () => {
      image.remove();
      photo.textContent = "FOTO INDISPONÍVEL";
      photo.classList.add("photo-unavailable");
    };
    photo.appendChild(image);
  } else {
    photo.textContent = "FOTO INDISPONÍVEL";
    photo.classList.add("photo-unavailable");
  }

  const content = document.createElement("div");
  content.className = "history-reward-content";
  const topRow = document.createElement("div");
  topRow.className = "history-reward-top";
  const identity = document.createElement("div");
  identity.className = "history-identity";
  const displayName = document.createElement("strong");
  displayName.textContent = reward.displayName || reward.username;
  const username = document.createElement("span");
  username.textContent = `@${reward.username}`;
  identity.append(displayName, username);

  const status = document.createElement("span");
  status.className = `reward-status status-${reward.status}`;
  status.textContent = {
    sent: "PRESENTE ENVIADO · INTERNO",
    processing: "EM PROCESSAMENTO",
    redeemed: "RESGATADO",
    cancelled: "CANCELADO"
  }[reward.status] || reward.status;
  topRow.append(identity, status);

  const coins = document.createElement("strong");
  coins.className = "history-coins";
  coins.textContent = `🪙 ${numberFormat.format(reward.coins)} moedas`;
  const verification = document.createElement("span");
  verification.className = "history-verification";
  verification.textContent = reward.profileVerified ? "Perfil confirmado pelo TikTok" : "Identidade conferida manualmente; sem foto automática";
  const dates = document.createElement("div");
  dates.className = "history-dates";
  const created = document.createElement("span");
  created.textContent = dateFormat.format(new Date(reward.createdAt));
  const redeem = document.createElement("span");
  redeem.textContent = `Resgate previsto até ${dateFormat.format(new Date(reward.redeemBy))}`;
  dates.append(created, redeem);
  if (Number.isSafeInteger(reward.balanceBefore) && Number.isSafeInteger(reward.balanceAfter)) {
    const balanceChange = document.createElement("span");
    balanceChange.className = "history-balance-change";
    balanceChange.textContent = `Saldo: ${numberFormat.format(reward.balanceBefore)} -> ${numberFormat.format(reward.balanceAfter)}`;
    dates.appendChild(balanceChange);
  }
  content.append(topRow, coins, verification, dates);
  item.append(photo, content);
  return item;
}

async function loadRewards(search = "") {
  const requestId = ++historyRequestId;
  const response = await fetch(`/api/rewards?search=${encodeURIComponent(search.trim())}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível carregar o histórico.");
  if (requestId !== historyRequestId) return;

  const history = document.getElementById("rewardHistory");
  document.getElementById("rewardCount").textContent = `${result.length} ${result.length === 1 ? "PRÊMIO" : "PRÊMIOS"}`;
  history.replaceChildren();
  if (!result.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = search ? "Nenhuma premiação encontrada para esse nickname." : "Ainda não há premiações registradas.";
    history.appendChild(empty);
    return;
  }

  result.forEach((reward) => history.appendChild(createHistoryItem(reward)));
}

document.getElementById("rewardSearch").addEventListener("input", (event) => {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => {
    loadRewards(event.target.value).catch((error) => setProfileMessage(error.message, true));
  }, 250);
});

loadRewards().catch((error) => setProfileMessage(error.message, true));
loadBalance().catch((error) => {
  awardMessage.textContent = error.message;
  awardMessage.classList.add("error");
});

if (window.io) {
  const socket = window.io();
  socket.on("rewards:update", () => {
    loadRewards(document.getElementById("rewardSearch").value).catch((error) => setProfileMessage(error.message, true));
  });
  socket.on("balance:update", (state) => setAvailableBalance(state.balance));
}

function updateRoseEquivalent(amount, validAmount) {
  if (!validAmount) {
    roseEquivalent.textContent = "";
    roseEquivalent.classList.add("hidden");
    return;
  }

  const roses = amount / 1000;
  const label = Number.isInteger(roses) && roses === 1 ? "rosa" : Number.isInteger(roses) ? "rosas" : "rosas equivalentes";
  roseEquivalent.textContent = `🌹 ${roseNumberFormat.format(roses)} ${label}`;
  roseEquivalent.classList.remove("hidden");
}