import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { DiscordSDK } from "https://esm.sh/@discord/embedded-app-sdk";
// ==========================================
// GLOBÁLIS VÁLTOZÓK ÉS ELEMEK
// ==========================================

const Body = document.body;
const Raccoon = document.querySelector('#Raccoon');

let PetData = null;
let Raccooins = 100;
let RelationshipPoints = 0;
let currentSaveKey = null;

// ==========================================
// SUPABASE & DISCORD SDK KONFIGURÁCIÓ
// ==========================================

const SUPABASE_URL = "https://borusbjllkypavkoujqk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvcnVzYmpsbGt5cGF2a291anFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NzgzMzEsImV4cCI6MjA5NzU1NDMzMX0.LD1tM6qd9DdSK0SL4DGQyK0Zb-X-chgR1IokR_m2Ox4";
let supabaseClient;

function initSupabase() {
    // Közvetlenül inicializáljuk az importált createClient-tel, elkerülve a 'supabase is not defined' hibát
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

supabaseClient = initSupabase();

const isDiscordActivity =
    window.location.search.includes("frame_id=") ||
    window.location.search.includes("instance_id=");

let discordSdk = null;

try {
    if (isDiscordActivity) {
        discordSdk = new DiscordSDK('1088855742502678538');
    }
} catch (err) {
    console.warn("Discord SDK unavailable, running in web mode.", err);
}
// ==========================================
// DISCORD ACTIVITY INDÍTÁS ÉS PRESENCE
// ==========================================

async function setupDiscordActivity() {
    if (!discordSdk) {
        console.log("Local mode — no Discord SDK.");
        currentSaveKey = "default_local_testing";
        FetchPetData();
        return;
    }
    try {
        await discordSdk.ready();
        await discordSdk.commands.authorize({
            client_id: "1088855742502678538",
            response_type: "code",
            state: "",
            prompt: "none",
            scope: ["identify", "guilds.join"],
        });
        currentSaveKey = discordSdk.guildId || discordSdk.channelId || "default_local_testing";
        
        // Frissítjük a Discord Rich Presence státuszt az érvényes asset névvel
        await updateDiscordPresence();

        FetchPetData();
    } catch (error) {
        console.error("Discord Activity error:", error);
        currentSaveKey = "default_local_testing";
        FetchPetData();
    }
}

// A státusz frissítése a helyes háttérképpel és névvel
async function updateDiscordPresence() {
    try {
        await discordSdk.commands.setActivity({
            activity: {
                type: 0, // 0 = Playing (Játszik)
                details: "Chilling with Luna 🦝",
                state: "Virtual Pet Activity",
                assets: {
                    large_image: "embedded_cover", 
                    large_text: "Luna" 
                }
            }
        });
        console.log("Discord Rich Presence successfully updated with embedded_cover!");
    } catch (err) {
        console.error("Failed to update Discord Rich Presence:", err);
    }
}

// ==========================================
// SUPABASE ADATKEZELÉS
// ==========================================

async function FetchPetData() {
    if (!currentSaveKey) return;
    try {
        let { data, error } = await supabaseClient
            .from('luna_data')
            .select('*')
            .eq('guild_id', currentSaveKey)
            .single();

        if (error && error.code === 'PGRST116') {
            const { data: newPet, error: insertError } = await supabaseClient
                .from('luna_data')
                .insert([{ guild_id: currentSaveKey, name: 'Luna', raccooin: 100, relationship_points: 0 }])
                .select()
                .single();
            if (insertError) throw insertError;
            data = newPet;
        } else if (error) {
            throw error;
        }

        PetData = data;
        Raccooins = data.raccooin || 100;
        RelationshipPoints = data.relationship_points || 0;

        const petNameEl = document.querySelector('#PetName');
        if (petNameEl) petNameEl.innerText = data.name;

        UpdateUI();
        console.log("Pet data loaded:", PetData);
    } catch (err) {
        console.error("Failed to load pet data:", err);
    }
}

async function SavePetData() {
    if (!currentSaveKey) return;
    try {
        const { error } = await supabaseClient
            .from('luna_data')
            .upsert({
                guild_id: currentSaveKey,
                raccooin: Raccooins,
                relationship_points: RelationshipPoints,
                name: document.querySelector('#PetName')?.innerText || 'Luna'
            });
        if (error) throw error;
    } catch (err) {
        console.error("Failed to save pet data:", err);
    }
}

// ==========================================
// NÉVVÁLTOZTATÁS MENTÉSE
// ==========================================

document.querySelector('#PetName').addEventListener('blur', () => {
    const NewName = document.querySelector('#PetName').textContent.trim();
    if (NewName && currentSaveKey) {
        SavePetData();
    }
});

// ==========================================
// RELATIONSHIP SZINTEK
// ==========================================

const RelationshipLevels = [
    { level: 1, name: "Strangers",     threshold: 0 },
    { level: 2, name: "Acquaintances", threshold: 1000 },
    { level: 3, name: "Friends",       threshold: 5000 },
    { level: 4, name: "Good Friends",  threshold: 15000 },
    { level: 5, name: "Close Friends", threshold: 40000 },
    { level: 6, name: "Besto Frendo",  threshold: 100000 },
    { level: 7, name: "Inseparable",   threshold: 250000 },
    { level: 8, name: "Soulmates",     threshold: 600000 }
];

function GetCurrentLevel(points) {
    let CurrentLevel = RelationshipLevels[0];
    for (const Level of RelationshipLevels) {
        if (points >= Level.threshold) {
            CurrentLevel = Level;
        } else {
            break;
        }
    }
    return CurrentLevel;
}

// ==========================================
// IDŐZÍTŐK & COOLDOWN
// ==========================================

let ActivityTimer = null;
let SleepTimer = null;
const SleepDelay = 5 * 60 * 1000;
let isPlaying = false;

const ActivityCooldowns = {
    Feed: 0,
    Water: 0
};

const MinigameCooldowns = [0, 0, 0, 0, 0, 0];
const MinigameLocked = [false, false, false, false, false, false];
let MinigameCooldownTimer = null;

// ==========================================
// MINIJÁTÉK RENDSZER VÁLTOZÓI
// ==========================================

let currentGameIndex = 0;
const totalGames = 6;
const gameLimits = [5000, 100000, 250000, 20000, 10000, 600000];
const gameTitles = ["Tic-Tac-Toe", "Luna Memory Match", "Sushi Tap", "Word Scramble", "Cookie Catcher", "Fortune Cookie Cracker"];

// ==========================================
// HÁTTÉR (NAP/ÉJ CIKLUS)
// ==========================================

const DayBackgrounds = [
    "url('imgs/daylight_wp_1.jpg')",
    "url('imgs/daylight_wp_2.png')"
];

const NightBackgrounds = [
    "url('imgs/night_wp_1.jpg')",
    "url('imgs/night_wp_2.jpg')"
];

function SetBackground() {
    const Hour = new Date().getHours();
    const IsDay = Hour >= 6 && Hour < 20;

    if (IsDay) {
        const DayHour = Hour - 6;
        const Index = DayHour % DayBackgrounds.length;
        Body.style.backgroundImage = DayBackgrounds[Index];

        if (Index === 0) {
            document.documentElement.style.setProperty('--panel-bg', 'linear-gradient(160deg, #3a1f0f 0%, #1a0c06 50%, #0f0804 100%)');
            document.documentElement.style.setProperty('--panel-border', '#6b3a1f');
            document.documentElement.style.setProperty('--button-bg', 'linear-gradient(135deg, #7c4f2d, #5c3a21)');
            document.documentElement.style.setProperty('--button-border', '#9a6040');
            document.documentElement.style.setProperty('--text-accent', '#f3da90');
            document.documentElement.style.setProperty('--pet-name-color', '#f3c4d8');
        } else {
            document.documentElement.style.setProperty('--panel-bg', 'linear-gradient(160deg, #1b263b 0%, #0d1b2a 50%, #010811 100%)');
            document.documentElement.style.setProperty('--panel-border', '#415a77');
            document.documentElement.style.setProperty('--button-bg', 'linear-gradient(135deg, #415a77, #1b263b)');
            document.documentElement.style.setProperty('--button-border', '#778da9');
            document.documentElement.style.setProperty('--text-accent', '#e0e1dd');
            document.documentElement.style.setProperty('--pet-name-color', '#ffb3c6');
        }
    } else {
        const NightHour = Hour < 6 ? Hour : Hour - 20;
        const Index = NightHour % NightBackgrounds.length;
        Body.style.backgroundImage = NightBackgrounds[Index];

        if (Index === 0) {
            document.documentElement.style.setProperty('--panel-bg', 'linear-gradient(160deg, #141432 0%, #0b0b1e 50%, #050510 100%)');
            document.documentElement.style.setProperty('--panel-border', '#3a3af6');
            document.documentElement.style.setProperty('--button-bg', 'linear-gradient(135deg, #2b2b66, #14143a)');
            document.documentElement.style.setProperty('--button-border', '#4d4dbf');
            document.documentElement.style.setProperty('--text-accent', '#80ffea');
            document.documentElement.style.setProperty('--pet-name-color', '#b380ff');
        } else {
            document.documentElement.style.setProperty('--panel-bg', 'linear-gradient(160deg, #0a192f 0%, #020c1b 50%, #00050d 100%)');
            document.documentElement.style.setProperty('--panel-border', '#00b4d8');
            document.documentElement.style.setProperty('--button-bg', 'linear-gradient(135deg, #0077b6, #03045e)');
            document.documentElement.style.setProperty('--button-border', '#90e0ef');
            document.documentElement.style.setProperty('--text-accent', '#caf0f8');
            document.documentElement.style.setProperty('--pet-name-color', '#00f5d4');
        }
    }
}

// ==========================================
// ALVÁS IDŐZÍTŐ
// ==========================================

function ResetSleepTimer() {
    if (SleepTimer) clearTimeout(SleepTimer);
    if (ActivityTimer) return;

    SleepTimer = setTimeout(() => {
        Raccoon.src = 'imgs/sleep_raccoon.png';
        Raccoon.classList.remove('pet-idle');
    }, SleepDelay);
}

function WakeUp() {
    if (SleepTimer) clearTimeout(SleepTimer);
    if (ActivityTimer) clearTimeout(ActivityTimer);
    Raccoon.src = 'imgs/raccoon.png';
    Raccoon.classList.add('pet-idle');
}

// ==========================================
// AKTIVITÁSOK & ANIMÁCIÓK
// ==========================================

function PlayAnimation(Source, CssClass, DurationMS = 2000) {
    WakeUp();
    Raccoon.src = Source;
    Raccoon.classList.remove('pet-idle');
    if (CssClass) Raccoon.classList.add(CssClass);

    ActivityTimer = setTimeout(() => {
        Raccoon.src = 'imgs/raccoon.png';
        if (CssClass) Raccoon.classList.remove(CssClass);
        Raccoon.classList.add('pet-idle');
        ActivityTimer = null;
        ResetSleepTimer();
    }, DurationMS);
}

function Activity(ActionType) {
    const now = Date.now();

    if ((ActionType === "Feed" || ActionType === "Water") && ActivityCooldowns[ActionType] > now) return;

    if (!currentSaveKey) return;

    if (ActionType === "Feed") {
        RelationshipPoints += 250;
    } else if (ActionType === "Water") {
        RelationshipPoints += 150;
    } else if (ActionType === "Pet") {
        RelationshipPoints += 350;
    }

    UpdateUI();

    if (ActionType === "Feed") {
        const FeedImages = ['imgs/eat_raccoon.png', 'imgs/eat_raccoon_2.png'];
        const RandomEatImg = FeedImages[Math.floor(Math.random() * FeedImages.length)];
        PlayAnimation(RandomEatImg, 'pet-jumping', 1500);
    } else if (ActionType === "Water") {
        PlayAnimation('imgs/drink_raccoon.png', 'pet-jumping', 1500);
    } else if (ActionType === "Pet") {
        PlayAnimation('imgs/pet_raccoon.png', 'pet-shaking', 1500);
    }

    if (ActionType === "Feed" || ActionType === "Water") {
        ActivityCooldowns[ActionType] = Date.now() + 30000;
        const Btn = ActionType === "Feed"
            ? document.querySelector("#FeedButton")
            : document.querySelector("#WaterButton");
        if (Btn) {
            Btn.classList.add('cooldown');
            setTimeout(() => { Btn.classList.remove('cooldown'); }, 30000);
        }
    }

    SavePetData();
}

// ==========================================
// LOFI RÁDIÓ
// ==========================================

function toggleRadio() {
    const player = document.getElementById('youtube-player');
    const radioImg = document.getElementById('lofi-radio');
    const statusText = document.getElementById('radio-status');

    if (!player || !player.contentWindow) return;

    if (!isPlaying) {
        player.contentWindow.postMessage('{"event":"command","func":"setVolume","args":[15]}', '*');
        player.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
        radioImg.classList.add('radio-playing');
        statusText.innerText = "🎵 Lofi ON";
        statusText.style.color = "#00FF00";
        isPlaying = true;
    } else {
        player.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
        radioImg.classList.remove('radio-playing');
        statusText.innerText = "OFF";
        statusText.style.color = "#4a3e3d";
        isPlaying = false;
    }
}

// ==========================================
// BOLT
// ==========================================

function BuyItem(ItemName, ItemPrice) {
    if (Raccooins < ItemPrice) {
        alert("❌ You don't have enough Raccooins! 🦝");
        return;
    }

    Raccooins -= ItemPrice;
    let RelationshipPointReward = Math.floor(ItemPrice * 1.5);
    RelationshipPoints += RelationshipPointReward;

    UpdateUI();
    TriggerLunaJoy();
    SavePetData();
}

function TriggerLunaJoy() {
    const PetContainer = document.querySelector('.pet');
    if (PetContainer) {
        PetContainer.classList.add('pet-shaking');
        setTimeout(() => { PetContainer.classList.remove('pet-shaking'); }, 1000);
    }
}

// ==========================================
// UI FRISSÍTÉS
// ==========================================

function UpdateUI() {
    document.querySelector('.CoinTextContainer').innerText = Raccooins.toLocaleString() + 'RC';
    document.querySelector('#RelationshipDisplay').innerText = RelationshipPoints.toLocaleString() + 'RP';
    const CurrentLevel = GetCurrentLevel(RelationshipPoints);
    document.querySelector('#LevelDisplay').innerText = CurrentLevel.name;
    checkMinigameUnlock(RelationshipPoints);
}

// ==========================================
// MINIJÁTÉK RENDSZER
// ==========================================

function checkMinigameUnlock(currentRP) {
    const minigameBox = document.getElementById('minigame-box');
    const overlay = document.getElementById('minigame-overlay');
    const reqText = document.getElementById('lock-requirement');

    let requiredRP = gameLimits[currentGameIndex];
    document.getElementById('menu-title').innerText = `${currentGameIndex + 1} / ${totalGames}`;

    if (currentRP >= requiredRP) {
        minigameBox.classList.add('unlocked');
        minigameBox.classList.remove('locked');
    } else {
        minigameBox.classList.remove('unlocked');
        minigameBox.classList.add('locked');
        reqText.innerText = `Unlocks at ${requiredRP.toLocaleString()} RP`;
    }
}

function changeGame(direction) {
    document.getElementById(`game-view-${currentGameIndex}`).style.display = "none";
    currentGameIndex = (currentGameIndex + direction + totalGames) % totalGames;
    document.getElementById(`game-view-${currentGameIndex}`).style.display = "flex";
    if (currentGameIndex === 1) initMemoryGame();
    if (currentGameIndex === 3) nextScramble();
    checkMinigameUnlock(RelationshipPoints);
}

// ---- 1. TIC-TAC-TOE ----

let tttBoard = ["", "", "", "", "", "", "", "", ""];
let tttActive = true;

function playerMove(idx) {
    if (tttBoard[idx] !== "" || !tttActive) return;
    tttBoard[idx] = "X";
    document.querySelectorAll('.ttt-cell')[idx].innerText = "X";
    document.querySelectorAll('.ttt-cell')[idx].style.color = "#ff80b5";
    if (checkTTTWin("X")) {
        document.getElementById('ttt-status').innerText = "🎉 You Won! +50RC";
        Raccooins += 50; UpdateUI(); SavePetData(); tttActive = false; return;
    }
    if (tttBoard.every(c => c !== "")) { document.getElementById('ttt-status').innerText = "🤝 Draw!"; return; }
    tttActive = false;
    document.getElementById('ttt-status').innerText = "🤔 Luna is thinking...";
    setTimeout(() => {
        let empty = tttBoard.map((c, i) => c === "" ? i : null).filter(v => v !== null);
        if (empty.length > 0) {
            let move = empty[Math.floor(Math.random() * empty.length)];
            tttBoard[move] = "O";
            document.querySelectorAll('.ttt-cell')[move].innerText = "O";
            document.querySelectorAll('.ttt-cell')[move].style.color = "#f3da90";
            if (checkTTTWin("O")) {
                document.getElementById('ttt-status').innerText = "🦝 Luna Won!";
                tttActive = false; return;
            }
        }
        tttActive = true;
        document.getElementById('ttt-status').innerText = "Your turn (❌)";
    }, 500);
}

function checkTTTWin(s) {
    const w = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    return w.some(c => c.every(i => tttBoard[i] === s));
}

function resetTTT() {
    tttBoard = ["", "", "", "", "", "", "", "", ""]; tttActive = true;
    document.getElementById('ttt-status').innerText = "Your turn (❌)";
    document.querySelectorAll('.ttt-cell').forEach(c => { c.innerText = ""; c.style.color = "#fff"; });
}

// ---- 2. MEMORY MATCH ----

let memoryItems = ['🧋','🧋','🥟','🥟','🍜','🍜','🍣','🍣','🍤','🍤','🍡','🍡','🥞','🥞','🍊','🍊'];
let flippedCards = [];
let matchedCount = 0;

function initMemoryGame() {
    const grid = document.getElementById('memory-grid');
    if (!grid) return;
    grid.innerHTML = "";
    flippedCards = [];
    matchedCount = 0;
    document.getElementById('memory-status').innerText = "Find the pairs!";
    memoryItems.sort(() => Math.random() - 0.5);
    memoryItems.forEach((item) => {
        let card = document.createElement('div');
        card.classList.add('memory-card');
        card.dataset.value = item;
        card.onclick = () => flipCard(card);
        grid.appendChild(card);
    });
}

function flipCard(card) {
    if (flippedCards.length >= 2 || card.classList.contains('flipped')) return;
    card.innerText = card.dataset.value;
    card.classList.add('flipped');
    flippedCards.push(card);
    if (flippedCards.length === 2) {
        if (flippedCards[0].dataset.value === flippedCards[1].dataset.value) {
            matchedCount += 2;
            flippedCards = [];
            if (matchedCount === memoryItems.length) {
                document.getElementById('memory-status').innerText = "🎉 Cleared! +80RC";
                Raccooins += 80; UpdateUI(); SavePetData();
            }
        } else {
            document.getElementById('memory-status').innerText = "❌ No match!";
            setTimeout(() => {
                flippedCards.forEach(c => { c.innerText = ""; c.classList.remove('flipped'); });
                flippedCards = [];
                document.getElementById('memory-status').innerText = "Find the pairs!";
            }, 700);
        }
    }
}

function restartMemoryGame() {
    initMemoryGame();
}

// ---- 3. SUSHI TAP ----

let sushiTimer;
let sushiScore = 0;
let sushiTimeLeft = 15;
const goodFoods = ['🍣','🥟','🍜','🧋','🍡','🍤'];

function startSushiGame() {
    clearInterval(sushiTimer);
    sushiScore = 0; sushiTimeLeft = 15;
    document.getElementById('sushi-status').innerText = `Score: 0 | Time: 15s`;
    moveSushi();
    sushiTimer = setInterval(() => {
        sushiTimeLeft--;
        document.getElementById('sushi-status').innerText = `Score: ${sushiScore} | Time: ${sushiTimeLeft}s`;
        if (sushiTimeLeft <= 0) {
            clearInterval(sushiTimer);
            document.getElementById('sushi-target').style.display = "none";
            let reward = sushiScore * 5;
            document.getElementById('sushi-status').innerText = `Finished! Gained +${reward}RC`;
            Raccooins += reward; UpdateUI(); SavePetData();
        }
    }, 1000);
}

function moveSushi() {
    const target = document.getElementById('sushi-target');
    target.innerText = goodFoods[Math.floor(Math.random() * goodFoods.length)];
    target.style.left = Math.floor(Math.random() * 160) + "px";
    target.style.top = Math.floor(Math.random() * 160) + "px";
    target.style.display = "block";
}

function tapSushi() {
    if (sushiTimeLeft > 0) { sushiScore++; moveSushi(); }
}

// ---- 4. WORD SCRAMBLE ----

const wordsPool = ["LUNA","RACCOON","BOBA","RAMEN","SUSHI","DUMPLING","WATER","LOFI","HOME","MOCHI","HAPPY","SLEEP","COFFEE","MATCHA","COOKIE","PILLOW","NEON","SUNSET","CHILL","MELODY","DREAMY","CUDDLE","SAKURA","TATAMI","LANTERN","BONSAI","TAYAKI","PUDDING","PASTRY","TEAPOT","STARRY","TWILIGHT","BLANKET","CANDLE","BREEZE","MIDNIGHT","SNUGGLE","NIBBLE","PAWS","FLUFFY","BANDIT","WASABI","NOODLES","COCOA","CARAMEL","WAFFLE","DAWN","GLOW","COMFY"];
let currentWord = "";

function nextScramble() {
    currentWord = wordsPool[Math.floor(Math.random() * wordsPool.length)];
    let scrambled = currentWord.split('').sort(() => Math.random() - 0.5).join('');
    if (scrambled === currentWord) scrambled = currentWord.split('').reverse().join('');
    document.getElementById('scrambled-word').innerText = scrambled;
    document.getElementById('scramble-input').value = "";
    document.getElementById('scramble-status').innerText = "Unscramble the word!";
}

function checkScrambleGuess() {
    let guess = document.getElementById('scramble-input').value.toUpperCase().trim();
    if (guess === currentWord) {
        document.getElementById('scramble-status').innerText = "🎉 Correct! +60RC";
        Raccooins += 60; UpdateUI(); SavePetData();
        setTimeout(nextScramble, 1200);
    } else {
        document.getElementById('scramble-status').innerText = "❌ Wrong! Try again!";
    }
}

// ---- 5. COOKIE CATCHER ----

let catcherScore = 0;
let isCatcherActive = false;
let catcherTimer = 20;
let catcherInterval = null;
let catcherCountdown = null;

const catcherZone = document.getElementById('catcher-zone');
const catcherBasket = document.getElementById('catcher-basket');
const catcherStatus = document.getElementById('catcher-status');
const catcherStartBtn = document.getElementById('catcher-start-btn');

if (catcherZone && catcherBasket) {
    catcherZone.addEventListener('mousemove', (e) => {
        if (!isCatcherActive) return;
        const rect = catcherZone.getBoundingClientRect();
        let x = e.clientX - rect.left - 15;
        if (x < 0) x = 0;
        if (x > rect.width - 30) x = rect.width - 30;
        catcherBasket.style.left = x + 'px';
    });
}

function startCatcherGame() {
    if (isCatcherActive) return;
    WakeUp();
    isCatcherActive = true;
    catcherScore = 0;
    catcherTimer = 20;
    catcherStartBtn.style.display = 'none';
    catcherStatus.innerText = `Score: 0 | Time: ${catcherTimer}s`;
    catcherInterval = setInterval(spawnCatcherItem, 500);
    catcherCountdown = setInterval(() => {
        catcherTimer--;
        catcherStatus.innerText = "Score: " + catcherScore + " | Time: " + catcherTimer + "s";
        if (catcherTimer <= 0) endCatcherGame();
    }, 1000);
}

// ---- 6. FORTUNE COOKIE ----

let cookieClicks = 0;
const targetClicks = 10;
let isCookieCracked = false;

const fortuneMessages = [
    "A warm drink will bring you joy today! ☕",
    "Great luck is coming your way! ✨",
    "Luna thinks you are awesome! 🦝",
    "A pleasant surprise is waiting for you! 🌸",
    "Relax, take a deep breath, everything is fine. ☁️",
    "Today is a perfect day for some warm ramen! 🍜",
    "Your kindness will be rewarded soon. ❤️"
];

function clickFortuneCookie() {
    if (isCookieCracked) return;
    WakeUp();
    cookieClicks++;
    const cookieEl = document.getElementById('fortune-cookie-target');
    const statusEl = document.getElementById('cookie-status');
    const textEl = document.getElementById('cookie-fortune-text');
    const resetBtn = document.getElementById('cookie-reset-btn');
    statusEl.innerText = `Cracks: ${cookieClicks} / ${targetClicks}`;
    if (cookieClicks >= targetClicks) {
        isCookieCracked = true;
        cookieEl.innerText = "💥";
        cookieEl.classList.add('cookie-cracked');
        setTimeout(() => {
            cookieEl.innerText = "📜";
            statusEl.innerText = "🥠 Cookie cracked!";
            const randomFortune = fortuneMessages[Math.floor(Math.random() * fortuneMessages.length)];
            textEl.innerText = `"${randomFortune}"`;
            const prizeRC = Math.floor(Math.random() * 51) + 30;
            const prizeRP = Math.floor(Math.random() * 31) + 20;
            Raccooins += prizeRC;
            RelationshipPoints += prizeRP;
            UpdateUI();
            SavePetData();
            resetBtn.style.display = 'inline-block';
        }, 400);
    }
}

function resetFortuneCookie() {
    cookieClicks = 0;
    isCookieCracked = false;
    document.getElementById('fortune-cookie-target').innerText = "🥠";
    document.getElementById('fortune-cookie-target').classList.remove('cookie-cracked');
    document.getElementById('cookie-status').innerText = "Click the Cookie to break it";
    document.getElementById('cookie-fortune-text').innerText = "";
    document.getElementById('cookie-reset-btn').style.display = 'none';
}

window.addEventListener("load", () => {
    setupDiscordActivity();
    FetchPetData();
});

// ==========================================
// INDÍTÁS ÉS DISCORD BIZTONSÁGI ESEMÉNYKEZELŐK
// ==========================================

SetBackground();
setupDiscordActivity(); 

document.addEventListener('DOMContentLoaded', () => {
    // 1. Minigame menü léptetés
    document.getElementById('nav-game-prev')?.addEventListener('click', () => {
        if (typeof changeGame === 'function') changeGame(-1);
    });
    document.getElementById('nav-game-next')?.addEventListener('click', () => {
        if (typeof changeGame === 'function') changeGame(1);
    });

    // 2. Tic-Tac-Toe mezők kattintása
    document.querySelectorAll('.ttt-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            const index = parseInt(cell.getAttribute('data-index'), 10);
            if (!isNaN(index) && typeof playerMove === 'function') {
                playerMove(index);
            }
        });
    });
    document.getElementById('ttt-reset-btn')?.addEventListener('click', () => {
        if (typeof resetTTT === 'function') resetTTT();
    });

    // 3. Memory Match újraindítás
    document.getElementById('memory-restart-btn')?.addEventListener('click', () => {
        if (typeof restartMemoryGame === 'function') restartMemoryGame();
    });

    // 4. Sushi Tap játék
    document.getElementById('sushi-target')?.addEventListener('click', () => {
        if (typeof tapSushi === 'function') tapSushi();
    });
    document.getElementById('sushi-start-btn')?.addEventListener('click', () => {
        if (typeof startSushiGame === 'function') startSushiGame();
    });

    // 5. Word Scramble beküldés
    document.getElementById('scramble-submit-btn')?.addEventListener('click', () => {
        if (typeof checkScrambleGuess === 'function') checkScrambleGuess();
    });

    // 6. Cookie Catcher indítás
    document.getElementById('catcher-start-btn')?.addEventListener('click', () => {
        if (typeof startCatcherGame === 'function') startCatcherGame();
    });

    // 7. Fortune Cookie törés és reset
    document.getElementById('fortune-cookie-target')?.addEventListener('click', () => {
        if (typeof clickFortuneCookie === 'function') clickFortuneCookie();
    });
    document.getElementById('cookie-reset-btn')?.addEventListener('click', () => {
        if (typeof resetFortuneCookie === 'function') resetFortuneCookie();
    });

    // 8. Lofi Rádió ki/be kapcsolás (Javított ID: lofi-radio)
    document.getElementById('lofi-radio')?.addEventListener('click', () => {
        if (typeof toggleRadio === 'function') toggleRadio();
    });

    // 9. Kisállat interakciók (Feed, Water, Pet)
    document.querySelectorAll('button[data-activity]').forEach(button => {
        button.addEventListener('click', () => {
            const activityType = button.getAttribute('data-activity');
            if (activityType && typeof Activity === 'function') {
                Activity(activityType);
            }
        });
    });

    // 10. Bolt vásárlás gombok
    document.querySelectorAll('.BuyButton[data-item]').forEach(button => {
        button.addEventListener('click', () => {
            const item = button.getAttribute('data-item');
            const price = parseInt(button.getAttribute('data-price'), 10);
            if (item && !isNaN(price) && typeof BuyItem === 'function') {
                BuyItem(item, price);
            }
        });
    });
});

// ==========================================
// INDÍTÁS
// ==========================================

SetBackground();
setInterval(SetBackground, 60 * 1000);
ResetSleepTimer();
setupDiscordActivity();