// Vokabeln laden
let words = JSON.parse(localStorage.getItem("words")) || [
    { spanish: "Hola", german: "Hallo" },
    { spanish: "Gracias", german: "Danke" },
    { spanish: "Adiós", german: "Tschüss" },
    { spanish: "Buenos días", german: "Guten Morgen" },
    { spanish: "Por favor", german: "Bitte" },
    { spanish: "Agua", german: "Wasser" },
    { spanish: "Casa", german: "Haus" },
    { spanish: "Amigo", german: "Freund" }
];

let currentCard = 0;
let currentQuestion = null;
let correct = Number(localStorage.getItem("correct")) || 0;


// Daten speichern
function saveData() {
    localStorage.setItem("words", JSON.stringify(words));
    localStorage.setItem("correct", correct);
}


// Statistiken aktualisieren
function updateStats() {
    document.getElementById("wordCount").textContent = words.length;
    document.getElementById("correctCount").textContent = correct;
}


// Seiten wechseln
function showPage(page) {
    document.querySelectorAll(".page").forEach(section => {
        section.classList.add("hidden");
    });

    document.getElementById(page).classList.remove("hidden");

    if (page === "cards") showCard();
    if (page === "quiz") nextQuestion();
    if (page === "manage") showWordList();

    updateStats();
}


// Karteikarten
function showCard() {
    if (words.length === 0) {
        document.getElementById("spanishWord").textContent =
            "Keine Vokabeln vorhanden";

        document.getElementById("translation").classList.add("hidden");
        return;
    }

    currentCard = currentCard % words.length;

    document.getElementById("spanishWord").textContent =
        words[currentCard].spanish;

    document.getElementById("translation").textContent =
        words[currentCard].german;

    document.getElementById("translation").classList.add("hidden");
}

function revealWord() {
    document.getElementById("translation").classList.remove("hidden");
}

function nextCard() {
    if (words.length === 0) return;

    currentCard = (currentCard + 1) % words.length;
    showCard();
}


// Vokabeltest

// Vokabeltest
function nextQuestion() {
    const answers = document.getElementById("answers");
    const result = document.getElementById("quizResult");

    answers.innerHTML = "";
    result.textContent = "";

    // Alten Button entfernen
    const oldNextButton = document.getElementById("nextQuestionButton");
    if (oldNextButton) oldNextButton.remove();

    if (words.length < 2) {
        document.getElementById("quizWord").textContent =
            "Du benötigst mindestens zwei Vokabeln.";
        return;
    }

    currentQuestion = Math.floor(Math.random() * words.length);

    const correctAnswer = words[currentQuestion].german;

    document.getElementById("quizWord").textContent =
        words[currentQuestion].spanish;

    let options = [correctAnswer];

    while (options.length < Math.min(4, words.length)) {
        const random = words[Math.floor(Math.random() * words.length)].german;

        if (!options.includes(random)) {
            options.push(random);
        }
    }

    options.sort(() => Math.random() - 0.5);

    options.forEach(option => {
        const button = document.createElement("button");
        button.textContent = option;

        button.onclick = () => {
            // Alle Antwortmöglichkeiten deaktivieren
            answers.querySelectorAll("button").forEach(b => {
                b.disabled = true;
            });

            if (option === correctAnswer) {
                result.textContent = "Richtig!";
                result.style.color = "#718466";

                correct++;
                saveData();
                updateStats();

                // Bei richtiger Antwort automatisch weiter
                setTimeout(() => {
                    nextQuestion();
                }, 1200);

            } else {
                result.innerHTML = `
                    <div class="wrong-answer">
                        <div class="wrong-label">Richtige Antwort:</div>
                        <div class="wrong-word">${correctAnswer}</div>
                    </div>
                `;

                result.style.color = "#514b40";

                // Button zum manuellen Weitergehen
                const nextButton = document.createElement("button");
                nextButton.id = "nextQuestionButton";
                nextButton.textContent = "Nächste Frage";
                nextButton.className = "next-question-button";
                nextButton.onclick = nextQuestion;

                answers.appendChild(nextButton);
            }
        };

        answers.appendChild(button);
    });
}

}


// Manuelle Vokabeleingabe
function addWord() {
    const spanish = document.getElementById("newSpanish").value.trim();
    const german = document.getElementById("newGerman").value.trim();

    if (!spanish || !german) {
        alert("Bitte beide Felder ausfüllen.");
        return;
    }

    words.push({ spanish, german });

    saveData();

    document.getElementById("newSpanish").value = "";
    document.getElementById("newGerman").value = "";

    showWordList();
    updateStats();
}


// Vokabelliste anzeigen
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
        text.textContent = word.spanish + " – " + word.german;

        const remove = document.createElement("button");
        remove.textContent = "Löschen";

        remove.onclick = () => {
            words.splice(index, 1);
            saveData();
            showWordList();
            updateStats();
        };

        item.appendChild(text);
        item.appendChild(remove);
        list.appendChild(item);
    });
}


// FOTO-SCAN MIT TESSERACT.JS
async function scanVocabulary(event) {
    const file = event.target.files[0];

    if (!file) return;

    const status = document.getElementById("scanStatus");
    const editor = document.getElementById("scanEditor");
    const scanText = document.getElementById("scanText");

    editor.classList.add("hidden");
    status.textContent = "Bild wird vorbereitet ...";

    if (!window.Tesseract) {
        status.textContent = "Texterkennung konnte nicht geladen werden. Bitte Internetverbindung prüfen.";
        return;
    }

    try {
        status.textContent = "Vokabelliste wird eingescannt. Bitte warten ...";

        const result = await Tesseract.recognize(
            file,
            "spa+deu",
            {
                logger: message => {
                    if (message.status === "recognizing text") {
                        status.textContent =
                            "Texterkennung: " +
                            Math.round(message.progress * 100) + "%";
                    }
                }
            }
        );

        scanText.value = result.data.text;

        editor.classList.remove("hidden");

        status.textContent =
            "Scan abgeschlossen! Bitte überprüfe die erkannten Wörter.";

    } catch (error) {
        console.error(error);

        status.textContent =
            "Scan fehlgeschlagen. Bitte versuche ein anderes Foto.";
    }

    // Damit dasselbe Foto erneut ausgewählt werden kann
    event.target.value = "";
}


// Erkannte Vokabeln übernehmen
function importScannedWords() {
    const text = document.getElementById("scanText").value;

    if (!text.trim()) {
        alert("Es wurde kein Text erkannt.");
        return;
    }

    const lines = text.split(/\r?\n/);
    let imported = 0;

    lines.forEach(line => {
        line = line.trim();

        if (!line) return;

        // Trenner: =, |, ; oder Tabulator
        const parts = line.split(/\s*(?:=|\||;|\t)\s*/);

        if (parts.length < 2) return;

        const spanish = parts[0].trim();
        const german = parts.slice(1).join(" ").trim();

        if (!spanish || !german) return;

        // Doppelte Vokabeln vermeiden
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


// Beim Öffnen der Website
updateStats();
