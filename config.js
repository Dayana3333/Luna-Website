// Discord SDK is bundled locally as a real ES module with no external imports.
import { DiscordSDK, patchUrlMappings } from "./vendor/discord-sdk.js";

// Supabase is loaded globally via a <script> tag in index.html (see vendor/supabase.js),
// so it's available here as window.supabase — no import needed, this avoids CSP issues.
const { createClient } = window.supabase;

// ==========================================
// GLOBÁLIS VÁLTOZÓK ÉS ELEMEK
// ==========================================

const Body = document.body;
const Raccoon = document.querySelector('#Raccoon');

let PetData = null;
let Raccooins = null;
let RelationshipPoints = 0;
let currentSaveKey = null;
let isSaving = false;
let currentUser = { id: 'local_user', username: 'LocalUser' };

// ==========================================
// SUPABASE & DISCORD SDK KONFIGURÁCIÓ
// ==========================================

const SUPABASE_URL = "https://borusbjllkypavkoujqk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJvcnVzYmpsbGt5cGF2a291anFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NzgzMzEsImV4cCI6MjA5NzU1NDMzMX0.LD1tM6qd9DdSK0SL4DGQyK0Zb-X-chgR1IokR_m2Ox4";
let supabaseClient;

// Backend that exchanges an OAuth2 "code" for an access_token. Needs the
// Discord client secret, which can never live in this frontend file — that
// exchange happens server-side on Kranem instead. Inside Discord this must
// go through the proxy mapping above (raw external URLs get CSP-blocked).
const KRANEM_DIRECT_URL = "https://luna-token-exchange.yourname.workers.dev";

const isDiscordActivity =
    window.location.search.includes("frame_id=") ||
    window.location.search.includes("instance_id=");

// Inside Discord, all network requests must go through Discord's proxy
// (discordsays.com) instead of hitting external domains directly — that's
// what the CSP "connect-src" error was about. patchUrlMappings rewrites
// fetch() calls under the hood so the Supabase client code below doesn't
// need to change at all; it just needs to be told to use a relative path
// instead of the real Supabase URL when running as an Activity. The same
// applies to the Kranem backend used for the OAuth2 token exchange.
if (isDiscordActivity) {
    patchUrlMappings([
        { prefix: "/supabase-api", target: "borusbjllkypavkoujqk.supabase.co" },
        { prefix: "/cloudflare-api", target: "luna-token-exchange.nemethkovacsrichard.workers.dev" },
    ]);
}

function initSupabase() {
    const url = isDiscordActivity
        ? `${window.location.origin}/supabase-api`
        : SUPABASE_URL;
    return createClient(url, SUPABASE_ANON_KEY);
}

supabaseClient = initSupabase();

const TOKEN_EXCHANGE_URL = isDiscordActivity
    ? `${window.location.origin}/cloudflare-api/api/token`
    : `https://luna-token-exchange.nemethkovacsrichard.workers.dev/api/token`;

const ACTION_URL = isDiscordActivity
    ? `${window.location.origin}/cloudflare-api/api/action`
    : `https://luna-token-exchange.nemethkovacsrichard.workers.dev/api/action`;

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
    const startPolling = () => {
    setInterval(async () => {
        if (!currentSaveKey || isSaving) return;
        const { data, error } = await supabaseClient
            .from('pet_data')
            .select('raccooin, relationship_points, name')
            .eq('guild_id', currentSaveKey)
            .single();
        if (error || !data) return;
        Raccooins = data.raccooin ?? 100;
        RelationshipPoints = data.relationship_points || 0;
        const petNameEl = document.querySelector('#PetName');
        if (petNameEl) petNameEl.innerText = data.name;
        UpdateUI();
    }, 5000);
};

    if (!discordSdk) {
        console.log("Local mode — no Discord SDK.");
        currentSaveKey = "default_local_testing";
        FetchPetData();
        startPolling();
        return;
    }
    try {
        await discordSdk.ready();
        const { code } = await discordSdk.commands.authorize({
            client_id: "1088855742502678538",
            response_type: "code",
            state: "",
            prompt: "none",
            scope: ["identify", "guilds.join", "rpc.activities.write"],
        });
        const tokenResponse = await fetch(TOKEN_EXCHANGE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
        });
        if (!tokenResponse.ok) {
            throw new Error(`Token exchange failed: ${tokenResponse.status}`);
        }
        const { access_token } = await tokenResponse.json();
        if (!access_token) {
            throw new Error("No access_token returned from backend");
        }
        await discordSdk.commands.authenticate({ access_token });
        currentSaveKey = discordSdk.guildId || discordSdk.channelId || "default_local_testing";
        // Fetch the authenticated user's identity
        try {
            const userRes = await fetch("https://discord.com/api/users/@me", {
                headers: { Authorization: `Bearer ${access_token}` }
            });
            if (userRes.ok) {
                const userData = await userRes.json();
                currentUser = { id: userData.id, username: userData.username || userData.global_name || 'Unknown' };
            }
        } catch (e) { console.warn("Could not fetch user identity", e); }
        await updateDiscordPresence();
        FetchPetData();
        startPolling();
    } catch (error) {
        console.error("Discord Activity error:", error);
        currentSaveKey = "default_local_testing";
        FetchPetData();
        startPolling();
    }
}

async function updateDiscordPresence() {
    try {
        await discordSdk.commands.setActivity({
            activity: {
                type: 0, 
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
            .from('pet_data')
            .select('*')
            .eq('guild_id', currentSaveKey)
            .single();

        if (error && error.code === 'PGRST116') {
            const SAVE_URL = isDiscordActivity
                ? `${window.location.origin}/cloudflare-api/api/save`
                : `https://luna-token-exchange.nemethkovacsrichard.workers.dev/api/save`;

            await fetch(SAVE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    guild_id: currentSaveKey,
                    name: 'Luna',
                    raccooin: 100,
                    relationship_points: 0,
                    relationship_level_num: 1,
                    relationship_level_name: 'Strangers',
                    last_interaction_by_id: currentUser.id,
                    last_interaction_by_name: currentUser.username,
                }),
            });

            const { data: newPet, error: refetchError } = await supabaseClient
                .from('pet_data')
                .select('*')
                .eq('guild_id', currentSaveKey)
                .single();

            if (refetchError) throw refetchError;
            data = newPet;
        } else if (error) {
            throw error;
        }

        PetData = data;
        Raccooins = data.raccooin ?? 100;
        RelationshipPoints = data.relationship_points || 0;

        const petNameEl = document.querySelector('#PetName');
        if (petNameEl) petNameEl.innerText = data.name;

        UpdateUI();
        console.log("Pet data loaded:", PetData);
    } catch (err) {
        console.error("Failed to load pet data:", err);
    }
}

async function SavePetData(ctx = {}) {
    if (!currentSaveKey) return;
    isSaving = true;
    try {
        const SAVE_URL = isDiscordActivity
            ? `${window.location.origin}/cloudflare-api/api/save`
            : `https://luna-token-exchange.nemethkovacsrichard.workers.dev/api/save`;

        const currentLevel = GetCurrentLevel(RelationshipPoints);

        const response = await fetch(SAVE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                guild_id: currentSaveKey,
                raccooin: Raccooins,
                relationship_points: RelationshipPoints,
                relationship_level_num: currentLevel.level,
                relationship_level_name: currentLevel.name,
                name: document.querySelector('#PetName')?.innerText || 'Luna',
                last_interaction_type:    ctx.action_type    || null,
                last_interaction_by_id:   currentUser.id,
                last_interaction_by_name: currentUser.username,
                caused_level_up:          ctx.caused_level_up || false,
                last_level_up_by_id:      ctx.caused_level_up ? currentUser.id        : undefined,
                last_level_up_by_name:    ctx.caused_level_up ? currentUser.username  : undefined,
                inc_feed:           ctx.inc_feed          || 0,
                inc_water:          ctx.inc_water         || 0,
                inc_pet:            ctx.inc_pet           || 0,
                inc_items:          ctx.inc_items         || 0,
                inc_bubble_tea:     ctx.inc_bubble_tea    || 0,
                inc_steamed_buns:   ctx.inc_steamed_buns  || 0,
                inc_ramen:          ctx.inc_ramen         || 0,
                inc_tictactoe_played: ctx.inc_tictactoe_played || 0,
                inc_tictactoe_won:  ctx.inc_tictactoe_won  || 0,
                inc_tictactoe_lost: ctx.inc_tictactoe_lost || 0,
                inc_memory_played:  ctx.inc_memory_played  || 0,
                inc_memory_won:     ctx.inc_memory_won     || 0,
                inc_memory_lost:    ctx.inc_memory_lost    || 0,
                inc_sushi_played:   ctx.inc_sushi_played   || 0,
                inc_sushi_rc:       ctx.inc_sushi_rc       || 0,
                inc_scramble_played:ctx.inc_scramble_played || 0,
                inc_scramble_won:   ctx.inc_scramble_won   || 0,
                inc_scramble_lost:  ctx.inc_scramble_lost  || 0,
                inc_catcher_played: ctx.inc_catcher_played || 0,
                inc_catcher_rc:     ctx.inc_catcher_rc     || 0,
                inc_catcher_rp:     ctx.inc_catcher_rp     || 0,
                inc_fortune_played: ctx.inc_fortune_played || 0,
                inc_fortune_rc:     ctx.inc_fortune_rc     || 0,
                inc_fortune_rp:     ctx.inc_fortune_rp     || 0,
                inc_rp_feed:        ctx.inc_rp_feed        || 0,
                inc_rp_water:       ctx.inc_rp_water       || 0,
                inc_rp_pet:         ctx.inc_rp_pet         || 0,
                inc_rp_items:       ctx.inc_rp_items       || 0,
                inc_rp_minigames:   ctx.inc_rp_minigames   || 0,
                inc_rc_spent:       ctx.inc_rc_spent       || 0,
                inc_rc_earned:      ctx.inc_rc_earned      || 0,
                current_rc: Raccooins,
                current_rp: RelationshipPoints,
            }),
        });

        if (!response.ok) throw new Error('Save failed');
    } catch (err) {
        console.error('Failed to save pet data:', err);
    } finally {
        isSaving = false;
    }
}

// ==========================================
// ACTION LOGGER
// ==========================================

async function LogAction({
    action_type, action_detail = null, result = null,
    rp_gained = 0, rc_spent = 0, rc_earned = 0,
    caused_level_up = false,
    level_name_before = null, level_name_after = null,
    relationship_level_before = null, relationship_level_after = null,
}) {
    if (!currentSaveKey) return;
    try {
        const levelBefore = relationship_level_before ?? GetCurrentLevel(RelationshipPoints - rp_gained)?.level ?? null;
        const levelAfter  = relationship_level_after  ?? GetCurrentLevel(RelationshipPoints)?.level ?? null;
        await fetch(ACTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                guild_id: currentSaveKey,
                user_id: currentUser.id,
                username: currentUser.username,
                action_type, action_detail, result,
                rp_gained, rc_spent, rc_earned,
                pet_rp_before: RelationshipPoints - rp_gained,
                pet_rp_after: RelationshipPoints,
                pet_rc_before: Raccooins + rc_spent - rc_earned,
                pet_rc_after: Raccooins,
                relationship_level_before: levelBefore,
                relationship_level_after: levelAfter,
                level_name_before, level_name_after,
                caused_level_up,
            }),
        });
    } catch (err) {
        console.warn('LogAction failed (non-critical):', err);
    }
}

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

const radioAudio = new Audio('audio/lofi-music.mp3');
radioAudio.loop = true;
radioAudio.volume = 0.25;

const ActivityCooldowns = {
    Feed: 0,
    Water: 0
};

// index 4 = Cookie Catcher, no cooldown
const MinigameCooldowns = [0, 0, 0, 0, 0, 0];
const MINIGAME_COOLDOWN_MS = 60000;
const NO_COOLDOWN_GAMES = [4]; // Cookie Catcher index

// ==========================================
// UNIFIED COOLDOWN ENGINE
// ==========================================

const cooldownIntervals = {};

function startCooldown(btnId, durationMs, labelText) {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    const endTime = Date.now() + durationMs;
    btn.classList.add('cooldown');
    btn.disabled = true;

    const originalHTML = btn.dataset.originalHtml || btn.innerHTML;
    btn.dataset.originalHtml = originalHTML;

    function tick() {
        const remaining = Math.ceil((endTime - Date.now()) / 1000);
        if (remaining <= 0) {
            btn.classList.remove('cooldown');
            btn.disabled = false;
            btn.innerHTML = originalHTML;
            clearInterval(cooldownIntervals[btnId]);
            delete cooldownIntervals[btnId];
            return;
        }
        btn.innerHTML = `${labelText}<span class="cooldown-timer">${remaining}s</span>`;
    }

    tick();
    if (cooldownIntervals[btnId]) clearInterval(cooldownIntervals[btnId]);
    cooldownIntervals[btnId] = setInterval(tick, 250);
}

// ==========================================
// MINIJÁTÉK RENDSZER VÁLTOZÓI
// ==========================================

let currentGameIndex = 0;
const totalGames = 6;
const gameLimits = [100, 200, 300, 400, 500, 600, 50]; // 0 RP-nél nyílik a Tic-Tac-Toe
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
        if (Raccoon) {
            Raccoon.src = 'imgs/sleep_raccoon.png';
            Raccoon.classList.remove('pet-idle');
        }
    }, SleepDelay);
}

function WakeUp() {
    if (SleepTimer) clearTimeout(SleepTimer);
    if (ActivityTimer) clearTimeout(ActivityTimer);
    if (Raccoon) {
        Raccoon.src = 'imgs/raccoon.png';
        Raccoon.classList.add('pet-idle');
    }
}

// ==========================================
// AKTIVITÁSOK & ANIMÁCIÓK
// ==========================================

function PlayAnimation(Source, CssClass, DurationMS = 2000) {
    WakeUp();
    if (Raccoon) {
        Raccoon.src = Source;
        Raccoon.classList.remove('pet-idle');
        if (CssClass) Raccoon.classList.add(CssClass);
    }

    ActivityTimer = setTimeout(() => {
        if (Raccoon) {
            Raccoon.src = 'imgs/raccoon.png';
            if (CssClass) Raccoon.classList.remove(CssClass);
            Raccoon.classList.add('pet-idle');
        }
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
        RelationshipPoints += 1;
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
        const cdMs = 30000;
        ActivityCooldowns[ActionType] = Date.now() + cdMs;
        if (ActionType === "Feed") {
            startCooldown("FeedButton", cdMs, "🍜 Feed");
        } else {
            startCooldown("WaterButton", cdMs, "💧 Water");
        }
    }

    const levelBefore = GetCurrentLevel(RelationshipPoints - (ActionType === 'Feed' ? 250 : ActionType === 'Water' ? 150 : 1));
    const levelAfter  = GetCurrentLevel(RelationshipPoints);
    const causedLevelUp = levelAfter.level > levelBefore.level;
    const rpGained = ActionType === 'Feed' ? 250 : ActionType === 'Water' ? 150 : 1;

    const ctx = {
        action_type: ActionType,
        caused_level_up: causedLevelUp,
        inc_feed:    ActionType === 'Feed'  ? 1 : 0,
        inc_water:   ActionType === 'Water' ? 1 : 0,
        inc_pet:     ActionType === 'Pet'   ? 1 : 0,
        inc_rp_feed:  ActionType === 'Feed'  ? rpGained : 0,
        inc_rp_water: ActionType === 'Water' ? rpGained : 0,
        inc_rp_pet:   ActionType === 'Pet'   ? rpGained : 0,
    };

    SavePetData(ctx);
    LogAction({
        action_type: ActionType,
        rp_gained: rpGained,
        caused_level_up: causedLevelUp,
        level_name_before: levelBefore.name,
        level_name_after: levelAfter.name,
        relationship_level_before: levelBefore.level,
        relationship_level_after: levelAfter.level,
    });
}

// ==========================================
// LOFI RÁDIÓ
// ==========================================

function toggleRadio() {
    const radioStatus = document.getElementById('radio-status');
    
    if (!radioStatus) return;

    if (radioAudio.paused) {
        // Ha nem szól a zene, megpróbáljuk elindítani
        radioAudio.play()
            .then(() => {
                radioStatus.textContent = "ON";
                radioStatus.style.color = "#55ff55"; 
            })
            .catch(error => {
                console.error("Discord Audio lejátszási hiba:", error);
            });
    } else {
        // Ha már szól, akkor gombnyomásra megállítjuk
        radioAudio.pause();
        radioStatus.textContent = "OFF";
        radioStatus.style.color = "#ff5555"; 
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

    const levelBefore = GetCurrentLevel(RelationshipPoints - RelationshipPointReward);
    const levelAfter  = GetCurrentLevel(RelationshipPoints);
    const causedLevelUp = levelAfter.level > levelBefore.level;

    const itemKey = ItemName === 'BubbleTea' ? 'inc_bubble_tea' : ItemName === 'SteamedBuns' ? 'inc_steamed_buns' : 'inc_ramen';
    const ctx = {
        action_type: 'BuyItem',
        caused_level_up: causedLevelUp,
        inc_items: 1,
        [itemKey]: 1,
        inc_rp_items: RelationshipPointReward,
        inc_rc_spent: ItemPrice,
    };

    UpdateUI();
    TriggerLunaJoy();
    SavePetData(ctx);
    LogAction({
        action_type: 'BuyItem',
        action_detail: ItemName,
        result: ItemName,
        rp_gained: RelationshipPointReward,
        rc_spent: ItemPrice,
        caused_level_up: causedLevelUp,
        level_name_before: levelBefore.name,
        level_name_after: levelAfter.name,
        relationship_level_before: levelBefore.level,
        relationship_level_after: levelAfter.level,
    });
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
    const coinEl = document.querySelector('.CoinTextContainer');
    const relEl = document.querySelector('#RelationshipDisplay');
    const lvlEl = document.querySelector('#LevelDisplay');

    if (coinEl) coinEl.innerText = Raccooins.toLocaleString() + 'RC';
    if (relEl) relEl.innerText = RelationshipPoints.toLocaleString() + 'RP';
    
    const CurrentLevel = GetCurrentLevel(RelationshipPoints);
    if (lvlEl) lvlEl.innerText = CurrentLevel.name;
    
    checkMinigameUnlock(RelationshipPoints);
}

// ==========================================
// MINIJÁTÉK RENDSZER
// ==========================================

function checkMinigameUnlock(currentRP) {
    const minigameBox = document.getElementById('minigame-box');
    const overlay = document.getElementById('minigame-overlay');
    const reqText = document.getElementById('lock-requirement');
    const menuTitle = document.getElementById('menu-title');

    let requiredRP = gameLimits[currentGameIndex];
    if (menuTitle) menuTitle.innerText = `${currentGameIndex + 1} / ${totalGames}`;

    if (!minigameBox) return;

    if (currentRP >= requiredRP) {
        minigameBox.classList.add('unlocked');
        minigameBox.classList.remove('locked');
        if (overlay) overlay.style.display = 'none';
    } else {
        minigameBox.classList.remove('unlocked');
        minigameBox.classList.add('locked');
        if (overlay) overlay.style.display = 'flex';
        if (reqText) reqText.innerText = `Unlocks at ${requiredRP.toLocaleString()} RP`;
    }
}

function changeGame(direction) {
    const oldGame = document.getElementById(`game-view-${currentGameIndex}`);
    if (oldGame) oldGame.style.display = "none";

    currentGameIndex = (currentGameIndex + direction + totalGames) % totalGames;

    const newGame = document.getElementById(`game-view-${currentGameIndex}`);
    if (newGame) newGame.style.display = "flex";

    if (currentGameIndex === 1 && typeof initMemoryGame === 'function') initMemoryGame();
    if (currentGameIndex === 3 && typeof nextScramble === 'function') nextScramble();
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
        Raccooins += 50; UpdateUI(); SavePetData({ action_type: 'MinigamePlay', inc_tictactoe_played: 1, inc_tictactoe_won: 1, inc_rc_earned: 50 }); LogAction({ action_type: 'MinigamePlay', action_detail: 'TicTacToe', result: 'win', rc_earned: 50 }); tttActive = false; return;
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
    startCooldown("ttt-reset-btn", MINIGAME_COOLDOWN_MS, "Reset Game");
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
                Raccooins += 80; UpdateUI(); SavePetData({ action_type: 'MinigamePlay', inc_memory_played: 1, inc_memory_won: 1, inc_rc_earned: 80 }); LogAction({ action_type: 'MinigamePlay', action_detail: 'MemoryMatch', result: 'win', rc_earned: 80 });
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
    startCooldown("memory-restart-btn", MINIGAME_COOLDOWN_MS, "Restart");
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
    startCooldown("sushi-start-btn", MINIGAME_COOLDOWN_MS, "Start Game");
    sushiTimer = setInterval(() => {
        sushiTimeLeft--;
        document.getElementById('sushi-status').innerText = `Score: ${sushiScore} | Time: ${sushiTimeLeft}s`;
        if (sushiTimeLeft <= 0) {
            clearInterval(sushiTimer);
            document.getElementById('sushi-target').style.display = "none";
            let reward = sushiScore * 5;
            document.getElementById('sushi-status').innerText = `Finished! Gained +${reward}RC`;
            Raccooins += reward; UpdateUI(); SavePetData({ action_type: 'MinigamePlay', inc_sushi_played: 1, inc_sushi_rc: reward, inc_rc_earned: reward }); LogAction({ action_type: 'MinigamePlay', action_detail: 'SushiTap', result: 'SushiTap', rc_earned: reward });
        }
    }, 1000);
}

function moveSushi() {
    const target = document.getElementById('sushi-target');
    if (!target) return;
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
        Raccooins += 60; UpdateUI(); SavePetData({ action_type: 'MinigamePlay', inc_scramble_played: 1, inc_scramble_won: 1, inc_rc_earned: 60 }); LogAction({ action_type: 'MinigamePlay', action_detail: 'WordScramble', result: 'WordScrambleWin', rc_earned: 60 });
        startCooldown("scramble-submit-btn", MINIGAME_COOLDOWN_MS, "Submit");
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
    if (catcherStartBtn) catcherStartBtn.style.display = 'none';
    if (catcherStatus) catcherStatus.innerText = `Score: 0 | Time: ${catcherTimer}s`;
    
    clearInterval(catcherInterval);
    clearInterval(catcherCountdown);
    
    catcherInterval = setInterval(spawnCatcherItem, 500);
    catcherCountdown = setInterval(() => {
        catcherTimer--;
        if (catcherStatus) catcherStatus.innerText = "Score: " + catcherScore + " | Time: " + catcherTimer + "s";
        if (catcherTimer <= 0) endCatcherGame();
    }, 1000);
}

function spawnCatcherItem() {
    if (!isCatcherActive || !catcherZone) return;

    const item = document.createElement('div');
    item.classList.add('falling-cookie');
    item.innerText = '🍪'; 
    
    const rect = catcherZone.getBoundingClientRect();
    const randomX = Math.floor(Math.random() * (rect.width - 25));
    
    item.style.left = randomX + 'px';
    item.style.top = '0px';
    catcherZone.appendChild(item);

    let itemTop = 0;
    const fallInterval = setInterval(() => {
        if (!isCatcherActive) {
            clearInterval(fallInterval);
            item.remove();
            return;
        }

        itemTop += 5; 
        item.style.top = itemTop + 'px';

        const basketLeft = parseFloat(catcherBasket.style.left) || 0;
        const zoneHeight = rect.height;

        if (itemTop >= zoneHeight - 40 && itemTop <= zoneHeight - 10) {
            if (randomX >= basketLeft - 15 && randomX <= basketLeft + 30) {
                catcherScore++;
                if (catcherStatus) {
                    catcherStatus.innerText = `Score: ${catcherScore} | Time: ${catcherTimer}s`;
                }
                clearInterval(fallInterval);
                item.remove();
            }
        }

        if (itemTop > zoneHeight) {
            clearInterval(fallInterval);
            item.remove();
        }
    }, 30);
}

function endCatcherGame() {
    isCatcherActive = false;
    clearInterval(catcherInterval);
    clearInterval(catcherCountdown);
    
    document.querySelectorAll('.falling-cookie').forEach(el => el.remove());
    
    const prizeRC = Math.floor(catcherScore * 5); 
    const prizeRP = Math.floor(catcherScore * 2); 
    
    Raccooins += prizeRC;
    RelationshipPoints += prizeRP;
    
    if (catcherStatus) {
        catcherStatus.innerText = `Game Over! Score: ${catcherScore} (+${prizeRC}RC, +${prizeRP}RP)`;
    }
    if (catcherStartBtn) {
        catcherStartBtn.style.display = 'inline-block';
        startCooldown("catcher-start-btn", MINIGAME_COOLDOWN_MS, "Start Game");
    }
    
    UpdateUI();
    SavePetData({ action_type: 'MinigamePlay', inc_catcher_played: 1, inc_catcher_rc: prizeRC, inc_catcher_rp: prizeRP, inc_rc_earned: prizeRC, inc_rp_minigames: prizeRP });
    LogAction({ action_type: 'MinigamePlay', action_detail: 'CookieCatcher', result: 'CookieCatcher', rc_earned: prizeRC, rp_gained: prizeRP });
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
    if (statusEl) statusEl.innerText = `Cracks: ${cookieClicks} / ${targetClicks}`;
    if (cookieClicks >= targetClicks) {
        isCookieCracked = true;
        if (cookieEl) {
            cookieEl.innerText = "💥";
            cookieEl.classList.add('cookie-cracked');
        }
        setTimeout(() => {
            if (cookieEl) cookieEl.innerText = "📜";
            if (statusEl) statusEl.innerText = "🥠 Cookie cracked!";
            const randomFortune = fortuneMessages[Math.floor(Math.random() * fortuneMessages.length)];
            if (textEl) textEl.innerText = `"${randomFortune}"`;
            const prizeRC = Math.floor(Math.random() * 51) + 30;
            const prizeRP = Math.floor(Math.random() * 31) + 20;
            Raccooins += prizeRC;
            RelationshipPoints += prizeRP;
            UpdateUI();
            SavePetData({ action_type: 'MinigamePlay', inc_fortune_played: 1, inc_fortune_rc: prizeRC, inc_fortune_rp: prizeRP, inc_rc_earned: prizeRC, inc_rp_minigames: prizeRP });
            LogAction({ action_type: 'MinigamePlay', action_detail: 'FortuneCookie', result: 'FortuneCookie', rc_earned: prizeRC, rp_gained: prizeRP });
            if (resetBtn) resetBtn.style.display = 'inline-block';
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
    startCooldown("cookie-reset-btn", MINIGAME_COOLDOWN_MS, "New Cookie");
}

// ==========================================
// INDÍTÁS ÉS BIZTONSÁGI ESEMÉNYKEZELŐK
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    // Pet név mentése blur esetén (Biztonságos betöltés)
    document.querySelector('#PetName')?.addEventListener('blur', () => {
        const NewName = document.querySelector('#PetName').textContent.trim();
        if (NewName && currentSaveKey) {
            SavePetData();
        }
    });

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

    // 8. Lofi Rádió ki/be kapcsolás
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

    // ==========================================
    // MOBIL PANEL RESPONSIVE VEZÉRLÉS (DISCORD WEBVIEW COMPATIBLE)
    // ==========================================
    function initMobilePanels() {
        const minigameBox = document.getElementById('minigame-box');
        const shopBox = document.getElementById('shop-box');
        const btnToggleMinigame = document.getElementById('btn-toggle-minigame');
        const btnToggleShop = document.getElementById('btn-toggle-shop');
        const btnCloseMinigame = document.getElementById('btn-close-minigame');
        const btnCloseShop = document.getElementById('btn-close-shop');

        if (btnToggleMinigame && minigameBox && shopBox) {
            btnToggleMinigame.addEventListener('click', (e) => {
                e.preventDefault();
                minigameBox.classList.toggle('mobile-open');
                shopBox.classList.remove('mobile-open');
            });
        }

        if (btnToggleShop && shopBox && minigameBox) {
            btnToggleShop.addEventListener('click', (e) => {
                e.preventDefault();
                shopBox.classList.toggle('mobile-open');
                minigameBox.classList.remove('mobile-open');
            });
        }

        if (btnCloseMinigame && minigameBox) {
            btnCloseMinigame.addEventListener('click', (e) => {
                e.preventDefault();
                minigameBox.classList.remove('mobile-open');
            });
        }

        if (btnCloseShop && shopBox) {
            btnCloseShop.addEventListener('click', (e) => {
                e.preventDefault();
                shopBox.classList.remove('mobile-open');
            });
        }
    }

    // Rendszer automatikus indítása a megfelelő sorrendben
    try {
        SetBackground();
        setInterval(SetBackground, 60000); // Időjárás/háttér frissítés
        ResetSleepTimer();
        setupDiscordActivity();

        // Azonnal meghívjuk a mobil gombok inicializálását
        initMobilePanels();
    } catch (error) {
        console.error("Hiba az inicializálás során:", error);
    }
});