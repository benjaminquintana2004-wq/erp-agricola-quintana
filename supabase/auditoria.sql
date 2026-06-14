-- ==============================================
-- auditoria.sql — Hallazgo #5: registro de auditoría
-- Crea una tabla "auditoria" y un trigger que registra automáticamente
-- cada INSERT / UPDATE / DELETE sobre las tablas sensibles, guardando
-- QUIÉN lo hizo, QUÉ tabla, QUÉ registro y los DATOS.
--
-- La tabla es "append-only": solo admin_total puede LEERLA, y nadie
-- puede editarla ni borrarla desde la app (no tiene políticas de
-- UPDATE/DELETE). Los registros los inserta el trigger del lado del
-- servidor, no el usuario.
--
-- CÓMO CORRERLO: Supabase → SQL Editor → pegar todo → Run.
-- ==============================================

-- ----------------------------------------------
-- 1. Tabla de auditoría
-- ----------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria (
    id            BIGSERIAL PRIMARY KEY,
    usuario_id    UUID,
    usuario_email TEXT,
    accion        TEXT,                 -- INSERT | UPDATE | DELETE
    tabla         TEXT,
    registro_id   TEXT,
    datos         JSONB,
    creado_en     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_tabla     ON auditoria (tabla, registro_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_creado_en ON auditoria (creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario   ON auditoria (usuario_id);

-- RLS: solo admin_total puede leer; nadie puede editar/borrar desde la app
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Solo admin_total lee auditoria" ON auditoria;
CREATE POLICY "Solo admin_total lee auditoria" ON auditoria
    FOR SELECT USING (obtener_rol_usuario() = 'admin_total');


-- ----------------------------------------------
-- 2. Función que registra cada cambio
-- ----------------------------------------------
CREATE OR REPLACE FUNCTION registrar_auditoria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_registro_id TEXT;
    v_datos       JSONB;
    v_email       TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_datos := to_jsonb(OLD);
    ELSE
        v_datos := to_jsonb(NEW);
    END IF;
    -- Tomar el id desde el JSON (queda NULL si la tabla no tiene columna
    -- "id", como las de vínculo tipo cheques_facturas). Así evitamos el
    -- error 'record "new" has no field "id"' que rompía esos INSERT.
    v_registro_id := v_datos->>'id';

    SELECT email INTO v_email FROM usuarios WHERE id = auth.uid();

    INSERT INTO auditoria (usuario_id, usuario_email, accion, tabla, registro_id, datos)
    VALUES (auth.uid(), v_email, TG_OP, TG_TABLE_NAME, v_registro_id, v_datos);

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;


-- ----------------------------------------------
-- 3. Enganchar el trigger en las tablas sensibles
-- ----------------------------------------------
DO $$
DECLARE
    t TEXT;
    tablas TEXT[] := ARRAY[
        'movimientos', 'movimientos_tesoreria', 'movimientos_banco',
        'contratos', 'saldos', 'facturas', 'cheques_facturas',
        'prestamos', 'cuentas_bancarias', 'arrendadores', 'usuarios'
    ];
BEGIN
    FOREACH t IN ARRAY tablas LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) THEN
            EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria ON %I', t);
            EXECUTE format(
                'CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()',
                t
            );
            RAISE NOTICE 'Auditoría activada en %.', t;
        END IF;
    END LOOP;
END $$;


-- ==============================================
-- CÓMO VER EL REGISTRO (ejemplos para el SQL Editor)
-- ==============================================
-- Últimos 50 movimientos de auditoría:
--   SELECT creado_en, usuario_email, accion, tabla, registro_id
--   FROM auditoria ORDER BY creado_en DESC LIMIT 50;
--
-- Todo lo que tocó un usuario:
--   SELECT * FROM auditoria WHERE usuario_email = 'tal@gmail.com'
--   ORDER BY creado_en DESC;
--
-- Historial de un contrato puntual:
--   SELECT * FROM auditoria WHERE tabla = 'contratos' AND registro_id = 'XXXX'
--   ORDER BY creado_en;
-- ==============================================
