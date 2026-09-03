require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log("========== PETICIÓN RECIBIDA ==========");
  console.log("METHOD:", req.method);
  console.log("URL:", req.originalUrl);
  console.log("HEADERS:", JSON.stringify(req.headers, null, 2));
  console.log("BODY:", JSON.stringify(req.body, null, 2));
  console.log("=======================================");

  next();
});

// 1. Inicialización del cliente de Supabase
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("[LOG-INIT] Faltan las variables de entorno de Supabase (URL o Key)");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log("[LOG-INIT] Cliente de Supabase inicializado correctamente.");

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// 2. Rutas del Webhook de WhatsApp

// A. Verificación del Webhook (GET)
app.get('/webhook', (req, res) => {
  console.log('\n[LOG-PASO 1] ---> GET /webhook (Verificación de Meta)');
  console.log('[LOG-PASO 1] Headers:', JSON.stringify(req.headers, null, 2));
  console.log('[LOG-PASO 1] Query Params:', JSON.stringify(req.query, null, 2));

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[LOG-PASO 1] WEBHOOK_VERIFICADO exitosamente.');
    res.status(200).send(challenge);
  } else {
    console.log('[LOG-PASO 1] Falló la verificación del webhook. Token incorrecto o mode inválido.');
    res.sendStatus(403);
  }
});

// B. Recepción de mensajes (POST)
app.post('/webhook', async (req, res) => {
  console.log('[LOG-WEBHOOK ENTRANTE] BODY:', JSON.stringify(req.body, null, 2));
  
  // Responder siempre con 200 OK a Meta inmediatamente para confirmar recepción
  // y evitar que Meta reintente el envío del evento.
  res.sendStatus(200);

  console.log('\n[LOG-PASO 2] ---> POST /webhook (Mensaje entrante de Meta)');
  console.log('[LOG-PASO 2] Headers:', JSON.stringify(req.headers, null, 2));

  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    try {
      for (const entry of body.entry) {
        const changes = entry.changes[0].value;
        
        if (changes && changes.messages && changes.messages[0]) {
          const message = changes.messages[0];
          const phoneNumber = message.from; 
          const messageContent = message.text ? message.text.body : 'Mensaje no textual (imagen, audio, etc.)';
          
          console.log(`[LOG-PASO 2] Procesando mensaje de ${phoneNumber}: ${messageContent}`);

          // 3. Guardar el mensaje en Supabase
          console.log(`[LOG-SUPABASE] Guardando mensaje entrante de WhatsApp en la BD...`);
          const { data, error } = await supabase
            .from('messages')
            .insert([
              {
                sender: 'whatsapp',
                content: messageContent,
                phone_number: phoneNumber
              }
            ]);

          if (error) {
            console.error('[LOG-SUPABASE] Error al guardar en Supabase:', error);
          } else {
            console.log('[LOG-SUPABASE] Mensaje guardado correctamente en Supabase. Respuesta:', JSON.stringify(data));
          }
        } else {
          console.log('[LOG-PASO 2] Evento de webhook recibido pero no contiene mensajes de texto. Puede ser un cambio de estado (enviado, entregado, leído).');
        }
      }
    } catch (error) {
      console.error('[LOG-PASO 2] Error en el bloque try/catch procesando el webhook:', error);
    }
  } else {
    console.log('[LOG-PASO 2] El evento no pertenece a whatsapp_business_account. Ignorando.');
  }
});

// 3. Función para enviar mensajes a WhatsApp usando la API de Meta
async function sendMessageToWhatsApp(phoneNumber, content) {
  console.log('\n[LOG-META] ---> Iniciando envío de mensaje a Meta API');
  console.log(`[LOG-META] Destinatario: ${phoneNumber}`);
  console.log(`[LOG-META] Contenido: "${content}"`);

  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
  const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    throw new Error('Faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_ID en las variables de entorno');
  }

  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`;
  
  const payload = {
    messaging_product: 'whatsapp',
    to: phoneNumber,
    type: 'text',
    text: { body: content }
  };

  console.log(`[LOG-META] Endpoint URL: ${url}`);
  console.log(`[LOG-META] Payload que se enviará:`, JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log(`[LOG-META] Respuesta bruta de Meta (Status: ${response.status}):`, JSON.stringify(data, null, 2));

    if (!response.ok) {
      console.error(`[LOG-META] Meta devolvió un error:`, JSON.stringify(data));
      throw new Error(`Error de Meta API: ${JSON.stringify(data)}`);
    }

    console.log('[LOG-META] Mensaje enviado exitosamente a través de Meta.');
    return data;
  } catch (error) {
    console.error('[LOG-META] Excepción al comunicarse con la API de Meta:', error);
    throw error; // Re-lanzamos para que lo capture el endpoint /api/send
  }
}

// 4. Endpoint para enviar mensajes desde la web (POST /api/send)
app.post('/api/send', async (req, res) => {
  console.log('\n[LOG-PASO 3] ---> POST /api/send (Petición desde el chat web)');
  console.log('[LOG-PASO 3] Headers:', JSON.stringify(req.headers, null, 2));
  console.log('[LOG-PASO 3] Body recibido:', JSON.stringify(req.body, null, 2));

  const { phone_number, content } = req.body;

  if (!phone_number || !content) {
    console.error('[LOG-PASO 3] Error: Faltan phone_number o content en el body');
    return res.status(400).json({ error: 'Faltan phone_number o content en el cuerpo de la petición' });
  }

  try {
    // 1. Enviar el mensaje a través de Meta
    await sendMessageToWhatsApp(phone_number, content);

    // 2. Si es exitoso, guardar en Supabase como sender: 'web'
    console.log(`[LOG-SUPABASE] Guardando el mensaje enviado desde la web en la BD...`);
    const { error: dbError, data: dbData } = await supabase
      .from('messages')
      .insert([
        {
          sender: 'web',
          content: content,
          phone_number: phone_number
        }
      ]);

    if (dbError) {
      console.error('[LOG-SUPABASE] Error al guardar el mensaje enviado en Supabase:', dbError);
      return res.status(500).json({ error: 'Mensaje enviado a Meta, pero falló el registro en base de datos.', details: dbError });
    }

    console.log('[LOG-SUPABASE] Mensaje web guardado correctamente en la BD. Respuesta:', JSON.stringify(dbData));
    res.status(200).json({ success: true, message: 'Mensaje enviado y guardado correctamente' });

  } catch (error) {
    console.error('[LOG-PASO 3] Error capturado en el try/catch de /api/send:', error);
    res.status(500).json({ error: error.message || 'Error interno al enviar el mensaje' });
  }
});

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n[LOG-INIT] Servidor backend escuchando en el puerto ${PORT}`);
});
