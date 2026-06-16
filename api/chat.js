// ============================================================
//  api/chat.js  —  ENDPOINT DE PRUEBA (por navegador)
//
//  Sirve para probar el bot sin WhatsApp, escribiendo en la URL:
//    https://TU-PROYECTO.vercel.app/api/chat?msg=cuanto sale el del azucar
//
//  La lógica vive en lib/brain.js (compartida con el webhook).
// ============================================================

import { responder } from "../lib/brain.js";

export default async function handler(req, res) {
  const mensaje =
    (req.method === "POST" ? req.body?.message : req.query?.msg) || "";
  if (!mensaje) {
    return res.status(400).json({ error: "Falta el mensaje. Prueba: ?msg=hola" });
  }
  try {
    const salida = await responder(mensaje);
    return res.status(200).json(salida);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}
