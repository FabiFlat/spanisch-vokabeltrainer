
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

let currentUser = null;
let syncReady = false;
let quizTimer = null;
let questionLocked = false;
let quizAnswerLanguage = "de";


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

    updateAuthPanel();
    setAuthStatus("Du wurdest abgemeldet.");
}


/* ==========================================
   SUPABASE SYNCHRONISIERUNG
========================================== */

async function loadUserData() {
    if (!currentUser || !supabaseClient) return;

    syncReady = false;
    setAuthStatus("Deine Vokabeln werden geladen ...");

    const { data, error } = await supabaseClient
        .from("vocab_data")
        .select("words, correct")
        .eq("user_id", currentUser.id)
        .maybeSingle();

    if (error) {
        setAuthStatus("Ladefehler: " + error.message);
        return;
    }

    if (data) {
        words = Array.isArray(data.words)
            ? data.words
            : [...defaultWords];

        correct = Number(data.correct) || 0;

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

    updateStats();
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

    updateStats();
}


/* ==========================================
   LERNKARTEN
========================================== */

function showCard() {
    const spanishWord = document.getElementById("spanishWord");
    const translation = document.getElementById("translation");

    if (words.length === 0) {
        spanishWord.textContent = "Keine Vokabeln vorhanden";
        translation.classList.add("hidden");
        return;
    }

    currentCard = currentCard % words.length;

    spanishWord.textContent = words[currentCard].spanish;
    translation.textContent = words[currentCard].german;

    translation.classList.add("hidden");
}

function revealWord() {
    document.getElementById("translation").classList.remove("hidden");
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

    if (words.length < 2) {
        quizWord.textContent = "Du benötigst mindestens zwei Vokabeln.";
        direction.textContent = "";
        return;
    }

    currentQuestion = Math.floor(Math.random() * words.length);

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
    const multipleChoice = Math.random() < 0.5;

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

    const button = document.createElement("button");
    button.textContent = "Antwort überprüfen";

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
    area.appendChild(button);

    answers.appendChild(area);

    input.focus();
}


/* ==========================================
   ANTWORTEN ÜBERPRÜFEN
========================================== */

function normalizeAnswer(answer) {
    return String(answer)
        .trim()
        .toLocaleLowerCase("de")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[¿?¡!.,;:]/g, "")
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

    if (isCorrect) {
        result.textContent = "Richtig!";
        result.style.color = "#718466";

        correct++;

        saveData();
        updateStats();

        quizTimer = setTimeout(() => {
            const quizPage = document.getElementById("quiz");

            if (
                quizPage &&
                !quizPage.classList.contains("hidden")
            ) {
                nextQuestion();
            }
        }, 700);

    } else {
        result.innerHTML = `
            <div class="wrong-answer">
                <div class="wrong-label">Richtige Antwort:</div>
                <div class="wrong-word">${escapeHTML(correctAnswer)}</div>
            </div>
        `;

        const nextButton = document.createElement("button");

        nextButton.textContent = "Nächste Frage";
        nextButton.className = "next-question-button";

        nextButton.onclick = nextQuestion;

        answers.appendChild(nextButton);
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
   VOKABEL HINZUFÜGEN
========================================== */

function addWord() {
    const spanishInput = document.getElementById("newSpanish");
    const germanInput = document.getElementById("newGerman");

    const spanish = spanishInput.value.trim();
    const german = germanInput.value.trim();

    if (!spanish || !german) {
        alert("Bitte beide Felder ausfüllen.");
        return;
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

    words.forEach((word, index) => {
        const item = document.createElement("div");
        item.className = "word-item";

        const text = document.createElement("span");

        text.textContent =
            word.spanish + " – " + word.german;

        const remove = document.createElement("button");

        remove.textContent = "Löschen";

        remove.onclick = () => {
            words.splice(index, 1);

            saveData();
            showWordList();
            updateStats();

            currentCard = 0;
        };

        item.appendChild(text);
        item.appendChild(remove);

        list.appendChild(item);
    });
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
   WEBSITE STARTEN
========================================== */

document.addEventListener("DOMContentLoaded", async () => {
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
