-- ==============================================
-- endurecimiento-seguridad.sql
-- Aplica los hallazgos #2 y #6 de la auditoría:
--   #2 — Restringir la LECTURA del rol "empleado" a datos operativos.
--        Las tablas sensibles (financieras + PII de arrendamientos)
--        pasan a ser legibles SOLO por admin y admin_total.
--   #6 — Fijar search_path en las funciones SECURITY DEFINER.
--
-- Es idempotente (se puede correr varias veces).
-- No afecta a admin ni admin_total: ellos siguen viendo todo.
-- Solo cambia qué puede LEER un eventual usuario "empleado".
--
-- CÓMO CORRERLO: Supabase → SQL Editor → pegar todo → Run.
-- ==============================================


-- ----------------------------------------------
-- #6 — Endurecer funciones SECURITY DEFINER
-- ----------------------------------------------

-- Función que devuelve el rol del usuario actual
CREATE OR REPLACE FUNCTION obtener_rol_usuario()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT rol FROM usuarios WHERE id = auth.uid();
$$;

-- Función del trigger que registra usuarios nuevos (whitelist por email)
CREATE OR REPLACE FUNCTION registrar_usuario_nuevo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    rol_asignado TEXT;
    nombre_usuario TEXT;
BEGIN
    CASE NEW.email
        WHEN 'elatacosrl2012@gmail.com' THEN
            rol_asignado := 'admin_total';
        WHEN 'benjaminquintana2004@gmail.com' THEN
            rol_asignado := 'admin';
        ELSE
            RETURN NEW;  -- otros emails: sin acceso automático
    END CASE;

    nombre_usuario := COALESCE(
        NEW.raw_user_meta_data ->> 'full_name',
        NEW.raw_user_meta_data ->> 'name',
        NEW.email
    );

    INSERT INTO public.usuarios (id, email, nombre, rol, activo)
    VALUES (NEW.id, NEW.email, nombre_usuario, rol_asignado, true)
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;


-- ----------------------------------------------
-- #2 — Restringir lectura del rol "empleado"
-- Tablas SENSIBLES → solo admin y admin_total pueden LEER.
-- (Las tablas operativas no se tocan: el empleado las sigue viendo.)
-- ----------------------------------------------

DO $$
DECLARE
    t TEXT;
    -- Financieras + PII de arrendamientos. Ajustá esta lista si querés
    -- que el empleado vea (o no) alguna tabla puntual.
    sensibles TEXT[] := ARRAY[
        -- Arrendamientos (PII: CUIT/DNI + deudas en qq)
        'arrendadores', 'contratos', 'contratos_arrendadores', 'representantes',
        'fracciones_catastrales', 'clausulas_contrato', 'saldos', 'alertas_factura',
        -- Tesorería y bancos
        'movimientos', 'movimientos_tesoreria', 'movimientos_banco',
        'cuentas_bancarias', 'saldos_bancarios', 'extractos_bancarios',
        'prestamos', 'cuotas_prestamo', 'beneficiarios', 'empresas',
        'categorias_gasto', 'facturas', 'cheques_facturas',
        -- Sueldos / personal
        'empleados', 'jornadas'
    ];
BEGIN
    FOREACH t IN ARRAY sensibles LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = t
        ) THEN
            RAISE NOTICE 'Tabla % no existe, se omite.', t;
            CONTINUE;
        END IF;

        -- Quitar la política amplia (cualquier rol) y poner la restringida
        EXECUTE format('DROP POLICY IF EXISTS "Lectura para usuarios autenticados" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "Lectura solo admin" ON %I', t);
        EXECUTE format(
            'CREATE POLICY "Lectura solo admin" ON %I FOR SELECT USING (obtener_rol_usuario() IN (''admin_total'', ''admin''))',
            t
        );
        RAISE NOTICE 'Lectura restringida a admin en %.', t;
    END LOOP;
END $$;


-- ----------------------------------------------
-- Tablas OPERATIVAS que el empleado SÍ puede leer (referencia):
--   lotes, lote_campanas, labores, insumos, mov_insumos, silobolsas,
--   acopios, stock_acopio, mov_stock_granos, maquinaria, mantenimientos,
--   camiones, despachos, contratistas, trabajos_contratistas, campanas
-- Estas conservan su política "Lectura para usuarios autenticados".
-- ----------------------------------------------
