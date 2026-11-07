/* ==========================================
   SUPABASE VERBINDUNG
========================================== */

const SUPABASE_URL = "https://exuxzafvelelozppryir.supabase.co";
const SUPABASE_KEY = "sb_publishable_2_X-qjrz4Ky8ZMF6isIdbw_Y98ljw1f";

/* Supabase darf die lokalen Lernfunktionen nicht blockieren. */
const supabaseClient = window.supabase?.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;


/* ==========================================
   VOKABELN UND STATISTIKEN
========================================== */

const defaultWords = [
    { spanish: "Hola", german: "Hallo" },
    { spanish: "Gracias", german: "Danke" },
    { spanish: "Adiós", german: "Tschüss" },
    { spanish: "Buenos días", german: "Guten Morgen" },
    { spanish: "Por favor", german: "Bitte" },
    { spanish: "Agua", german: "Wasser" },
    { spanish: "Casa", german: "Haus" },
    { spanish: "Amigo", german: "Freund" }
];

function loadLocalWords() {
    try {
        const saved = JSON.parse(localStorage.getItem("words"));

        if (Array.isArray(saved)) {
            return saved;
        }

        return [...defaultWords];
    } catch {
        return [...defaultWords];
    }
}

let words = loadLocalWords();
let currentCard = 0;
let currentQuestion = null;
let correct = Number(localStorage.getItem("correct")) || 0;

// XP-Fortschritt
let xp = Number(localStorage.getItem("vocabXP")) || 0;
let flashcardsLearned = Number(localStorage.getItem("flashcardsLearned")) || 0;
let sessionsCompleted = Number(localStorage.getItem("sessionsCompleted")) || 0;
let sessionActions = 0;
let learnedCardsThisSession = new Set();

let currentUser = null;
let syncReady = false;
let quizTimer = null;
let questionLocked = false;
let quizAnswerLanguage = "de";
let quizMode = "normal";
let quizDifficulty = "medium";
let quizAskedCount = 0;
let quizModeCorrect = 0;
let quizModeRewarded = false;
let quizTimeLeft = 60;
let quizModeInterval = null;
let wrongVocabulary = [];
try {
    wrongVocabulary = JSON.parse(localStorage.getItem("wrongVocabulary")) || [];
    if (!Array.isArray(wrongVocabulary)) wrongVocabulary = [];
} catch {
    wrongVocabulary = [];
}

function saveWrongVocabulary() {
    localStorage.setItem("wrongVocabulary", JSON.stringify(wrongVocabulary));
}

function updateQuizModeStatus() {
    const status = document.getElementById("quizModeStatus");
    if (!status) return;
    if (quizMode === "marathon") {
        status.textContent = "Vokabel-Marathon: " + quizAskedCount + " / 50 Fragen";
    } else if (quizMode === "time") {
        status.textContent = "Zeit-Challenge: " + quizTimeLeft + " Sekunden · " + quizModeCorrect + " richtig";
    } else if (quizMode === "errors") {
        status.textContent = "Fehlertraining: " + wrongVocabulary.length + " Vokabeln zum Wiederholen";
    } else {
        status.textContent = "Normaler Quizmodus";
    }
}

function stopQuizModeTimer() {
    if (quizModeInterval) {
        clearInterval(quizModeInterval);
        quizModeInterval = null;
    }
}

function endQuizMode(message) {
    if (quizMode === "marathon" && !quizModeRewarded) {
        addXP(quizModeCorrect);
        quizModeRewarded = true;
        sessionActions = 0;
        updateSessionControls();
    }
    stopQuizModeTimer();
    clearTimeout(quizTimer);
    questionLocked = true;
    const answers = document.getElementById("answers");
    const result = document.getElementById("quizResult");
    const word = document.getElementById("quizWord");
    const direction = document.getElementById("quizDirection");
    if (answers) answers.innerHTML = "";
    if (word) word.textContent = message;
    if (direction) direction.textContent =
        quizMode === "marathon"
            ? "Ergebnis: " + quizModeCorrect + " von " + quizAskedCount + " richtig"
            : quizMode === "time"
                ? "Du hast " + quizModeCorrect + " Fragen richtig beantwortet."
                : "Du hast alle aktuell gespeicherten Fehler wiederholt.";
    if (result) result.textContent = "Du kannst jederzeit eine neue Runde starten.";
    updateQuizModeStatus();
}

function startQuizMode(mode) {
    stopQuizModeTimer();
    clearTimeout(quizTimer);
    quizMode = mode;
    quizAskedCount = 0;
    quizModeCorrect = 0;
    quizModeRewarded = false;
    quizTimeLeft = 60;
    questionLocked = false;

    const selectedDifficulty = document.getElementById("quizDifficulty");
    quizDifficulty = selectedDifficulty ? selectedDifficulty.value : "medium";

    if (mode === "errors") {
        wrongVocabulary = wrongVocabulary.filter(item =>
            words.some(word => word.spanish === item.spanish && word.german === item.german)
        );
        saveWrongVocabulary();
        if (!wrongVocabulary.length) {
            const word = document.getElementById("quizWord");
            const direction = document.getElementById("quizDirection");
            const answers = document.getElementById("answers");
            const result = document.getElementById("quizResult");
            if (word) word.textContent = "Keine Fehler zum Wiederholen vorhanden.";
            if (direction) direction.textContent = "Beantworte zuerst ein paar Quizfragen falsch, damit hier Vokabeln gesammelt werden.";
            if (answers) answers.innerHTML = "";
            if (result) result.textContent = "";
            updateQuizModeStatus();
            return;
        }
    }

    updateQuizModeStatus();
    if (mode === "time") {
        quizModeInterval = setInterval(() => {
            quizTimeLeft--;
            updateQuizModeStatus();
            if (quizTimeLeft <= 0) endQuizMode("Zeit abgelaufen!");
        }, 1000);
    }
    nextQuestion();
}


/* ==========================================
   ANMELDUNG UND STATUS
========================================== */

function setAuthStatus(message) {
    const element = document.getElementById("authStatus");

    if (element) {
        element.textContent = message;
    }
}

function updateAuthPanel() {
    const loggedIn = Boolean(currentUser);

    const authControls = document.getElementById("authControls");
    const signOutButton = document.getElementById("signOutButton");

    authControls.classList.toggle("hidden", loggedIn);
    signOutButton.classList.toggle("hidden", !loggedIn);

    setAuthStatus(
        loggedIn
            ? "Angemeldet: " + currentUser.email + " – Synchronisierung aktiv."
            : "Du bist nicht angemeldet."
    );
}

async function signUp() {
    if (!supabaseClient) {
        setAuthStatus("Supabase konnte nicht geladen werden. Bitte Seite neu laden.");
        return;
    }

    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;

    if (!email || !password) {
        setAuthStatus("Bitte E-Mail und Passwort eingeben.");
        return;
    }

    if (password.length < 8) {
        setAuthStatus("Das Passwort muss mindestens 8 Zeichen haben.");
        return;
    }

    setAuthStatus("Konto wird erstellt ...");

    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password
    });

    if (error) {
        setAuthStatus("Fehler: " + error.message);
        return;
    }

    if (data.session) {
        currentUser = data.user;
        await loadUserData();
    } else {
        setAuthStatus(
            "Konto erstellt. Bitte bestätige deine E-Mail-Adresse und melde dich danach an."
        );
    }
}

async function signIn() {
    if (!supabaseClient) {
        setAuthStatus("Supabase konnte nicht geladen werden. Bitte Seite neu laden.");
        return;
    }

    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;

    if (!email || !password) {
        setAuthStatus("Bitte E-Mail und Passwort eingeben.");
        return;
    }

    setAuthStatus("Anmeldung läuft ...");

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        setAuthStatus("Anmeldung fehlgeschlagen: " + error.message);
        return;
    }

    currentUser = data.user;
    await loadUserData();
}

async function signOut() {
    if (!supabaseClient) {
        setAuthStatus("Supabase ist nicht verfügbar.");
        return;
    }

    const { error } = await supabaseClient.auth.signOut();

    if (error) {
        setAuthStatus("Abmelden fehlgeschlagen: " + error.message);
        return;
    }

    currentUser = null;
    syncReady = false;
    userUnlocks = { beta_tester: false, all_designs: false };
    profileDisplayName = "";
    activeProfileTitle = "";
    renderUnlockStatus();
    updateXPDisplay();

    updateAuthPanel();
    setAuthStatus("Du wurdest abgemeldet.");
}


/* ==========================================
   SUPABASE SYNCHRONISIERUNG
========================================== */


/* FREISCHALTCODES */
let userUnlocks = { beta_tester: false, all_designs: false };
let activeProfileTitle = localStorage.getItem("vocabActiveProfileTitle") || "";
let profileDisplayName = localStorage.getItem("vocabProfileDisplayName") || "";

function renderUnlockStatus() {
    const target = document.getElementById("unlockBadges");
    if (!target) return;
    const badges = [];
    if (userUnlocks.beta_tester) badges.push("Beta Tester – alles freigeschaltet");
    else if (userUnlocks.all_designs) badges.push("Alle Farbdesigns freigeschaltet");
    target.innerHTML = badges.length
        ? badges.map(label => '<span class="unlock-badge">' + label + '</span>').join("")
        : '<span class="unlock-muted">Noch keine Codes eingelöst.</span>';
}

function getUnlockedProfileTitles() {
    const titles = xpLevels
        .filter(item => xp >= item.min || userUnlocks.beta_tester)
        .map(item => item.name);
    if (userUnlocks.beta_tester) titles.push("Beta-Tester");
    return titles;
}

function renderProfilePage() {
    const nameInput = document.getElementById("profileDisplayName");
    const titleSelect = document.getElementById("profileTitleSelect");
    const titlesList = document.getElementById("profileTitles");
    const themesList = document.getElementById("profileThemes");
    const activeLabel = document.getElementById("profileActiveTitle");
    if (!nameInput || !titleSelect || !titlesList || !themesList) return;

    const metadata = currentUser?.user_metadata || {};
    if (document.activeElement !== nameInput) {
        nameInput.value = profileDisplayName || metadata.display_name || "";
    }

    const unlockedTitles = getUnlockedProfileTitles();
    if (!unlockedTitles.includes(activeProfileTitle)) {
        activeProfileTitle = unlockedTitles.includes(metadata.profile_title)
            ? metadata.profile_title
            : (unlockedTitles.includes("Anfänger") ? "Anfänger" : unlockedTitles[0] || "");
    }

    titleSelect.innerHTML = unlockedTitles.length
        ? unlockedTitles.map(title => '<option value="' + escapeHTML(title) + '">' + escapeHTML(title) + '</option>').join("")
        : '<option value="">Noch keine Titel freigeschaltet</option>';
    titleSelect.value = activeProfileTitle;

    titlesList.innerHTML = xpLevels.map(item => {
        const unlocked = xp >= item.min || userUnlocks.beta_tester;
        return '<div class="profile-unlock-item ' + (unlocked ? 'unlocked' : 'locked') + '">' +
            '<span><strong>' + escapeHTML(item.name) + '</strong><small>' +
            (unlocked ? 'Titel freigeschaltet' : item.min.toLocaleString("de-DE") + ' XP erforderlich') +
            '</small></span><span>' + (unlocked ? 'Freigeschaltet' : 'Gesperrt') + '</span></div>';
    }).join("") + (userUnlocks.beta_tester
        ? '<div class="profile-unlock-item unlocked"><span><strong>Beta-Tester</strong><small>Exklusiver Titel · Beta-Tester-Code</small></span><span>Freigeschaltet</span></div>'
        : '<div class="profile-unlock-item locked"><span><strong>Beta-Tester</strong><small>Nur mit dem Beta-Tester-Code</small></span><span>Gesperrt</span></div>') +
        '<div class="profile-unlock-item ' + (isCustomColorsUnlocked() ? 'unlocked' : 'locked') + '">' +
        '<span><strong>Eigene Farben einstellen</strong><small>' + (isCustomColorsUnlocked() ? 'Letzte Belohnung freigeschaltet' : CUSTOM_COLORS_UNLOCK_XP.toLocaleString("de-DE") + ' XP erforderlich') + '</small></span>' +
        '<span>' + (isCustomColorsUnlocked() ? 'Freigeschaltet' : 'Gesperrt') + '</span></div>';

    const themeEntries = Object.entries(colorThemes);
    const selectedTheme = readSavedTheme();
    themesList.innerHTML = themeEntries.map(([key, theme], index) => {
        const unlocked = isThemeUnlocked(key);
        const active = selectedTheme === key;
        const requirement = index === 0 ? 'Startdesign' : (index * 250).toLocaleString("de-DE") + ' XP';
        return '<div class="profile-theme-item ' + (unlocked ? 'unlocked' : 'locked') + '">' +
            '<span class="profile-theme-name"><strong>' + escapeHTML(theme.name) + '</strong><small>' +
            (unlocked ? (active ? 'Aktuelles Design' : 'Freigeschaltet') : requirement + ' erforderlich') +
            '</small></span>' +
            '<button type="button" ' + (unlocked ? 'onclick="setColorTheme(\'' + key + '\')"' : 'disabled') + '>' +
            (active ? 'Aktiv' : unlocked ? 'Auswählen' : 'Gesperrt') + '</button></div>';
    }).join("") + '<div class="profile-theme-item ' + (isCustomColorsUnlocked() ? 'unlocked' : 'locked') + '">' +
        '<span class="profile-theme-name"><strong>Eigene Farben</strong><small>' +
        (isCustomColorsUnlocked() ? (selectedTheme === 'custom' ? 'Aktuelles Design' : 'Freigeschaltet') : CUSTOM_COLORS_UNLOCK_XP.toLocaleString("de-DE") + ' XP erforderlich') +
        '</small></span><button type="button" ' + (isCustomColorsUnlocked() ? 'onclick="showPage(\'settings\')"' : 'disabled') + '>' + (isCustomColorsUnlocked() ? 'Bearbeiten' : 'Gesperrt') + '</button></div>';

    if (activeLabel) activeLabel.textContent = activeProfileTitle
        ? 'Dein aktiver Titel: ' + activeProfileTitle
        : 'Wähle einen freigeschalteten Titel aus.';
}

function selectProfileTitle(title) {
    if (!getUnlockedProfileTitles().includes(title)) return;
    activeProfileTitle = title;
    const label = document.getElementById("profileActiveTitle");
    if (label) label.textContent = "Dein aktiver Titel: " + title;
}

async function saveProfileSettings() {
    const nameInput = document.getElementById("profileDisplayName");
    const status = document.getElementById("profileStatus");
    const title = document.getElementById("profileTitleSelect")?.value || "";
    const name = (nameInput?.value || "").trim();

    if (name.length > 24) {
        if (status) status.textContent = "Der Anzeigename darf höchstens 24 Zeichen lang sein.";
        return;
    }
    if (!getUnlockedProfileTitles().includes(title)) {
        if (status) status.textContent = "Dieser Titel ist nicht freigeschaltet.";
        return;
    }

    profileDisplayName = name;
    activeProfileTitle = title;
    try {
        localStorage.setItem("vocabProfileDisplayName", profileDisplayName);
        localStorage.setItem("vocabActiveProfileTitle", activeProfileTitle);
    } catch (error) {
        console.error("Profil konnte lokal nicht gespeichert werden:", error);
    }

    if (currentUser && supabaseClient) {
        const { data, error } = await supabaseClient.auth.updateUser({
            data: {
                ...(currentUser.user_metadata || {}),
                display_name: profileDisplayName,
                profile_title: activeProfileTitle
            }
        });
        if (error) {
            if (status) status.textContent = "Lokal gespeichert. Cloud-Speicherung fehlgeschlagen: " + error.message;
            return;
        }
        if (data?.user) currentUser = data.user;
    }

    if (status) status.textContent = "Profil gespeichert.";
    renderProfilePage();
}

async function loadUserUnlocks() {
    if (!currentUser || !supabaseClient) {
        userUnlocks = { beta_tester: false, all_designs: false };
        renderUnlockStatus();
        return;
    }
    const { data, error } = await supabaseClient
        .from("user_unlocks")
        .select("beta_tester, all_designs")
        .eq("user_id", currentUser.id)
        .maybeSingle();

    if (error) {
        const status = document.getElementById("unlockStatus");
        if (status) status.textContent = "Freischaltungen konnten nicht geladen werden. Bitte SQL-Einrichtung abschließen.";
        return;
    }
    userUnlocks = {
        beta_tester: Boolean(data?.beta_tester),
        all_designs: Boolean(data?.all_designs)
    };
    renderUnlockStatus();
    updateXPDisplay();
}

async function redeemUnlockCode() {
    const input = document.getElementById("unlockCode");
    const status = document.getElementById("unlockStatus");
    const code = input?.value.trim();

    if (!currentUser || !supabaseClient) {
        status.textContent = "Bitte melde dich zuerst an.";
        return;
    }
    if (!code) {
        status.textContent = "Bitte gib einen Code ein.";
        return;
    }

    status.textContent = "Code wird überprüft ...";
    const { data, error } = await supabaseClient.rpc("redeem_unlock_code", {
        input_code: code
    });

    if (error) {
        console.error("Freischaltcode:", error);
        status.textContent = "Code konnte nicht geprüft werden. Bitte zuerst die SQL-Einrichtung in Supabase ausführen.";
        return;
    }
    if (!data?.success) {
        status.textContent = data?.message || "Dieser Code ist ungültig.";
        return;
    }

    await loadUserUnlocks();
    status.textContent = data.message || "Freischaltung erfolgreich!";
    input.value = "";
}

async function loadUserData() {
    if (!currentUser || !supabaseClient) return;

    syncReady = false;
    setAuthStatus("Deine Vokabeln werden geladen ...");

    const { data, error } = await supabaseClient
        .from("vocab_data")
        .select("words, correct, xp, flashcards_learned, sessions_completed")
        .eq("user_id", currentUser.id)
        .maybeSingle();

    if (error) {
        setAuthStatus("Ladefehler: " + error.message);
        return;
    }

    await loadUserUnlocks();
    profileDisplayName = currentUser
        ? (currentUser.user_metadata?.display_name || "")
        : (localStorage.getItem("vocabProfileDisplayName") || "");
    activeProfileTitle = currentUser
        ? (currentUser.user_metadata?.profile_title || "")
        : (localStorage.getItem("vocabActiveProfileTitle") || "");

    if (data) {
        words = Array.isArray(data.words)
            ? data.words
            : [...defaultWords];

        correct = Number(data.correct) || 0;
        xp = Number(data.xp) || 0;
        flashcardsLearned = Number(data.flashcards_learned) || 0;
        sessionsCompleted = Number(data.sessions_completed) || 0;

        syncReady = true;

    } else {
        /*
         * Beim ersten Login werden die lokalen
         * Vokabeln in die Cloud übernommen.
         */
        syncReady = true;
        await saveDataToCloud();
    }

    localStorage.setItem("words", JSON.stringify(words));
    localStorage.setItem("correct", String(correct));
    localStorage.setItem("vocabXP", String(xp));
    localStorage.setItem("flashcardsLearned", String(flashcardsLearned));
    localStorage.setItem("sessionsCompleted", String(sessionsCompleted));

    updateStats();
    updateXPDisplay();
    showCard();
    showWordList();
    updateAuthPanel();
}

async function saveDataToCloud() {
    if (!currentUser || !syncReady || !supabaseClient) return;

    const { error } = await supabaseClient
        .from("vocab_data")
        .upsert({
            user_id: currentUser.id,
            words: words,
            correct: correct,
            xp: xp,
            flashcards_learned: flashcardsLearned,
            sessions_completed: sessionsCompleted,
            updated_at: new Date().toISOString()
        }, {
            onConflict: "user_id"
        });

    if (error) {
        setAuthStatus("Synchronisierungsfehler: " + error.message);
    } else {
        setAuthStatus(
            "Angemeldet: " + currentUser.email + " – synchronisiert."
        );
    }
}

function saveData() {
    localStorage.setItem("words", JSON.stringify(words));
    localStorage.setItem("correct", String(correct));

    saveDataToCloud();
}


/* ==========================================
   STATISTIKEN
========================================== */

function updateStats() {
    document.getElementById("wordCount").textContent = words.length;
    document.getElementById("correctCount").textContent = correct;
    updateXPDisplay();
}

/* XP, LEVEL UND LERNEINHEITEN */
const CUSTOM_COLORS_UNLOCK_XP = 5000;

const xpLevels = [
    { name: "Anfänger", min: 0, badge: "Erster Schritt" },
    { name: "Wortsammler", min: 500, badge: "Wortsammler" },
    { name: "Sprachentdecker", min: 1500, badge: "Sprachentdecker" },
    { name: "Sprachprofi", min: 2500, badge: "Sprachprofi" },
    { name: "Spanisch-Meister", min: 4500, badge: "Spanisch-Meister" }
];

function getXPLevel() {
    let index = xpLevels.findIndex((level, i) =>
        xp >= level.min && (!xpLevels[i + 1] || xp < xpLevels[i + 1].min)
    );
    if (index < 0) index = xpLevels.length - 1;
    if (userUnlocks.beta_tester) index = xpLevels.length - 1;
    return { ...xpLevels[index], index, next: xpLevels[index + 1] || null };
}

function updateXPDisplay() {
    const total = document.getElementById("xpTotal");
    if (!total) return;
    const level = getXPLevel();
    const previous = level.min;
    const next = level.next;
    const progress = next
        ? Math.max(0, Math.min(100, ((xp - previous) / (next.min - previous)) * 100))
        : 100;
    total.textContent = xp + " XP";
    const levelLabel = document.getElementById("xpLevel");
    if (levelLabel) levelLabel.textContent = userUnlocks.beta_tester ? "Beta-Tester · alle Level" : level.name;
    document.getElementById("xpProgressBar").style.width = progress + "%";
    document.getElementById("xpProgressText").textContent = next
        ? (next.min - xp) + " XP bis Level " + next.name
        : "Höchstes Level erreicht";
    const maxXP = CUSTOM_COLORS_UNLOCK_XP;
    const overallProgress = Math.max(0, Math.min(100, (xp / maxXP) * 100));
    const overallBar = document.getElementById("xpOverallProgressBar");
    const overallText = document.getElementById("xpOverallProgressText");
    if (overallBar) overallBar.style.width = overallProgress + "%";
    if (overallText) overallText.textContent = Math.min(xp, maxXP).toLocaleString("de-DE") + " von " + maxXP.toLocaleString("de-DE") + " XP";

    const badges = document.getElementById("xpBadges");
    badges.innerHTML = xpLevels.map((item, index) => {
        const unlocked = xp >= item.min || userUnlocks.beta_tester;
        const nextLevel = xpLevels[index + 1];
        const requirement = item.min === 0
            ? "Startbelohnung"
            : item.min.toLocaleString("de-DE") + " XP";
        const detail = unlocked
            ? (item.min === 0 ? "Bereits freigeschaltet" : "Freigeschaltet")
            : (item.min - xp).toLocaleString("de-DE") + " XP fehlen noch";
        return '<div class="xp-roadmap-item' + (unlocked ? ' earned' : ' locked') + '">' +
            '<div class="xp-roadmap-icon">' + (unlocked ? '★' : '🔒') + '</div>' +
            '<div class="xp-roadmap-info"><strong>' + escapeHTML(item.name) + '</strong>' +
            '<span>' + escapeHTML(item.badge) + ' · ' + requirement + '</span>' +
            '<small>' + detail + '</small></div>' +
            '<div class="xp-roadmap-status">' + (unlocked ? 'Erreicht' : 'Offen') + '</div>' +
            '</div>';
    }).join("") + (userUnlocks.beta_tester
        ? '<div class="xp-roadmap-item earned beta-title-reward">' +
            '<div class="xp-roadmap-icon">★</div>' +
            '<div class="xp-roadmap-info"><strong>Exklusiver Titel: Beta-Tester</strong>' +
            '<span>Nur mit dem Beta-Tester-Code erhältlich</span>' +
            '<small>Durch den Beta-Tester-Code freigeschaltet</small></div>' +
            '<div class="xp-roadmap-status">Erreicht</div>' +
          '</div>'
        : "");
    updateSessionControls();
    updateThemeUnlocks();
    updateCustomColorsUnlock();
    renderProfilePage();
}

function persistXP() {
    localStorage.setItem("vocabXP", String(xp));
    localStorage.setItem("flashcardsLearned", String(flashcardsLearned));
    localStorage.setItem("sessionsCompleted", String(sessionsCompleted));
    saveDataToCloud();
    updateXPDisplay();
}

function addXP(amount) {
    xp += amount;
    persistXP();
    syncWeeklyXP(amount);
}

async function syncWeeklyXP(amount) {
    if (!currentUser || !supabaseClient || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return;
    const displayName = (profileDisplayName || currentUser.user_metadata?.display_name || "Lernender").trim().slice(0, 24) || "Lernender";
    const { error } = await supabaseClient.rpc("increment_weekly_xp", {
        p_amount: Math.floor(Number(amount)),
        p_display_name: displayName
    });
    if (error) {
        console.error("Wöchentliche XP konnten nicht gespeichert werden:", error);
        const status = document.getElementById("leaderboardStatus");
        if (status) status.textContent = "Wochen-XP konnten nicht gespeichert werden. Bitte Datenbank-SQL einrichten.";
    }
}

function updateSessionControls() {
    const ready = sessionActions >= 5;
    const status = document.getElementById("quizSessionStatus");
    const button = document.getElementById("quizFinishSession");
    if (status) {
        status.textContent = quizMode === "time"
            ? "Zeit-Challenge: +5 XP pro richtige Vokabel · keine zusätzliche Lerneinheit"
            : "Lernaktionen: " + sessionActions + "/5";
    }
    if (button) {
        button.disabled = !ready ||
            quizMode === "marathon" ||
            quizMode === "errors" ||
            quizMode === "time";
    }
}

function finishLearningSession() {
    if (sessionActions < 5 ||
        quizMode === "marathon" ||
        quizMode === "errors" ||
        quizMode === "time") return;
    sessionsCompleted++;
    addXP(20);
    sessionActions = 0;
    updateSessionControls();
    const status = document.getElementById("quizSessionStatus");
    if (status) status.textContent = "Lerneinheit abgeschlossen! +20 XP";
}


/* ==========================================
   SEITEN WECHSELN
========================================== */

function showPage(page) {
    document.querySelectorAll(".page").forEach(section => {
        section.classList.remove("active");
        section.classList.add("hidden");
    });

    const selectedPage = document.getElementById(page);

    if (!selectedPage) return;

    selectedPage.classList.remove("hidden");
    selectedPage.classList.add("active");

    if (page === "cards") {
        showCard();
    }

    if (page === "quiz") {
        nextQuestion();
    }

    if (page === "manage") {
        showWordList();
    }

    if (page === "profile") {
        renderProfilePage();
    }

    if (page === "leaderboard") {
        loadWeeklyLeaderboard();
    }

    updateStats();
}




/* ==========================================
   FORTSCHRITT ZURÜCKSETZEN
========================================== */

async function resetLearningProgress() {
    const status = document.getElementById("resetProgressStatus");
    if (!currentUser || !supabaseClient) {
        if (status) status.textContent = "Bitte melde dich zuerst an.";
        return;
    }

    const confirmed = window.confirm(
        "Möchtest du wirklich deinen gesamten Lernfortschritt und deine Freischaltcodes zurücksetzen? Deine eingescannten und selbst hinzugefügten Vokabeln sowie dein Benutzerkonto bleiben erhalten. Deine Wochen-XP werden ebenfalls auf 0 gesetzt. Dieser Vorgang kann nicht rückgängig gemacht werden."
    );
    if (!confirmed) return;

    const button = document.getElementById("resetProgressButton");
    if (button) button.disabled = true;
    if (status) status.textContent = "Fortschritt wird zurückgesetzt ...";

    try {
        const { error } = await supabaseClient.rpc("reset_my_learning_progress");
        if (error) throw error;

        xp = 0;
        correct = 0;
        flashcardsLearned = 0;
        sessionsCompleted = 0;
        sessionActions = 0;
        learnedCardsThisSession = new Set();
        wrongVocabulary = [];
        userUnlocks = { beta_tester: false, all_designs: false };
        activeProfileTitle = "Anfänger";

        localStorage.setItem("vocabXP", "0");
        localStorage.setItem("correct", "0");
        localStorage.setItem("flashcardsLearned", "0");
        localStorage.setItem("sessionsCompleted", "0");
        localStorage.setItem("wrongVocabulary", "[]");
        localStorage.setItem("vocabActiveProfileTitle", "Anfänger");

        const { error: profileError } = await supabaseClient.auth.updateUser({
            data: { profile_title: "Anfänger" }
        });
        if (profileError) console.warn("Profil-Titel konnte nicht aktualisiert werden:", profileError);

        renderUnlockStatus();
        updateStats();
        updateXPDisplay();
        renderProfilePage();
        updateSessionControls();
        showWordList();
        showCard();

        if (syncReady) await saveDataToCloud();
        await loadWeeklyLeaderboard();

        if (status) {
            status.textContent = profileError
                ? "Fortschritt zurückgesetzt. Der aktive Titel konnte nicht automatisch aktualisiert werden."
                : "Fortschritt und Freischaltcodes wurden zurückgesetzt. Deine Vokabeln sind erhalten geblieben.";
        }
    } catch (error) {
        console.error("Fortschritt konnte nicht zurückgesetzt werden:", error);
        if (status) status.textContent = "Zurücksetzen fehlgeschlagen: " + (error.message || "Unbekannter Fehler") + ". Bitte prüfe, ob du das SQL eingerichtet hast.";
    } finally {
        if (button) button.disabled = false;
    }
}

/* ==========================================
   WOCHEN-BESTENLISTE
========================================== */

async function loadWeeklyLeaderboard() {
    const status = document.getElementById("leaderboardStatus");
    const content = document.getElementById("leaderboardContent");
    const weekLabel = document.getElementById("leaderboardWeek");
    if (!status || !content) return;

    if (!currentUser || !supabaseClient) {
        status.textContent = "Bitte melde dich an, um die Wochen-Bestenliste zu sehen.";
        content.innerHTML = "";
        if (weekLabel) weekLabel.textContent = "";
        return;
    }

    status.textContent = "Bestenliste wird geladen ...";
    content.innerHTML = "";
    const { data, error } = await supabaseClient.rpc("get_weekly_leaderboard");
    if (error) {
        status.textContent = "Bestenliste noch nicht verfügbar. Bitte führe zuerst das SQL für die Bestenliste in Supabase aus.";
        console.error("Bestenliste konnte nicht geladen werden:", error);
        return;
    }

    const rows = Array.isArray(data) ? data : [];
    if (weekLabel && rows.length && rows[0].week_start) {
        const weekDate = new Date(rows[0].week_start + "T12:00:00");
        weekLabel.textContent = "Woche ab " + weekDate.toLocaleDateString("de-DE");
    } else if (weekLabel) {
        weekLabel.textContent = "Aktuelle Kalenderwoche";
    }

    if (!rows.length) {
        status.textContent = "Es gibt noch keine angemeldeten Teilnehmer."; 
        content.innerHTML = "";
        return;
    }

    status.textContent = rows.length + " Teilnehmer";
    content.innerHTML = '<table class="leaderboard-table"><thead><tr><th>Platz</th><th>Anzeigename</th><th>Wochen-XP</th></tr></thead><tbody>' +
        rows.map((row, index) => {
            const isMe = row.user_id === currentUser.id;
            return '<tr' + (isMe ? ' class="leaderboard-me"' : '') + '><td>' + (index + 1) + '</td><td>' + escapeHTML(row.display_name || "Lernender") + (row.profile_title ? ' <span class="leaderboard-title">· ' + escapeHTML(row.profile_title) + '</span>' : '') + (isMe ? ' <span class="leaderboard-you">(Du)</span>' : '') + '</td><td>' + (Number(row.weekly_xp) || 0).toLocaleString("de-DE") + ' XP</td></tr>';
        }).join("") + '</tbody></table>';
}

/* ==========================================
   SPRACHAUSGABE UND AUSSPRACHE-TRAINING
========================================== */

function speakText(text, language = "es-ES") {
    if (!("speechSynthesis" in window)) {
        alert("Die Vorlesefunktion wird von diesem Browser leider nicht unterstützt.");
        return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(String(text || ""));
    utterance.lang = language;
    utterance.rate = 0.85;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
}

function speakQuizWord() {
    const word = document.getElementById("quizWord")?.textContent || "";
    const language = quizAnswerLanguage === "de" ? "es-ES" : "de-DE";
    speakText(word, language);
}

function startPronunciationCheck(input, status, checkButton) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        status.textContent = "Dein Browser unterstützt keine Spracherkennung. Verwende Chrome oder Edge.";
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = quizAnswerLanguage === "es" ? "es-ES" : "de-DE";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    status.textContent = "Ich höre zu …";
    const micButton = status.previousElementSibling;
    if (micButton) micButton.disabled = true;

    recognition.onresult = event => {
        const transcript = event.results[0][0].transcript.trim();
        input.value = transcript;
        status.textContent = "Erkannt: „" + transcript + "“ – klicke auf „Antwort überprüfen“. Die Erkennung ist eine Orientierung und keine genaue Bewertung deines Akzents.";
        checkButton.disabled = false;
    };

    recognition.onerror = event => {
        const messages = {
            "not-allowed": "Mikrofonzugriff wurde nicht erlaubt. Prüfe die Browser-Berechtigungen.",
            "no-speech": "Es wurde nichts erkannt. Versuche es bitte erneut.",
            "audio-capture": "Kein Mikrofon gefunden.",
            "network": "Die Spracherkennung benötigt eine Netzwerkverbindung."
        };
        status.textContent = messages[event.error] || "Spracherkennung fehlgeschlagen: " + event.error;
    };

    recognition.onend = () => {
        if (micButton) micButton.disabled = false;
    };

    try {
        recognition.start();
    } catch (error) {
        status.textContent = "Die Spracherkennung konnte nicht gestartet werden. Bitte versuche es erneut.";
        if (micButton) micButton.disabled = false;
    }
}


/* ==========================================
   LERNKARTEN
========================================== */

function showCard() {
    const spanishWord = document.getElementById("spanishWord");
    const translation = document.getElementById("translation");

    if (words.length === 0) {
        spanishWord.textContent = "Keine Vokabeln vorhanden";
        translation.textContent = "";
        return;
    }

    currentCard = currentCard % words.length;

    spanishWord.textContent = words[currentCard].spanish;
    translation.textContent = words[currentCard].german;
    const spanishSpeakButton = document.getElementById("speakSpanishCard");
    const germanSpeakButton = document.getElementById("speakGermanCard");
    if (spanishSpeakButton) spanishSpeakButton.onclick = () => speakText(words[currentCard].spanish, "es-ES");
    if (germanSpeakButton) germanSpeakButton.onclick = () => speakText(words[currentCard].german, "de-DE");
}


function nextCard() {
    if (words.length === 0) return;

    currentCard = (currentCard + 1) % words.length;

    showCard();
}


/* ==========================================
   QUIZ – GEMISCHTE FRAGERICHTUNGEN
========================================== */

function nextQuestion() {
    clearTimeout(quizTimer);

    const answers = document.getElementById("answers");
    const result = document.getElementById("quizResult");
    const quizWord = document.getElementById("quizWord");
    const direction = document.getElementById("quizDirection");

    answers.innerHTML = "";
    result.innerHTML = "";

    questionLocked = false;

    if (quizMode === "time" && quizTimeLeft <= 0) {
        endQuizMode("Zeit abgelaufen!");
        return;
    }
    if (quizMode === "marathon" && quizAskedCount >= 50) {
        endQuizMode("Marathon geschafft!");
        return;
    }

    let availableIndexes = words.map((word, index) => index);
    if (quizMode === "errors") {
        availableIndexes = availableIndexes.filter(index =>
            wrongVocabulary.some(item =>
                item.spanish === words[index].spanish && item.german === words[index].german
            )
        );
        if (!availableIndexes.length) {
            endQuizMode("Fehlertraining abgeschlossen!");
            return;
        }
    }
    if (availableIndexes.length === 0) {
        quizWord.textContent = "Du benötigst mindestens eine Vokabel.";
        direction.textContent = "";
        return;
    }

    currentQuestion = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
    const word = words[currentQuestion];

    /*
     * Zufällige Fragerichtung:
     * true = Spanisch nach Deutsch
     * false = Deutsch nach Spanisch
     */
    const spanishToGerman = Math.random() < 0.5;
    quizAnswerLanguage = spanishToGerman ? "de" : "es";

    const question = spanishToGerman
        ? word.spanish
        : word.german;

    const correctAnswer = spanishToGerman
        ? word.german
        : word.spanish;

    quizWord.textContent = question;

    direction.textContent = spanishToGerman
        ? "Übersetze ins Deutsche"
        : "Übersetze ins Spanische";

    /*
     * Zufälliger Fragetyp:
     * true = Multiple Choice
     * false = Antwort eintippen
     */
    const multipleChoice = quizDifficulty === "easy"
        ? true
        : quizDifficulty === "medium"
            ? false
            : Math.random() < 0.5;

    if (multipleChoice) {
        createMultipleChoice(
            correctAnswer,
            spanishToGerman,
            answers,
            result
        );
    } else {
        createWrittenAnswer(
            correctAnswer,
            answers,
            result
        );
    }
}


/* ==========================================
   MULTIPLE CHOICE
========================================== */

function createMultipleChoice(
    correctAnswer,
    spanishToGerman,
    answers,
    result
) {
    const property = spanishToGerman ? "german" : "spanish";

    let options = [correctAnswer];

    const possibleAnswers = [
        ...new Set(
            words
                .map(word => word[property])
                .filter(answer => answer !== correctAnswer)
        )
    ];

    possibleAnswers.sort(() => Math.random() - 0.5);

    options.push(
        ...possibleAnswers.slice(0, 3)
    );

    /*
     * Falls es nicht genug unterschiedliche Antworten
     * für Multiple Choice gibt, wird eine Eingabe gefragt.
     */
    if (options.length < 2) {
        createWrittenAnswer(correctAnswer, answers, result);
        return;
    }

    options.sort(() => Math.random() - 0.5);

    options.forEach(option => {
        const button = document.createElement("button");

        button.textContent = option;

        button.onclick = () => {
            checkQuizAnswer(
                option,
                correctAnswer,
                result,
                answers
            );
        };

        answers.appendChild(button);
    });
}


/* ==========================================
   EINGABEFRAGE
========================================== */

function createWrittenAnswer(
    correctAnswer,
    answers,
    result
) {
    const area = document.createElement("div");
    area.className = "written-answer-area";

    const input = document.createElement("input");
    input.type = "text";
    input.id = "writtenAnswer";
    input.placeholder = "Deine Übersetzung ...";
    input.autocomplete = "off";
    input.lang = quizAnswerLanguage;
    input.spellcheck = true;
    input.setAttribute("autocorrect", "on");

    const micButton = document.createElement("button");
    micButton.type = "button";
    micButton.className = "speech-button";
    micButton.textContent = "🎙️ Antwort einsprechen";

    const speechStatus = document.createElement("p");
    speechStatus.className = "speech-status";
    speechStatus.setAttribute("aria-live", "polite");

    const button = document.createElement("button");
    button.textContent = "Antwort überprüfen";

    micButton.onclick = () => startPronunciationCheck(input, speechStatus, button);

    button.onclick = () => {
        checkQuizAnswer(
            input.value,
            correctAnswer,
            result,
            answers
        );
    };

    input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            checkQuizAnswer(
                input.value,
                correctAnswer,
                result,
                answers
            );
        }
    });

    area.appendChild(input);
    area.appendChild(micButton);
    area.appendChild(speechStatus);
    area.appendChild(button);

    answers.appendChild(area);

    input.focus();
}


/* ==========================================
   ANTWORTEN ÜBERPRÜFEN
========================================== */

function normalizeAnswer(answer) {
    return String(answer)
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ");
}

function checkQuizAnswer(
    userAnswer,
    correctAnswer,
    result,
    answers
) {
    if (questionLocked) return;

    if (!String(userAnswer).trim()) {
        result.textContent = "Bitte gib eine Antwort ein.";
        result.style.color = "#c77d70";
        return;
    }

    questionLocked = true;

    const isCorrect =
        normalizeAnswer(userAnswer) ===
        normalizeAnswer(correctAnswer);

    const controls = answers.querySelectorAll("button, input");

    controls.forEach(control => {
        control.disabled = true;
    });

    sessionActions++;
    quizAskedCount++;
    updateQuizModeStatus();
    updateSessionControls();

    if (isCorrect) {
        quizModeCorrect++;
        if (currentQuestion !== null && words[currentQuestion]) {
            const answeredWord = words[currentQuestion];
            wrongVocabulary = wrongVocabulary.filter(item =>
                !(item.spanish === answeredWord.spanish && item.german === answeredWord.german)
            );
            saveWrongVocabulary();
        }
        result.textContent = "Richtig!";
        if (quizMode === "errors") addXP(1);
        else if (quizMode === "time") addXP(5);
        else if (quizMode !== "marathon") addXP(10);
        result.style.color = "#718466";

        correct++;

        saveData();
        updateStats();

        quizTimer = setTimeout(() => {
            const quizPage = document.getElementById("quiz");
            if (quizMode === "marathon" && quizAskedCount >= 50) {
                endQuizMode("Marathon geschafft!");
                return;
            }
            if (quizMode === "errors" && wrongVocabulary.length === 0) {
                endQuizMode("Fehlertraining abgeschlossen!");
                return;
            }
            if (quizPage && !quizPage.classList.contains("hidden")) nextQuestion();
        }, 700);

    } else {
        if (currentQuestion !== null && words[currentQuestion]) {
            const answeredWord = words[currentQuestion];
            if (!wrongVocabulary.some(item =>
                item.spanish === answeredWord.spanish && item.german === answeredWord.german
            )) {
                wrongVocabulary.push({
                    spanish: answeredWord.spanish,
                    german: answeredWord.german
                });
                saveWrongVocabulary();
            }
        }
        result.innerHTML = `
            <div class="wrong-answer" style="background:#26334d !important;background-color:#26334d !important;border:1px solid #465a82 !important;border-radius:16px;padding:20px;margin-top:15px;text-align:center;color:#ffffff !important;">
                <div class="wrong-label" style="color:#cbd3e5 !important;font-size:15px;font-weight:700;">Richtige Antwort:</div>
                <div class="wrong-word" style="display:block;margin-top:8px;color:#ffffff !important;font-size:26px;font-weight:800;">${escapeHTML(correctAnswer)}</div>
            </div>
        `;

        const nextButton = document.createElement("button");

        nextButton.textContent = "Nächste Frage";
        nextButton.className = "next-question-button";

        nextButton.onclick = nextQuestion;

        answers.appendChild(nextButton);
        if (quizMode === "time") {
            quizTimer = setTimeout(() => {
                if (quizTimeLeft > 0) nextQuestion();
            }, 500);
        }
    }

    if (quizMode === "marathon" && quizAskedCount >= 50) {
        quizTimer = setTimeout(() => endQuizMode("Marathon geschafft!"), 700);
    } else if (quizMode === "errors" && wrongVocabulary.length === 0) {
        quizTimer = setTimeout(() => endQuizMode("Fehlertraining abgeschlossen!"), 700);
    }
}


/* ==========================================
   HTML SICHER AUSGEBEN
========================================== */

function escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}


/* ==========================================
   RECHTSCHREIBUNG BEI VOKABELN
========================================== */

// Häufige spanische Schreibfehler und fehlende Akzente.
// Mehrdeutige Wörter wie "si/sí" werden absichtlich nicht automatisch geändert.
function correctKnownSpelling(value, language) {
    let result = String(value || "").normalize("NFC").trim().replace(/\\s+/g, " ");

    if (language === "es") {
        const corrections = {
            "adios": "adiós",
            "dias": "días",
            "buenos dias": "buenos días",
            "sinco": "cinco",
            "holá": "hola",
            "gracías": "gracias",
            "tambien": "también",
            "despues": "después",
            "ingles": "inglés",
            "telefono": "teléfono",
            "facil": "fácil",
            "ultimo": "último",
            "numero": "número",
            "arbol": "árbol",
            "corazon": "corazón",
            "cancion": "canción",
            "accion": "acción",
            "jovenes": "jóvenes",
            "lapiz": "lápiz"
        };

        const corrected = corrections[result.toLocaleLowerCase("es")];
        if (corrected) result = corrected;
    }

    if (language === "de" && result) {
        result = result.charAt(0).toLocaleUpperCase("de") + result.slice(1);
    }

    return result;
}

function prepareVocabularyEntry(spanishValue, germanValue) {
    const originalSpanish = String(spanishValue || "").trim();
    const originalGerman = String(germanValue || "").trim();

    const spanish = correctKnownSpelling(originalSpanish, "es");
    const german = correctKnownSpelling(originalGerman, "de");

    const changes = [];
    if (spanish !== originalSpanish) changes.push("Spanisch: " + originalSpanish + " → " + spanish);
    if (german !== originalGerman) changes.push("Deutsch: " + originalGerman + " → " + german);

    return { spanish, german, changes };
}

/* ==========================================
   VOKABEL HINZUFÜGEN
========================================== */

function addWord() {
    const spanishInput = document.getElementById("newSpanish");
    const germanInput = document.getElementById("newGerman");

    const entry = prepareVocabularyEntry(spanishInput.value, germanInput.value);
    const { spanish, german, changes } = entry;

    if (!spanish || !german) {
        alert("Bitte beide Felder ausfüllen.");
        return;
    }

    const duplicate = words.some(word =>
        word.spanish.normalize("NFC").toLocaleLowerCase("es") === spanish.toLocaleLowerCase("es")
    );
    if (duplicate) {
        alert("Diese spanische Vokabel ist bereits vorhanden.");
        return;
    }

    if (changes.length) {
        alert("Ich habe diese eindeutigen Schreibweisen korrigiert:\n\n" + changes.join("\n") +
            "\n\nBitte prüfe die Vokabel vor dem Speichern.");
    }

    words.push({
        spanish: spanish,
        german: german
    });

    saveData();

    spanishInput.value = "";
    germanInput.value = "";

    showWordList();
    updateStats();
}


/* ==========================================
   VOKABELLISTE
========================================== */

function showWordList() {
    const list = document.getElementById("wordList");
    list.innerHTML = "";

    if (words.length === 0) {
        list.textContent = "Noch keine Vokabeln vorhanden.";
        return;
    }

    // Anzeige alphabetisch nach dem spanischen Begriff sortieren.
    // Die ursprünglichen Array-Indizes bleiben erhalten, damit Bearbeiten/Löschen stimmt.
    const sortedWords = words
        .map((word, index) => ({ word, index }))
        .sort((a, b) => a.word.spanish.localeCompare(
            b.word.spanish,
            "es",
            { sensitivity: "base" }
        ));

    sortedWords.forEach(({ word, index }) => {
        const item = document.createElement("div");
        item.className = "word-item";
        item.dataset.index = String(index);

        const text = document.createElement("span");
        text.className = "word-item-text";
        text.textContent = word.spanish + " – " + word.german;

        const actions = document.createElement("div");
        actions.className = "word-item-actions";

        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "edit-word-button";
        edit.textContent = "Bearbeiten";
        edit.onclick = () => editWord(index);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Löschen";
        remove.onclick = () => {
            words.splice(index, 1);
            saveData();
            showWordList();
            updateStats();
            currentCard = 0;
            showCard();
        };

        actions.appendChild(edit);
        actions.appendChild(remove);
        item.appendChild(text);
        item.appendChild(actions);
        list.appendChild(item);
    });
}

function editWord(index) {
    const word = words[index];
    if (!word) return;

    const list = document.getElementById("wordList");
    // Über den gespeicherten Originalindex wird auch bei doppelten Wörtern die richtige Zeile bearbeitet.
    const targetRow = [...list.querySelectorAll(".word-item")].find(row =>
        row.dataset.index === String(index)
    );

    if (!targetRow) return;

    targetRow.innerHTML = "";

    const fields = document.createElement("div");
    fields.className = "word-edit-fields";

    const spanishInput = document.createElement("input");
    spanishInput.type = "text";
    spanishInput.value = word.spanish;
    spanishInput.placeholder = "Spanisches Wort";
    spanishInput.lang = "es";
    spanishInput.spellcheck = true;

    const germanInput = document.createElement("input");
    germanInput.type = "text";
    germanInput.value = word.german;
    germanInput.placeholder = "Deutsche Übersetzung";
    germanInput.lang = "de";
    germanInput.spellcheck = true;

    fields.appendChild(spanishInput);
    fields.appendChild(germanInput);

    const actions = document.createElement("div");
    actions.className = "word-item-actions";

    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Speichern";
    save.onclick = () => {
        const entry = prepareVocabularyEntry(spanishInput.value, germanInput.value);
        const { spanish, german, changes } = entry;

        if (!spanish || !german) {
            alert("Bitte beide Felder ausfüllen.");
            return;
        }

        if (changes.length) {
            alert("Ich habe diese eindeutigen Schreibweisen korrigiert:\n\n" + changes.join("\n") +
                "\n\nBitte prüfe die Vokabel vor dem Speichern.");
        }

        words[index] = { spanish, german };
        saveData();
        showWordList();
        showCard();
    };

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "edit-word-button";
    cancel.textContent = "Abbrechen";
    cancel.onclick = showWordList;

    actions.appendChild(save);
    actions.appendChild(cancel);

    targetRow.appendChild(fields);
    targetRow.appendChild(actions);
    spanishInput.focus();
}


/* ==========================================
   FOTO-SCAN
========================================== */

async function scanVocabulary(event) {
    const file = event.target.files[0];

    if (!file) return;

    const status = document.getElementById("scanStatus");
    const editor = document.getElementById("scanEditor");
    const scanText = document.getElementById("scanText");

    editor.classList.add("hidden");

    if (!window.Tesseract) {
        status.textContent =
            "Texterkennung konnte nicht geladen werden. Internetverbindung prüfen.";

        event.target.value = "";
        return;
    }

    try {
        status.textContent =
            "Vokabelliste wird eingescannt. Bitte warten ...";

        const result = await Tesseract.recognize(
            file,
            "spa+deu",
            {
                logger: message => {
                    if (message.status === "recognizing text") {
                        status.textContent =
                            "Texterkennung: " +
                            Math.round(message.progress * 100) +
                            "%";
                    }
                }
            }
        );

        scanText.value = result.data.text;

        editor.classList.remove("hidden");

        status.textContent =
            "Scan abgeschlossen! Bitte überprüfe die Wörter.";

    } catch (error) {
        console.error(error);

        status.textContent =
            "Scan fehlgeschlagen. Bitte versuche ein anderes Foto.";
    }

    event.target.value = "";
}


/* ==========================================
   ERKANNTE VOKABELN ÜBERNEHMEN
========================================== */

/* ==========================================
   VOKABELDATEI IMPORTIEREN
========================================== */

async function importVocabularyFile(file) {
    if (!file) return;

    const status = document.getElementById("scanStatus");
    const editor = document.getElementById("scanEditor");
    const scanText = document.getElementById("scanText");

    const extension = file.name.split(".").pop().toLowerCase();
    if (!["csv", "txt"].includes(extension)) {
        status.textContent = "Bitte eine CSV- oder TXT-Datei auswählen.";
        return;
    }

    try {
        const content = await file.text();
        scanText.value = content;
        editor.classList.remove("hidden");
        status.textContent = "Datei geladen. Prüfe die Vokabeln und klicke auf „Vokabeln importieren“.";
    } catch (error) {
        console.error(error);
        status.textContent = "Die Datei konnte nicht gelesen werden.";
    }
}


function importScannedWords() {
    const text = document.getElementById("scanText").value;

    if (!text.trim()) {
        alert("Es wurde kein Text erkannt.");
        return;
    }

    let imported = 0;

    text.split(/\r?\n/).forEach(line => {
        line = line.trim();

        if (!line) return;

        const parts = line.split(/\s*(?:=|\||;|\t)\s*/);

        if (parts.length < 2) return;

        const spanish = parts[0].trim();
        const german = parts.slice(1).join(" ").trim();

        if (!spanish || !german) return;

        const exists = words.some(word =>
            word.spanish.toLowerCase() === spanish.toLowerCase()
        );

        if (!exists) {
            words.push({
                spanish: spanish,
                german: german
            });

            imported++;
        }
    });

    saveData();
    updateStats();
    showWordList();

    document.getElementById("scanStatus").textContent =
        imported + " neue Vokabeln wurden übernommen.";

    document.getElementById("scanEditor").classList.add("hidden");
    document.getElementById("scanText").value = "";

    alert(imported + " Vokabeln erfolgreich importiert!");
}



/* ==========================================
   FARBSCHEMA / DESIGN
========================================== */

const colorThemes = {
    sage: {
        "--background": "#f4f1e9", "--card": "#fffdf7", "--sage": "#9eaa91",
        "--sage-dark": "#78866c", "--brown": "#625b4e", "--text": "#45443d",
        "--muted": "#999487", "--border": "#e6e1d6", "--wrong": "#c77d70",
        "--correct": "#829879",
        "--button-text": "#30352d", name: "LoFi Sage"
    },
    lavender: {
        "--background": "#f2eff8", "--card": "#fffaff", "--sage": "#b7a9d2",
        "--sage-dark": "#8877ad", "--brown": "#625875", "--text": "#484253",
        "--muted": "#958ca4", "--border": "#e4ddec", "--wrong": "#c77d8e",
        "--correct": "#829b91",
        "--button-text": "#332d40", name: "Lavendel"
    },
    ocean: {
        "--background": "#edf4f5", "--card": "#fbffff", "--sage": "#91b8bf",
        "--sage-dark": "#608f98", "--brown": "#49666d", "--text": "#354b50",
        "--muted": "#81969a", "--border": "#d8e6e8", "--wrong": "#c77d70",
        "--correct": "#719b91",
        "--button-text": "#263b40", name: "Ozean"
    },
    rose: {
        "--background": "#f8eeee", "--card": "#fffafa", "--sage": "#d6adb4",
        "--sage-dark": "#ad7f89", "--brown": "#765860", "--text": "#514247",
        "--muted": "#a18e93", "--border": "#eadcdf", "--wrong": "#bd716f",
        "--correct": "#829879",
        "--button-text": "#49363b", name: "Rosé"
    },
    dark: {
        "--background": "#25272b", "--card": "#32363b", "--sage": "#82988b",
        "--sage-dark": "#a2b9aa", "--brown": "#d5cfc3", "--text": "#eeeae2",
        "--muted": "#aaa69e", "--border": "#494d51", "--wrong": "#d58b82",
        "--correct": "#9ab895",
        "--button-text": "#f5f5f2", "--button-bg": "#536d60", "--button-hover": "#40564b", name: "Dunkel"
    },
    forest: {
        "--background": "#edf1e8", "--card": "#fbfff8", "--sage": "#8fa88b",
        "--sage-dark": "#607c60", "--brown": "#455b48", "--text": "#344338",
        "--muted": "#829184", "--border": "#dce5d8", "--wrong": "#c77d70",
        "--correct": "#668d6c",
        "--button-text": "#26372a", name: "Wald"
    },
    peach: {
        "--background": "#fbf0e7", "--card": "#fffaf5", "--sage": "#e5ad8c",
        "--sage-dark": "#bd8061", "--brown": "#805d4b", "--text": "#57463d",
        "--muted": "#a58d80", "--border": "#efdfd2", "--wrong": "#c87975",
        "--correct": "#829879",
        "--button-text": "#493326", name: "Pfirsich"
    },
    matcha: {
        "--background": "#f0f2e5", "--card": "#fcfdf5", "--sage": "#b4bd83",
        "--sage-dark": "#87945b", "--brown": "#626b43", "--text": "#414833",
        "--muted": "#92977b", "--border": "#e1e5cf", "--wrong": "#c77d70",
        "--correct": "#829879",
        "--button-text": "#343b24", name: "Matcha"
    },
    midnight: {
        "--background": "#202638", "--card": "#2c354a", "--sage": "#8295bd",
        "--sage-dark": "#a5b5d7", "--brown": "#d8def0", "--text": "#edf0fa",
        "--muted": "#a3acc2", "--border": "#424d65", "--wrong": "#d58b82",
        "--correct": "#91b89a",
        "--button-text": "#ffffff", "--button-bg": "#26334d", "--button-hover": "#1b263d", name: "Mitternacht"
    },
    midnightPurple: {
        "--background": "#211d35", "--card": "#302a49", "--sage": "#8f80b8",
        "--sage-dark": "#b2a5d2", "--brown": "#e2dcf0", "--text": "#f1edf8",
        "--muted": "#b1a9c2", "--border": "#514967", "--wrong": "#d58b91",
        "--correct": "#91b89a", "--button-text": "#ffffff",
        "--button-bg": "#393052", "--button-hover": "#29223e", name: "Midnight Purple"
    },
    arcticBlue: {
        "--background": "#172b3a", "--card": "#223b4d", "--sage": "#789eb5",
        "--sage-dark": "#a5c4d5", "--brown": "#dceaf0", "--text": "#edf5f8",
        "--muted": "#a9c0cc", "--border": "#3b596b", "--wrong": "#d58b82",
        "--correct": "#8fb8a8", "--button-text": "#ffffff",
        "--button-bg": "#29485b", "--button-hover": "#1d3646", name: "Arctic Blue"
    },
    emerald: {
        "--background": "#19372f", "--card": "#25483d", "--sage": "#78a58b",
        "--sage-dark": "#a2c6ad", "--brown": "#dcebe1", "--text": "#eff7f0",
        "--muted": "#aec4b4", "--border": "#416454", "--wrong": "#d58b82",
        "--correct": "#a6c99d", "--button-text": "#ffffff",
        "--button-bg": "#315b4b", "--button-hover": "#234638", name: "Emerald"
    },
    oceanNight: {
        "--background": "#142c3b", "--card": "#1d3d4c", "--sage": "#438a91",
        "--sage-dark": "#79b6b7", "--brown": "#d2e8e7", "--text": "#edf7f6",
        "--muted": "#a5c4c5", "--border": "#365968", "--wrong": "#d58b82",
        "--correct": "#8fb8a8", "--button-text": "#ffffff",
        "--button-bg": "#1f5060", "--button-hover": "#173d4a", name: "Ocean Night"
    },
    cyberBlue: {
        "--background": "#151d36", "--card": "#202d4d", "--sage": "#526fb5",
        "--sage-dark": "#8299d2", "--brown": "#dce4ff", "--text": "#f0f3ff",
        "--muted": "#aab7dc", "--border": "#3b4b70", "--wrong": "#d58b91",
        "--correct": "#91b89a", "--button-text": "#ffffff",
        "--button-bg": "#293c69", "--button-hover": "#1d2d52", name: "Cyber Blue"
    },
    sakura: {
        "--background": "#f4e5e9", "--card": "#fff8fa", "--sage": "#c995a7",
        "--sage-dark": "#a66f83", "--brown": "#713f50", "--text": "#513943",
        "--muted": "#987b86", "--border": "#e7cbd4", "--wrong": "#bd716f",
        "--correct": "#829879", "--button-text": "#ffffff",
        "--button-bg": "#855a6b", "--button-hover": "#684352", name: "Sakura"
    },
    sunset: {
        "--background": "#f5e2cf", "--card": "#fff9f2", "--sage": "#d99872",
        "--sage-dark": "#b86f51", "--brown": "#80513f", "--text": "#633d32",
        "--muted": "#a68170", "--border": "#ead0bd", "--wrong": "#bd716f",
        "--correct": "#829879", "--button-text": "#ffffff",
        "--button-bg": "#a45f49", "--button-hover": "#824936", name: "Sunset"
    },
    vanilla: {
        "--background": "#f7f0e2", "--card": "#fffdf7", "--sage": "#c9b99f",
        "--sage-dark": "#a18d72", "--brown": "#6b5b49", "--text": "#554b40",
        "--muted": "#978a78", "--border": "#e8dece", "--wrong": "#c77d70",
        "--correct": "#829879", "--button-text": "#ffffff",
        "--button-bg": "#8a7965", "--button-hover": "#6f604f", name: "Vanilla"
    },
};

function isCustomColorsUnlocked() {
    return xp >= CUSTOM_COLORS_UNLOCK_XP || userUnlocks.beta_tester;
}

function updateCustomColorsUnlock() {
    const card = document.getElementById("customColorsCard");
    const message = document.getElementById("customColorsLockMessage");
    const unlocked = isCustomColorsUnlocked();
    if (card) card.classList.toggle("custom-colors-locked", !unlocked);
    document.querySelectorAll("#customColorsCard [data-css-var], #customColorsCard button").forEach(control => {
        control.disabled = !unlocked;
    });
    if (message) message.textContent = unlocked
        ? "Freigeschaltet! Du kannst jetzt alle Farben selbst einstellen."
        : (CUSTOM_COLORS_UNLOCK_XP - xp).toLocaleString("de-DE") + " XP bis zur letzten Belohnung: Eigene Farben einstellen.";
}

function isThemeUnlocked(themeName) {
    const themeNames = Object.keys(colorThemes);
    const themeIndex = themeNames.indexOf(themeName);
    if (themeIndex < 0) return false;
    return themeIndex === 0 || xp >= themeIndex * 250 ||
        userUnlocks.all_designs || userUnlocks.beta_tester;
}

function updateThemeUnlocks() {
    document.querySelectorAll(".theme-option").forEach(button => {
        const themeName = button.dataset.themeChoice;
        const unlocked = isThemeUnlocked(themeName);
        const themeIndex = Object.keys(colorThemes).indexOf(themeName);
        const requiredXP = themeIndex * 250;
        button.disabled = !unlocked;
        button.classList.toggle("theme-locked", !unlocked);
        button.dataset.unlockLabel = unlocked
            ? "Freigeschaltet"
            : requiredXP.toLocaleString("de-DE") + " XP";
        button.setAttribute("aria-label",
            colorThemes[themeName].name + (unlocked ? " – freigeschaltet" : " – benötigt " + requiredXP + " XP"));
    });
}

function saveSelectedTheme(themeName) {
    let saved = false;
    try {
        localStorage.setItem("vocabColorTheme", themeName);
        localStorage.setItem("vocabThemeLastSaved", String(Date.now()));
        saved = localStorage.getItem("vocabColorTheme") === themeName;
    } catch (error) {
        console.error("LocalStorage konnte das Design nicht speichern:", error);
    }
    try {
        document.cookie = "vocabColorTheme=" + encodeURIComponent(themeName) +
            "; max-age=31536000; path=/; SameSite=Lax";
        saved = saved || document.cookie.split("; ").some(part =>
            part === "vocabColorTheme=" + encodeURIComponent(themeName)
        );
    } catch (error) {
        console.error("Cookie konnte das Design nicht speichern:", error);
    }
    return saved;
}

function readSavedTheme() {
    try {
        const stored = localStorage.getItem("vocabColorTheme");
        if (stored) return stored;
    } catch (error) {
        console.error("LocalStorage konnte das Design nicht lesen:", error);
    }
    try {
        const cookie = document.cookie.split("; ").find(part =>
            part.startsWith("vocabColorTheme=")
        );
        if (cookie) return decodeURIComponent(cookie.substring("vocabColorTheme=".length));
    } catch (error) {
        console.error("Cookie konnte das Design nicht lesen:", error);
    }
    return "sage";
}

function setColorTheme(themeName) {
    const theme = colorThemes[themeName];
    if (!theme || !isThemeUnlocked(themeName)) {
        const status = document.getElementById("themeStatus");
        if (status) status.textContent = "Dieses Design wird bei " +
            (Object.keys(colorThemes).indexOf(themeName) * 250).toLocaleString("de-DE") + " XP freigeschaltet.";
        return;
    }

    Object.entries(theme).forEach(([property, value]) => {
        if (property.startsWith("--")) {
            document.documentElement.style.setProperty(property, value);
        }
    });

    // Design in LocalStorage und zusätzlich als Cookie speichern.
    const themeSaved = saveSelectedTheme(themeName);

    document.querySelectorAll(".theme-option").forEach(button => {
        button.classList.toggle("active", button.dataset.themeChoice === themeName);
    });

    const status = document.getElementById("themeStatus");
    if (status) status.textContent = "Aktuelles Design: " + theme.name +
        (themeSaved ? " · gespeichert" : " · Speichern im Browser nicht möglich");
    syncCustomColorInputs();
    renderProfilePage();
}

function updateCustomColor(input) {
    if (!isCustomColorsUnlocked()) { updateCustomColorsUnlock(); return; }
    const property = input.dataset.cssVar;
    if (!property) return;

    document.documentElement.style.setProperty(property, input.value);

    const custom = {};
    document.querySelectorAll("[data-css-var]").forEach(colorInput => {
        custom[colorInput.dataset.cssVar] = colorInput.value;
    });

    try {
        localStorage.setItem("vocabCustomColors", JSON.stringify(custom));
    } catch (error) {
        console.error("Eigene Farben konnten nicht gespeichert werden:", error);
    }
    saveSelectedTheme("custom");

    document.querySelectorAll(".theme-option").forEach(button => button.classList.remove("active"));
    const status = document.getElementById("themeStatus");
    if (status) status.textContent = "Aktuelles Design: Eigene Farben";
}

function resetCustomColors() {
    if (!isCustomColorsUnlocked()) { updateCustomColorsUnlock(); return; }
    try {
        localStorage.removeItem("vocabCustomColors");
    } catch (error) {
        console.error("Eigene Farben konnten nicht zurückgesetzt werden:", error);
    }
    saveSelectedTheme("sage");
    setColorTheme("sage");
    syncCustomColorInputs();
}

function syncCustomColorInputs() {
    document.querySelectorAll("[data-css-var]").forEach(input => {
        const value = getComputedStyle(document.documentElement).getPropertyValue(input.dataset.cssVar).trim();
        if (/^#[0-9a-f]{6}$/i.test(value)) input.value = value;
    });
}

function loadColorTheme() {
    updateThemeUnlocks();
    const savedTheme = readSavedTheme();

    if (savedTheme === "custom" && isCustomColorsUnlocked()) {
        try {
            const custom = JSON.parse(localStorage.getItem("vocabCustomColors") || "{}");
            Object.entries(custom).forEach(([property, value]) => {
                if (/^--[a-z-]+$/.test(property) && /^#[0-9a-f]{6}$/i.test(value)) {
                    document.documentElement.style.setProperty(property, value);
                }
            });
            document.querySelectorAll(".theme-option").forEach(button => button.classList.remove("active"));
            const status = document.getElementById("themeStatus");
            if (status) status.textContent = "Aktuelles Design: Eigene Farben";
            syncCustomColorInputs();
            return;
        } catch (error) {
            console.error("Eigene Farben konnten nicht geladen werden:", error);
        }
    }

    // Beim Laden darf ein gespeichertes Design nicht wegen noch
    // nicht geladener Cloud-XP auf LoFi zurückgesetzt werden.
    const themeToApply = colorThemes[savedTheme] ? savedTheme : "sage";
    const theme = colorThemes[themeToApply];
    Object.entries(theme).forEach(([property, value]) => {
        if (property.startsWith("--")) {
            document.documentElement.style.setProperty(property, value);
        }
    });
    document.querySelectorAll(".theme-option").forEach(button => {
        button.classList.toggle("active", button.dataset.themeChoice === themeToApply);
    });
    const status = document.getElementById("themeStatus");
    if (status) status.textContent = "Aktuelles Design: " + theme.name + " · gespeichert";
    syncCustomColorInputs();
}


/* ==========================================
   WEBSITE STARTEN
========================================== */

document.addEventListener("DOMContentLoaded", async () => {
    loadColorTheme();
    updateStats();
    showWordList();
    showCard();

    if (!supabaseClient) {
        updateAuthPanel();
        setAuthStatus("Cloud-Anmeldung nicht verfügbar. Lokales Lernen funktioniert weiterhin.");
        return;
    }

    try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) throw error;

        currentUser = data.session?.user || null;

        if (currentUser) {
            await loadUserData();
        } else {
            updateAuthPanel();
        }

        supabaseClient.auth.onAuthStateChange((event, session) => {
            const user = session?.user || null;
            if (user?.id !== currentUser?.id) {
                currentUser = user;
                if (currentUser) {
                    setTimeout(() => loadUserData(), 0);
                } else {
                    syncReady = false;
                    updateAuthPanel();
                }
            }
        });
    } catch (error) {
        console.error("Supabase-Initialisierung:", error);
        updateAuthPanel();
        setAuthStatus("Cloud-Verbindung fehlgeschlagen: " + error.message + ". Lokales Lernen funktioniert weiterhin.");
    }
});
