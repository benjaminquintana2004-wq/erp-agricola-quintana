-- ==============================================
-- Módulo Tesorería — ERP Agrícola Quintana
-- Ejecutar en Supabase → SQL Editor → New Query → Run
--
-- PREREQUISITO: el schema.sql principal ya fue ejecutado.
-- Este archivo asume que existen las tablas: arrendadores, contratos,
-- la extensión uuid-ossp y la función obtener_rol_usuario().
-- ==============================================


-- ==============================================
-- TABLAS
-- ==============================================

-- Empresas (Diego Quintana persona física + El Ataco SRL)
CREATE TABLE empresas (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre      TEXT NOT NULL,
    cuit        TEXT,
    tipo        TEXT CHECK (tipo IN ('persona_fisica', 'srl')),
    creado_en   TIMESTAMPTZ DEFAULT NOW()
);

-- Cuentas bancarias — una por empresa y moneda
-- Galicia tiene cuenta ARS y puede tener cuenta USD
CREATE TABLE cuentas_bancarias (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
    banco           TEXT NOT NULL DEFAULT 'Galicia',
    numero_cuenta   TEXT,
    moneda          TEXT NOT NULL CHECK (moneda IN ('ARS', 'USD')),
    alias           TEXT,
    activa          BOOLEAN DEFAULT TRUE,
    creado_en       TIMESTAMPTZ DEFAULT NOW()
);

-- Categorías de gasto (flete, fumigación, siembra, arrendamiento, etc.)
CREATE TABLE categorias_gasto (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre      TEXT UNIQUE NOT NULL,
    descripcion TEXT,
    activa      BOOLEAN DEFAULT TRUE
);

-- Beneficiarios — a quién se le paga
-- Puede estar vinculado a un arrendador existente del módulo de arrendamientos
CREATE TABLE beneficiarios (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre                TEXT NOT NULL,
    cuit                  TEXT,
    categoria_default_id  UUID REFERENCES categorias_gasto(id) ON DELETE SET NULL,
    arrendador_id         UUID REFERENCES arrendadores(id) ON DELETE SET NULL,
    notas                 TEXT,
    creado_en             TIMESTAMPTZ DEFAULT NOW()
);

-- Movimientos de tesorería — cheques Y transferencias a arrendadores
-- REGLA: cheques siempre en ARS. Transferencias siempre en ARS.
-- Las transferencias se crean automáticamente desde el módulo de arrendamientos.
CREATE TABLE movimientos_tesoreria (
    id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id                UUID NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
    cuenta_bancaria_id        UUID NOT NULL REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT,

    tipo                      TEXT NOT NULL CHECK (tipo IN ('cheque', 'transferencia')),

    -- Solo para cheques: el número es obligatorio
    numero_cheque             TEXT,

    fecha_emision             DATE NOT NULL,
    fecha_cobro               DATE NOT NULL,
    -- fecha_balde se calcula automáticamente por trigger (no cargar manualmente)
    fecha_balde               DATE NOT NULL,

    beneficiario_id           UUID REFERENCES beneficiarios(id) ON DELETE RESTRICT,
    categoria_id              UUID REFERENCES categorias_gasto(id) ON DELETE SET NULL,

    -- Siempre en pesos argentinos (ARS). No existe cheque en USD.
    monto                     NUMERIC(15,2) NOT NULL CHECK (monto > 0),

    estado                    TEXT NOT NULL DEFAULT 'pendiente'
                                CHECK (estado IN ('pendiente', 'cobrado', 'anulado')),
    fecha_cobrado_real        DATE,

    -- Solo para transferencias generadas desde el módulo de arrendamientos
    movimiento_arrendamiento_id UUID REFERENCES movimientos(id) ON DELETE SET NULL,

    -- De dónde viene este registro
    origen                    TEXT CHECK (origen IN ('manual', 'auto_arrendamiento', 'import_banco')),

    foto_url                  TEXT,
    notas                     TEXT,

    cargado_por               UUID REFERENCES auth.users(id),
    cargado_en                TIMESTAMPTZ DEFAULT NOW(),
    actualizado_en            TIMESTAMPTZ DEFAULT NOW(),

    -- Evitar cheques duplicados: mismo número en la misma cuenta
    CONSTRAINT cheque_numero_unico UNIQUE NULLS NOT DISTINCT (cuenta_bancaria_id, numero_cheque),
    -- Cheque siempre tiene número
    CONSTRAINT cheque_requiere_numero CHECK (
        tipo = 'transferencia' OR (tipo = 'cheque' AND numero_cheque IS NOT NULL)
    )
);

-- Índices para búsquedas frecuentes
CREATE INDEX idx_mov_tesoreria_balde       ON movimientos_tesoreria(fecha_balde, empresa_id, estado);
CREATE INDEX idx_mov_tesoreria_empresa     ON movimientos_tesoreria(empresa_id, estado);
CREATE INDEX idx_mov_tesoreria_estado      ON movimientos_tesoreria(estado);
CREATE INDEX idx_mov_tesoreria_beneficiario ON movimientos_tesoreria(beneficiario_id);

-- Préstamos bancarios (ARS o USD — se cargan manualmente)
CREATE TABLE prestamos (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa_id          UUID NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
    cuenta_bancaria_id  UUID REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT,
    acreedor            TEXT NOT NULL,   -- Ej: "Banco Galicia", "Banco Nación"
    monto_total         NUMERIC(15,2) NOT NULL CHECK (monto_total > 0),
    moneda              TEXT NOT NULL CHECK (moneda IN ('ARS', 'USD')),
    fecha_otorgamiento  DATE NOT NULL,
    cantidad_cuotas     INT NOT NULL DEFAULT 1 CHECK (cantidad_cuotas >= 1),
    tasa_interes        NUMERIC(6,4),    -- Tasa anual. Ej: 0.4500 = 45%
    notas               TEXT,
    estado              TEXT NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente', 'cancelado')),
    cargado_por         UUID REFERENCES auth.users(id),
    cargado_en          TIMESTAMPTZ DEFAULT NOW()
);

-- Cuotas individuales de cada préstamo
-- Se generan automáticamente al crear el préstamo
CREATE TABLE cuotas_prestamo (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prestamo_id         UUID NOT NULL REFERENCES prestamos(id) ON DELETE CASCADE,
    numero_cuota        INT NOT NULL CHECK (numero_cuota >= 1),
    fecha_vencimiento   DATE NOT NULL,
    -- fecha_balde se calcula automáticamente por trigger
    fecha_balde         DATE NOT NULL,
    monto_capital       NUMERIC(15,2) NOT NULL,
    monto_interes       NUMERIC(15,2) NOT NULL DEFAULT 0,
    monto_total         NUMERIC(15,2) NOT NULL,
    moneda              TEXT NOT NULL CHECK (moneda IN ('ARS', 'USD')),
    estado              TEXT NOT NULL DEFAULT 'pendiente'
                            CHECK (estado IN ('pendiente', 'pagada', 'vencida')),
    fecha_pago_real     DATE,
    notas               TEXT,
    UNIQUE(prestamo_id, numero_cuota)
);

CREATE INDEX idx_cuotas_balde ON cuotas_prestamo(fecha_balde, estado);

-- Saldos bancarios diarios
-- Vale carga el saldo del banco cada día (o se extrae del PDF)
CREATE TABLE saldos_bancarios (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cuenta_bancaria_id  UUID NOT NULL REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT,
    fecha               DATE NOT NULL,
    saldo               NUMERIC(15,2) NOT NULL,
    origen              TEXT DEFAULT 'manual' CHECK (origen IN ('manual', 'pdf_extracto', 'xls_extracto')),
    cargado_por         UUID REFERENCES auth.users(id),
    cargado_en          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cuenta_bancaria_id, fecha)
);

-- Extractos bancarios subidos (para conciliación con Gemini)
CREATE TABLE extractos_bancarios (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cuenta_bancaria_id       UUID NOT NULL REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT,
    fecha_desde              DATE,
    fecha_hasta              DATE,
    archivo_url              TEXT NOT NULL,
    tipo_archivo             TEXT CHECK (tipo_archivo IN ('pdf', 'xls', 'csv')),
    estado_procesamiento     TEXT DEFAULT 'pendiente'
                                 CHECK (estado_procesamiento IN ('pendiente', 'procesando', 'procesado', 'error')),
    movimientos_detectados   JSONB,
    movimientos_conciliados  INT DEFAULT 0,
    movimientos_excepciones  INT DEFAULT 0,
    error_mensaje            TEXT,
    subido_por               UUID REFERENCES auth.users(id),
    subido_en                TIMESTAMPTZ DEFAULT NOW()
);

-- Líneas del extracto parseadas por Gemini (una por movimiento bancario)
CREATE TABLE movimientos_banco (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    extracto_id                 UUID REFERENCES extractos_bancarios(id) ON DELETE CASCADE,
    cuenta_bancaria_id          UUID NOT NULL REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT,
    fecha                       DATE NOT NULL,
    descripcion                 TEXT,
    numero_cheque               TEXT,
    monto                       NUMERIC(15,2) NOT NULL,
    tipo                        TEXT CHECK (tipo IN ('debito', 'credito')),
    movimiento_tesoreria_id     UUID REFERENCES movimientos_tesoreria(id) ON DELETE SET NULL,
    estado_conciliacion         TEXT DEFAULT 'no_conciliado'
                                    CHECK (estado_conciliacion IN (
                                        'no_conciliado', 'conciliado_auto',
                                        'conciliado_manual', 'excepcion'
                                    ))
);


-- ==============================================
-- FUNCIÓN: calcular_fecha_balde
-- Dado cualquier fecha, devuelve la fecha terminada
-- en 0 o 5 más cercana hacia atrás.
-- Ejemplos:
--   07/04 → 05/04  (07 % 5 = 2, resta 2 días)
--   02/04 → 30/03  (02 % 5 = 2, resta 2 días → cruza al mes anterior)
--   10/04 → 10/04  (10 % 5 = 0, queda igual)
--   15/04 → 15/04  (15 % 5 = 0, queda igual)
--   31/03 → 30/03  (31 % 5 = 1, resta 1 día)
-- ==============================================

CREATE OR REPLACE FUNCTION calcular_fecha_balde(fecha_input DATE)
RETURNS DATE AS $$
DECLARE
    dia         INT;
    offset_dias INT;
BEGIN
    dia         := EXTRACT(DAY FROM fecha_input)::INT;
    offset_dias := dia % 5;
    RETURN fecha_input - (offset_dias || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ==============================================
-- TRIGGERS: setear fecha_balde automáticamente
-- ==============================================

-- Trigger para movimientos_tesoreria
CREATE OR REPLACE FUNCTION set_fecha_balde_movimiento()
RETURNS TRIGGER AS $$
BEGIN
    NEW.fecha_balde    := calcular_fecha_balde(NEW.fecha_cobro);
    NEW.actualizado_en := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fecha_balde_movimiento
BEFORE INSERT OR UPDATE OF fecha_cobro
ON movimientos_tesoreria
FOR EACH ROW EXECUTE FUNCTION set_fecha_balde_movimiento();

-- Trigger para cuotas_prestamo
CREATE OR REPLACE FUNCTION set_fecha_balde_cuota()
RETURNS TRIGGER AS $$
BEGIN
    NEW.fecha_balde := calcular_fecha_balde(NEW.fecha_vencimiento);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fecha_balde_cuota
BEFORE INSERT OR UPDATE OF fecha_vencimiento
ON cuotas_prestamo
FOR EACH ROW EXECUTE FUNCTION set_fecha_balde_cuota();


-- ==============================================
-- VISTAS
-- ==============================================

-- Vista unificada de todos los egresos pendientes
-- Combina cheques + transferencias + cuotas de préstamos
CREATE OR REPLACE VIEW vista_egresos_pendientes AS

-- Cheques y transferencias (siempre ARS)
SELECT
    mt.empresa_id,
    'ARS'                   AS moneda,
    mt.fecha_balde,
    mt.tipo                 AS tipo_egreso,
    mt.monto,
    mt.id                   AS referencia_id,
    'movimiento'            AS tabla_origen,
    mt.beneficiario_id,
    b.nombre                AS beneficiario_nombre
FROM movimientos_tesoreria mt
LEFT JOIN beneficiarios b ON b.id = mt.beneficiario_id
WHERE mt.estado = 'pendiente'

UNION ALL

-- Cuotas de préstamos (ARS o USD — separadas)
SELECT
    p.empresa_id,
    cp.moneda,
    cp.fecha_balde,
    'cuota_prestamo'        AS tipo_egreso,
    cp.monto_total          AS monto,
    cp.id                   AS referencia_id,
    'cuota'                 AS tabla_origen,
    NULL                    AS beneficiario_id,
    p.acreedor              AS beneficiario_nombre
FROM cuotas_prestamo cp
JOIN prestamos p ON p.id = cp.prestamo_id
WHERE cp.estado = 'pendiente'
  AND p.estado  = 'vigente';


-- Vista resumida por balde — para el dashboard y el timeline
CREATE OR REPLACE VIEW vista_saldo_proyectado AS
SELECT
    empresa_id,
    moneda,
    fecha_balde,
    SUM(monto)                                              AS total_pendiente,
    COUNT(*)                                                AS cantidad_egresos,
    COUNT(*) FILTER (WHERE tipo_egreso = 'cheque')          AS cantidad_cheques,
    COUNT(*) FILTER (WHERE tipo_egreso = 'transferencia')   AS cantidad_transferencias,
    COUNT(*) FILTER (WHERE tipo_egreso = 'cuota_prestamo')  AS cantidad_cuotas
FROM vista_egresos_pendientes
GROUP BY empresa_id, moneda, fecha_balde
ORDER BY moneda, fecha_balde;


-- ==============================================
-- ROW LEVEL SECURITY
-- ==============================================

ALTER TABLE empresas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuentas_bancarias       ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias_gasto        ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficiarios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_tesoreria   ENABLE ROW LEVEL SECURITY;
ALTER TABLE prestamos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE cuotas_prestamo         ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldos_bancarios        ENABLE ROW LEVEL SECURITY;
ALTER TABLE extractos_bancarios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_banco       ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier usuario autenticado con rol registrado
CREATE POLICY "Lectura empresas"              ON empresas              FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);
CREATE POLICY "Lectura cuentas_bancarias"     ON cuentas_bancarias     FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);
CREATE POLICY "Lectura categorias_gasto"      ON categorias_gasto      FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);
CREATE POLICY "Lectura beneficiarios"         ON beneficiarios         FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);
CREATE POLICY "Lectura movimientos_tesoreria" ON movimientos_tesoreria FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);
CREATE POLICY "Lectura prestamos"             ON prestamos             FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);
CREATE POLICY "Lectura cuotas_prestamo"       ON cuotas_prestamo       FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);
CREATE POLICY "Lectura saldos_bancarios"      ON saldos_bancarios      FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);
CREATE POLICY "Lectura extractos_bancarios"   ON extractos_bancarios   FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);
CREATE POLICY "Lectura movimientos_banco"     ON movimientos_banco     FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);

-- Insertar y actualizar: admin_total y admin
CREATE POLICY "Insertar empresas"              ON empresas              FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Insertar cuentas_bancarias"     ON cuentas_bancarias     FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Insertar categorias_gasto"      ON categorias_gasto      FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Insertar beneficiarios"         ON beneficiarios         FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Insertar movimientos_tesoreria" ON movimientos_tesoreria FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Insertar prestamos"             ON prestamos             FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Insertar cuotas_prestamo"       ON cuotas_prestamo       FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Insertar saldos_bancarios"      ON saldos_bancarios      FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Insertar extractos_bancarios"   ON extractos_bancarios   FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Insertar movimientos_banco"     ON movimientos_banco     FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));

CREATE POLICY "Actualizar empresas"              ON empresas              FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Actualizar cuentas_bancarias"     ON cuentas_bancarias     FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Actualizar categorias_gasto"      ON categorias_gasto      FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Actualizar beneficiarios"         ON beneficiarios         FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Actualizar movimientos_tesoreria" ON movimientos_tesoreria FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Actualizar prestamos"             ON prestamos             FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Actualizar cuotas_prestamo"       ON cuotas_prestamo       FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Actualizar saldos_bancarios"      ON saldos_bancarios      FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Actualizar extractos_bancarios"   ON extractos_bancarios   FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY "Actualizar movimientos_banco"     ON movimientos_banco     FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));

-- Eliminar: solo admin_total
CREATE POLICY "Eliminar empresas"              ON empresas              FOR DELETE USING (obtener_rol_usuario() = 'admin_total');
CREATE POLICY "Eliminar cuentas_bancarias"     ON cuentas_bancarias     FOR DELETE USING (obtener_rol_usuario() = 'admin_total');
CREATE POLICY "Eliminar categorias_gasto"      ON categorias_gasto      FOR DELETE USING (obtener_rol_usuario() = 'admin_total');
CREATE POLICY "Eliminar beneficiarios"         ON beneficiarios         FOR DELETE USING (obtener_rol_usuario() = 'admin_total');
CREATE POLICY "Eliminar movimientos_tesoreria" ON movimientos_tesoreria FOR DELETE USING (obtener_rol_usuario() = 'admin_total');
CREATE POLICY "Eliminar prestamos"             ON prestamos             FOR DELETE USING (obtener_rol_usuario() = 'admin_total');
CREATE POLICY "Eliminar cuotas_prestamo"       ON cuotas_prestamo       FOR DELETE USING (obtener_rol_usuario() = 'admin_total');
CREATE POLICY "Eliminar saldos_bancarios"      ON saldos_bancarios      FOR DELETE USING (obtener_rol_usuario() = 'admin_total');
CREATE POLICY "Eliminar extractos_bancarios"   ON extractos_bancarios   FOR DELETE USING (obtener_rol_usuario() = 'admin_total');
CREATE POLICY "Eliminar movimientos_banco"     ON movimientos_banco     FOR DELETE USING (obtener_rol_usuario() = 'admin_total');


-- ==============================================
-- DATOS INICIALES (seed)
-- ==============================================

-- Las dos empresas de Diego
INSERT INTO empresas (nombre, cuit, tipo) VALUES
    ('Diego Ricardo Quintana',  '20-20649478-7', 'persona_fisica'),
    ('El Ataco SRL',             NULL,            'srl');

-- Cuentas bancarias ARS (las cuentas corrientes del Galicia)
-- Reemplazar los números de cuenta con los reales de Diego
INSERT INTO cuentas_bancarias (empresa_id, banco, numero_cuenta, moneda, alias, activa)
SELECT id, 'Galicia', NULL, 'ARS', 'Galicia ARS', true
FROM empresas
WHERE nombre = 'Diego Ricardo Quintana';

INSERT INTO cuentas_bancarias (empresa_id, banco, numero_cuenta, moneda, alias, activa)
SELECT id, 'Galicia', NULL, 'ARS', 'Galicia ARS', true
FROM empresas
WHERE nombre = 'El Ataco SRL';

-- Categorías de gasto más comunes en la actividad agrícola
INSERT INTO categorias_gasto (nombre, descripcion) VALUES
    ('Arrendamiento',    'Pago de alquileres a arrendadores'),
    ('Flete',            'Transporte de granos y materiales'),
    ('Fumigación',       'Aplicación de agroquímicos'),
    ('Siembra',          'Servicio de siembra contratado'),
    ('Cosecha',          'Servicio de cosecha contratado'),
    ('Fertilizante',     'Compra de fertilizantes'),
    ('Semilla',          'Compra de semillas'),
    ('Combustible',      'Gasoil, nafta y lubricantes'),
    ('Insumos varios',   'Otros insumos agrícolas'),
    ('Maquinaria',       'Mantenimiento y repuestos de maquinaria'),
    ('Personal',         'Sueldos y jornales de empleados'),
    ('Impuestos',        'Inmobiliario, ABL, Bienes Personales y otros'),
    ('Gastos bancarios', 'Comisiones, mantenimiento de cuenta'),
    ('Otros',            'Gastos varios no categorizados');
