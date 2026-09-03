-- Tabla de mensajes
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender TEXT NOT NULL CHECK (sender IN ('web', 'whatsapp', 'bot')),
    content TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Políticas de Seguridad (RLS)

-- 1. Permitir inserciones públicas
-- Esto es útil si el webhook de WhatsApp o el chat web sin autenticación 
-- necesitan guardar mensajes directamente en la base de datos.
CREATE POLICY "Permitir inserciones publicas"
ON messages
FOR INSERT
TO public
WITH CHECK (true);

-- 2. Permitir lectura pública (o cambiar a autenticada)
-- Permite que el chat web lea el historial de mensajes. 
-- Si solo los usuarios logueados deberían verlos, cambia "TO public" por "TO authenticated".
CREATE POLICY "Permitir lectura publica"
ON messages
FOR SELECT
TO public
USING (true);
