// ============================================================
//  api/webhook.js  —  CONEXIÓN CON WHATSAPP
//
//  Esto es lo que WhatsApp "llama" cuando alguien le escribe al bot.
//  - GET  : Meta lo usa UNA vez para verificar el webhook.
//  - POST : llega cada mensaje del paciente -> cerebro -> responde.
//
//  Variables de entorno (configurar en Vercel):
//    WHATSAPP_TOKEN           -> el token de acceso (EAA...) de Meta
//    WHATSAPP_PHONE_NUMBER_ID -> el Phone Number ID (1161588820372248)
//    WHATSAPP_VERIFY_TOKEN    -> una palabra clave que TÚ inventas
//                                (la misma que pondrás en Meta al configurar)
//    + las del cerebro: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
// ============================================================

import { responder } from "../lib/brain.js";

const GRAPH = "v25.0"; // versión de la Graph API (la que usa tu panel de Meta)

// --- Enviar un mensaje de texto por WhatsApp ----------------
async function enviarWhatsApp(to, texto) {
  const url = `https://graph.facebook.com/${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: texto },
    }),
  });
}

export default async function handler(req, res) {
  // ---- VERIFICACIÓN (GET): Meta confirma que el webhook es tuyo ----
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge); // devolvemos el reto -> verificado
    }
    return res.status(403).send("Token de verificación inválido");
  }

  // ---- MENSAJES ENTRANTES (POST) ----
  if (req.method === "POST") {
    try {
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;
      const mensaje = value?.messages?.[0];

      // Si no es un mensaje de texto (ej: aviso de "entregado", una foto, etc.)
      // respondemos 200 y no hacemos nada. (Las fotos las agregamos después.)
      if (!mensaje || mensaje.type !== "text") {
        return res.status(200).json({ ok: true });
      }

      const from = mensaje.from; // número del paciente
      const texto = mensaje.text?.body || ""; // lo que escribió

      const { respuesta } = await responder(texto);
      await enviarWhatsApp(
        from,
        respuesta || "Disculpa, no te entendí bien 🙂. ¿Me lo repites?"
      );

      return res.status(200).json({ ok: true });
    } catch (err) {
      // Siempre devolvemos 200 para que Meta no reintente en bucle.
      console.error("Error en webhook:", err);
      return res.status(200).json({ ok: true });
    }
  }

  return res.status(405).end();
}
