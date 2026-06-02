// ==============================================
// gemini-proxy — Edge Function que esconde la GEMINI_API_KEY
// El navegador NUNCA ve la clave. Esta función:
//   1. Verifica que el pedido venga de un usuario logueado real.
//   2. Aplica CORS (solo orígenes de la lista blanca).
//   3. Agrega la clave de Gemini (secreto del servidor).
//   4. Reenvía el pedido a Google y devuelve la respuesta tal cual.
//
// Es autocontenida: se puede pegar entera en el editor del Dashboard
// de Supabase (Edge Functions → Create function) o desplegar por CLI.
//
// Secretos que usa:  GEMINI_API_KEY, ALLOWED_ORIGINS
// (SUPABASE_URL y SUPABASE_ANON_KEY los inyecta Supabase solo.)
// ==============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---- CORS: solo orígenes de la lista blanca ----
const origenesPermitidos = (Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:8888")
  .split(",").map((o) => o.trim()).filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const permitido = origin && origenesPermitidos.includes(origin)
    ? origin
    : origenesPermitidos[0];
  return {
    "Access-Control-Allow-Origin": permitido,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("Origin"));
  const jsonHeaders = { ...cors, "Content-Type": "application/json" };

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido" }), { status: 405, headers: jsonHeaders });
  }

  // ---- 1. Verificar usuario logueado ----
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Falta autenticación" }), { status: 401, headers: jsonHeaders });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Sesión inválida" }), { status: 401, headers: jsonHeaders });
  }

  // ---- 2. Tomar la clave del servidor ----
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY no configurada en el servidor" }), { status: 500, headers: jsonHeaders });
  }

  // ---- 3. Validar el modelo y reenviar a Google ----
  const model = new URL(req.url).searchParams.get("model") || "gemini-2.5-flash";
  if (!/^[a-zA-Z0-9.\-]+$/.test(model)) {
    return new Response(JSON.stringify({ error: "Modelo inválido" }), { status: 400, headers: jsonHeaders });
  }

  const body = await req.text();
  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body },
  );
  return new Response(await upstream.text(), { status: upstream.status, headers: jsonHeaders });
});
