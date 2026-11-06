function updateAuthPanel() {
    const loggedIn = Boolean(currentUser);

    const controls = document.getElementById("authControls");
    const panel = document.getElementById("account");
    const signOutButton = document.getElementById("signOutButton");
    const authStatus = document.getElementById("authStatus");

    if (controls) {
        controls.style.display = loggedIn ? "none" : "block";
    }

    if (signOutButton) {
        signOutButton.style.display = loggedIn ? "inline-block" : "none";
    }

    if (panel) {
        panel.classList.toggle("logged-in", loggedIn);
    }

    if (authStatus) {
        authStatus.textContent = loggedIn
            ? "Angemeldet: " + currentUser.email + " – Synchronisierung aktiv."
            : "Du bist nicht angemeldet.";
    }
}
