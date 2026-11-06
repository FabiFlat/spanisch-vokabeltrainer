
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
        translation.textContent = "";
        return;
    }

    currentCard = currentCard % words.length;

    spanishWord.textContent = words[currentCard].spanish;
    translation.textContent = words[currentCard].german;
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

function setColorTheme(themeName) {
    const theme = colorThemes[themeName];
    if (!theme) return;

    Object.entries(theme).forEach(([property, value]) => {
        if (property.startsWith("--")) {
            document.documentElement.style.setProperty(property, value);
        }
    });

    localStorage.setItem("vocabColorTheme", themeName);

    document.querySelectorAll(".theme-option").forEach(button => {
        button.classList.toggle("active", button.dataset.themeChoice === themeName);
    });

    const status = document.getElementById("themeStatus");
    if (status) status.textContent = "Aktuelles Design: " + theme.name;
    syncCustomColorInputs();
}

function updateCustomColor(input) {
    const property = input.dataset.cssVar;
    if (!property) return;

    document.documentElement.style.setProperty(property, input.value);

    const custom = {};
    document.querySelectorAll("[data-css-var]").forEach(colorInput => {
        custom[colorInput.dataset.cssVar] = colorInput.value;
    });

    localStorage.setItem("vocabCustomColors", JSON.stringify(custom));
    localStorage.setItem("vocabColorTheme", "custom");

    document.querySelectorAll(".theme-option").forEach(button => button.classList.remove("active"));
    const status = document.getElementById("themeStatus");
    if (status) status.textContent = "Aktuelles Design: Eigene Farben";
}

function resetCustomColors() {
    localStorage.removeItem("vocabCustomColors");
    localStorage.setItem("vocabColorTheme", "sage");
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
    const savedTheme = localStorage.getItem("vocabColorTheme") || "sage";

    if (savedTheme === "custom") {
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

    setColorTheme(colorThemes[savedTheme] ? savedTheme : "sage");
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
