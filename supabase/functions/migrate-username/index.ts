import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const respond = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return respond({ error: "Bitte zuerst mit deinem bisherigen Konto anmelden." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond({ error: "Die serverseitige Funktion ist noch nicht vollständig eingerichtet." }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return respond({ error: "Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an." }, 401);

  let body: { username?: unknown };
  try {
    body = await req.json();
  } catch {
    return respond({ error: "Ungültige Anfrage." }, 400);
  }

  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!/^[a-z0-9_.-]{3,20}$/.test(username)) {
    return respond({ error: "Der Benutzername muss 3–20 Zeichen lang sein und darf nur Buchstaben, Zahlen, Punkt, _ oder - enthalten." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const currentEmail = userData.user.email || "";
  const alreadyMigrated = currentEmail.endsWith("@accounts.spanisch-vokabeltrainer.invalid");
  if (alreadyMigrated) return respond({ error: "Dieses Konto verwendet bereits einen Benutzernamen." }, 409);

  const metadata = userData.user.user_metadata || {};
  const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
    userData.user.id,
    {
      email: `${username}@accounts.spanisch-vokabeltrainer.invalid`,
      email_confirm: true,
      user_metadata: { ...metadata, username },
    },
  );

  if (updateError) {
    const message = updateError.message.toLowerCase();
    if (message.includes("already") || message.includes("unique") || message.includes("registered")) {
      return respond({ error: "Dieser Benutzername ist bereits vergeben. Bitte wähle einen anderen." }, 409);
    }
    return respond({ error: "Die Umstellung konnte nicht abgeschlossen werden." }, 400);
  }

  return respond({
    success: true,
    username,
    user_id: updated.user.id,
    message: "Dein Konto wurde auf Benutzername und Passwort umgestellt. Deine Lernstände bleiben erhalten.",
  });
});
