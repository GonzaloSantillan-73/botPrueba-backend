require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Inicialización del cliente de Supabase
// Usamos las variables de entorno. Nota: si estás usando las NEXT_PUBLIC_, puedes adaptarlas aquí.
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
// Se recomienda usar la Service Role Key para el backend para tener permisos completos, 
// o la Anon Key si las políticas de RLS permiten inserciones públicas.
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Faltan las variables de entorno de Supabase (URL o Key)");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Token de verificación para el Webhook de WhatsApp (Configúralo en tu .env y en el panel de Meta)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// 2. Rutas del Webhook de WhatsApp

// A. Verificación del Webhook (GET)
// Meta enviará una petición GET a esta ruta para verificar el webhook cuando lo configures.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK_VERIFICADO');
    res.status(200).send(challenge);
  } else {
    console.log('Fallo la verificación del webhook. Token incorrecto.');
    res.sendStatus(403);
  }
});

// B. Recepción de mensajes (POST)
// WhatsApp enviará eventos a esta ruta cuando recibas un mensaje.
app.post('/webhook', async (req, res) => {
  const body = req.body;

  // Verificar si es un evento de la API de WhatsApp
  if (body.object === 'whatsapp_business_account') {
    try {
      // Recorremos las entradas para buscar mensajes (pueden venir en lotes)
      for (const entry of body.entry) {
        const changes = entry.changes[0].value;
        
        if (changes && changes.messages && changes.messages[0]) {
          const message = changes.messages[0];
          
          // Extraemos los datos necesarios
          const phoneNumber = message.from; // Número de teléfono del usuario que envió el mensaje
          const messageContent = message.text ? message.text.body : 'Mensaje no textual (imagen, audio, etc.)';
          
          console.log(`Mensaje recibido de ${phoneNumber}: ${messageContent}`);

          // 3. Guardar el mensaje en Supabase
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
            console.error('Error al guardar en Supabase:', error);
          } else {
            console.log('Mensaje guardado correctamente en Supabase.');
          }
        }
      }
      // Responder siempre con 200 OK a Meta para confirmar recepción, 
      // sino Meta reintentará enviar el evento muchas veces.
      res.sendStatus(200);
    } catch (error) {
      console.error('Error procesando el webhook:', error);
      res.sendStatus(500);
    }
  } else {
    // Retornar 404 si el evento no es de WhatsApp API
    res.sendStatus(404);
  }
});

// 3. Función para enviar mensajes a WhatsApp usando la API de Meta
async function sendMessageToWhatsApp(phoneNumber, content) {
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

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Error de Meta API: ${JSON.stringify(data)}`);
  }

  return data;
}

// 4. Endpoint para enviar mensajes desde la web (POST /api/send)
app.post('/api/send', async (req, res) => {
  const { phone_number, content } = req.body;

  if (!phone_number || !content) {
    return res.status(400).json({ error: 'Faltan phone_number o content en el cuerpo de la petición' });
  }

  try {
    // 1. Enviar el mensaje a través de Meta
    await sendMessageToWhatsApp(phone_number, content);

    // 2. Si es exitoso, guardar en Supabase como sender: 'web'
    const { error: dbError } = await supabase
      .from('messages')
      .insert([
        {
          sender: 'web',
          content: content,
          phone_number: phone_number
        }
      ]);

    if (dbError) {
      console.error('Error al guardar el mensaje enviado en Supabase:', dbError);
      return res.status(500).json({ error: 'Mensaje enviado, pero falló el registro en base de datos.' });
    }

    res.status(200).json({ success: true, message: 'Mensaje enviado y guardado correctamente' });
  } catch (error) {
    console.error('Error en /api/send:', error);
    res.status(500).json({ error: error.message || 'Error interno al enviar el mensaje' });
  }
});

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en el puerto ${PORT}`);
});
