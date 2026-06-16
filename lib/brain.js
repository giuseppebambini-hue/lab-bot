// ============================================================
//  lib/brain.js  —  EL CEREBRO DEL BOT (compartido)
//
//  Aquí viven las REGLAS y la lógica. Tanto api/chat.js (prueba por
//  navegador) como api/webhook.js (WhatsApp real) usan este archivo.
//  Si quieres cambiar el comportamiento del bot, lo editas AQUÍ y listo.
//
//  Variables de entorno que usa (configuradas en Vercel):
//    GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
// ============================================================

const MODELO = "gemini-3.5-flash";
const LAB_ID = "11111111-1111-1111-1111-111111111111";

// --- Reglas del bot (system prompt) -------------------------
export const REGLAS = `
Eres el asistente de WhatsApp del Laboratorio Especializado Jacinto Convit,
en Pedraza, estado Barinas. Atiendes pacientes que preguntan por exámenes:
precios, preparación, horarios, dirección y formas de pago.

PERSONALIDAD: recepcionista venezolana, cálida y profesional. Tuteas, hablas
criollo natural, sin sonar robot. Respuestas CORTAS (es WhatsApp). Máximo un
emoji y solo si suma.

TU TRABAJO: el paciente no usa nombres técnicos. Tradúcelo:
"el del azúcar"->glicemia, "el de la próstata"->PSA, "tiroides"->TSH/T3/T4,
"el del riñón"->urea/creatinina/urocultivo, "fertilidad masculina"->espermograma.

REGLAS DE ORO (innegociables):
1. PRECIOS: solo das precios que aparezcan en "EXÁMENES ENCONTRADOS". Si no
   aparece, NO inventes: di que no lo ves en la lista y ofrece confirmarlo con
   el personal. Los precios son en DÓLARES (USD).
2. NADA DE MEDICINA: no interpretas resultados, no diagnosticas, no opinas si
   algo "está mal", no recomiendas exámenes para síntomas. Si lo piden, dilo
   con cariño y deriva al médico o al personal del lab.
3. NO INVENTES DATOS: si un horario o preparación no está en los datos de
   abajo, di "déjame confirmártelo con el personal", no te lo inventes.
4. CITAS: aún no puedes agendar. Di que el personal lo contacta para coordinar.
`.trim();

// --- Llamar a Gemini ----------------------------------------
export async function gemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  const data = await r.json();
  return (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("");
}

// --- Buscar examen en Supabase (función buscar_examen) ------
export async function buscarExamen(termino) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/buscar_examen`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ termino }),
  });
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}

// --- Traer datos del laboratorio ----------------------------
export async function getLab() {
  const r = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/labs?id=eq.${LAB_ID}&select=*`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  const rows = await r.json();
  return (Array.isArray(rows) && rows[0]) || {};
}

// --- EL CEREBRO: mensaje del paciente -> respuesta del bot ---
export async function responder(mensaje) {
  // PASO 1 — interpretar: ¿qué exámenes pide? (devuelve JSON)
  const promptInterpretar = `${REGLAS}

Mensaje del paciente: "${mensaje}"

Devuelve SOLO un JSON (sin texto extra, sin markdown) con los nombres técnicos
de exámenes que el paciente podría estar pidiendo, traduciendo el lenguaje
común al técnico. Si no pide ningún examen, devuelve lista vacía.
Formato exacto: {"terminos": ["glicemia", "psa"]}`;

  let terminos = [];
  try {
    const raw = (await gemini(promptInterpretar))
      .replace(/```json|```/g, "")
      .trim();
    terminos = JSON.parse(raw).terminos || [];
  } catch (e) {
    terminos = [];
  }

  // PASO 2 — buscar precios reales en Supabase
  let resultados = [];
  for (const t of terminos) {
    resultados.push(...(await buscarExamen(t)));
  }
  const vistos = new Set();
  resultados = resultados.filter((r) => {
    if (vistos.has(r.nombre)) return false;
    vistos.add(r.nombre);
    return true;
  });

  // datos del lab + resultados, listos para inyectar
  const lab = await getLab();
  const ctxLab = `Nombre: ${lab.nombre || ""}
Dirección: ${lab.direccion || "(no registrada)"}
Horario: ${lab.horario || "(no registrado)"}
Teléfono: ${lab.telefono || "(no registrado)"}
Métodos de pago: ${lab.metodos_pago || "(no registrados)"}`;

  const ctxResultados = resultados.length
    ? resultados
        .map(
          (r) =>
            `- ${r.nombre} | $${r.precio_usd} | preparación: ${
              r.preparacion || "(no registrada)"
            }`
        )
        .join("\n")
    : "(ninguno)";

  // PASO 3 — redactar la respuesta
  const promptResponder = `${REGLAS}

=== DATOS DEL LABORATORIO ===
${ctxLab}

=== EXÁMENES ENCONTRADOS EN LA BASE DE DATOS ===
${ctxResultados}

Mensaje del paciente: "${mensaje}"

Responde como el asistente, siguiendo TODAS las reglas. Usa SOLO los datos de
arriba. No inventes precios ni preparación.`;

  const respuesta = await gemini(promptResponder);

  return {
    respuesta,
    debug: { terminos, examenes_encontrados: resultados.length },
  };
}
