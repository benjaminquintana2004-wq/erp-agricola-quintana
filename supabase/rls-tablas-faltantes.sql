-- ==============================================
-- rls-tablas-faltantes.sql
-- Activa Row Level Security (RLS) + políticas por rol en tablas que
-- el frontend usa pero que se crearon a mano en Supabase y nunca
-- habían quedado documentadas con sus políticas de seguridad:
--   representantes, facturas, cheques_facturas, echecks
--
-- Mismo modelo que el resto del ERP:
--   - LEER:     cualquier usuario con rol asignado (admin_total/admin/empleado)
--   - INSERTAR: admin_total y admin
--   - ACTUALIZAR: admin_total y admin
--   - ELIMINAR: solo admin_total
--
-- Es idempotente: se puede correr varias veces sin romper nada
-- (borra la política si existe y la vuelve a crear).
--
-- CÓMO CORRERLO:
--   Supabase → SQL Editor → pegar todo → Run.
-- ==============================================

DO $$
DECLARE
    tabla TEXT;
    tablas TEXT[] := ARRAY['representantes', 'facturas', 'cheques_facturas', 'echecks'];
BEGIN
    FOREACH tabla IN ARRAY tablas LOOP
        -- Si la tabla no existe, la saltamos sin cortar el script.
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = tabla
        ) THEN
            RAISE NOTICE 'Tabla % no existe, se omite.', tabla;
            CONTINUE;
        END IF;

        -- 1. Activar RLS
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabla);

        -- 2. LECTURA: cualquier usuario con rol
        EXECUTE format('DROP POLICY IF EXISTS "Lectura para usuarios autenticados" ON %I', tabla);
        EXECUTE format(
            'CREATE POLICY "Lectura para usuarios autenticados" ON %I FOR SELECT USING (obtener_rol_usuario() IS NOT NULL)',
            tabla
        );

        -- 3. INSERTAR: admin_total y admin
        EXECUTE format('DROP POLICY IF EXISTS "Insertar para admin" ON %I', tabla);
        EXECUTE format(
            'CREATE POLICY "Insertar para admin" ON %I FOR INSERT WITH CHECK (obtener_rol_usuario() IN (''admin_total'', ''admin''))',
            tabla
        );

        -- 4. ACTUALIZAR: admin_total y admin
        EXECUTE format('DROP POLICY IF EXISTS "Actualizar para admin" ON %I', tabla);
        EXECUTE format(
            'CREATE POLICY "Actualizar para admin" ON %I FOR UPDATE USING (obtener_rol_usuario() IN (''admin_total'', ''admin''))',
            tabla
        );

        -- 5. ELIMINAR: solo admin_total
        EXECUTE format('DROP POLICY IF EXISTS "Eliminar solo admin_total" ON %I', tabla);
        EXECUTE format(
            'CREATE POLICY "Eliminar solo admin_total" ON %I FOR DELETE USING (obtener_rol_usuario() = ''admin_total'')',
            tabla
        );

        RAISE NOTICE 'RLS y políticas aplicadas en %.', tabla;
    END LOOP;
END $$;


-- ==============================================
-- VERIFICACIÓN — correr esto DESPUÉS para confirmar que quedó todo OK.
-- Debería listar TODAS las tablas con rowsecurity = true.
-- Si alguna aparece con rowsecurity = false, esa tabla está desprotegida.
-- ==============================================
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY rowsecurity ASC, tablename;
