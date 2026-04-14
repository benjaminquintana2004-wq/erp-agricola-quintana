-- ==============================================
-- ERP Agrícola Quintana — Schema completo
-- Ejecutar este SQL en Supabase → SQL Editor → New Query → Run
-- ==============================================

-- Activar la extensión UUID para generar IDs únicos
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================
-- FASE 1: Base del sistema
-- ==============================================

-- Usuarios del sistema (vinculados a Supabase Auth)
-- Cada persona que se loguea tiene un registro acá con su rol
CREATE TABLE usuarios (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    nombre TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('admin_total', 'admin', 'empleado')),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Campañas agrícolas (ej: 2024/25, 2025/26)
-- Se crea primero porque contratos y saldos dependen de ella
CREATE TABLE campanas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre TEXT NOT NULL,
    anio_inicio INTEGER NOT NULL,
    anio_fin INTEGER NOT NULL,
    activa BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Arrendadores — los dueños de los campos que Diego alquila
CREATE TABLE arrendadores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre TEXT NOT NULL,
    dni TEXT,
    cuit TEXT,
    domicilio TEXT,
    telefono TEXT,
    email TEXT,
    campo TEXT,
    hectareas NUMERIC(10,2),
    grano TEXT,
    moneda TEXT DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
    umbral_alerta_qq NUMERIC(10,2) DEFAULT 50,
    notas TEXT,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Contratos de arrendamiento
-- Cada contrato vincula un arrendador con una campaña y define los qq pactados
CREATE TABLE contratos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    arrendador_id UUID NOT NULL REFERENCES arrendadores(id) ON DELETE CASCADE,
    campana_id UUID REFERENCES campanas(id),
    fecha_inicio DATE NOT NULL,
    fecha_fin DATE NOT NULL,
    qq_pactados_anual NUMERIC(10,2) NOT NULL,
    tipo TEXT DEFAULT 'arrendamiento',
    pdf_url TEXT,
    estado TEXT DEFAULT 'vigente' CHECK (estado IN ('vigente', 'por_vencer', 'vencido', 'renovado')),
    contrato_anterior_id UUID REFERENCES contratos(id),
    renspa_numero TEXT,
    renspa_vencimiento DATE,
    renspa_estado TEXT DEFAULT 'vigente' CHECK (renspa_estado IN ('vigente', 'por_vencer', 'vencido')),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Fracciones catastrales por contrato
-- Un contrato puede tener múltiples fracciones de campo
CREATE TABLE fracciones_catastrales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contrato_id UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
    denominacion_catastral TEXT,
    nro_cuenta TEXT,
    porcentaje_titularidad NUMERIC(5,2),
    hectareas NUMERIC(10,2),
    lat NUMERIC(10,7),
    lng NUMERIC(10,7),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Cláusulas contractuales relevantes
CREATE TABLE clausulas_contrato (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contrato_id UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('cultivos_permitidos', 'malezas', 'subarrendar', 'inspeccion', 'impuestos', 'otra')),
    descripcion TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Saldos por arrendador y campaña
-- BLANCO y NEGRO siempre separados, nunca se mezclan
CREATE TABLE saldos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    arrendador_id UUID NOT NULL REFERENCES arrendadores(id) ON DELETE CASCADE,
    campana_id UUID NOT NULL REFERENCES campanas(id),
    qq_deuda_blanco NUMERIC(10,2) DEFAULT 0,
    qq_deuda_negro NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(arrendador_id, campana_id)
);

-- Movimientos — cada vez que se venden/entregan quintales a un arrendador
CREATE TABLE movimientos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    arrendador_id UUID NOT NULL REFERENCES arrendadores(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    qq NUMERIC(10,2) NOT NULL,
    precio_quintal NUMERIC(12,2),
    precio_mercado_dia NUMERIC(12,2),
    moneda TEXT DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
    tipo TEXT NOT NULL CHECK (tipo IN ('blanco', 'negro')),
    estado_factura TEXT DEFAULT 'sin_factura' CHECK (estado_factura IN ('sin_factura', 'reclamada', 'factura_ok')),
    pdf_url TEXT,
    punto_venta TEXT,
    nro_comprobante TEXT,
    cae TEXT,
    cae_vencimiento DATE,
    cae_valido BOOLEAN,
    fecha_ultimo_reclamo TIMESTAMPTZ,
    observaciones TEXT,
    usuario_id UUID REFERENCES usuarios(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Alertas de facturas pendientes
CREATE TABLE alertas_factura (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    movimiento_id UUID NOT NULL REFERENCES movimientos(id) ON DELETE CASCADE,
    dias_intervalo INTEGER NOT NULL,
    fecha_disparo DATE NOT NULL,
    reclamada BOOLEAN DEFAULT false,
    fecha_reclamo TIMESTAMPTZ,
    usuario_id UUID REFERENCES usuarios(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================
-- FASE 2: Gestión de producción
-- ==============================================

-- Lotes de campo
CREATE TABLE lotes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre TEXT NOT NULL,
    hectareas NUMERIC(10,2),
    campo TEXT,
    arrendador_id UUID REFERENCES arrendadores(id),
    estado TEXT DEFAULT 'libre' CHECK (estado IN ('libre', 'en_preparacion', 'sembrado', 'cosechado', 'barbecho')),
    lat NUMERIC(10,7),
    lng NUMERIC(10,7),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Asociación lote-campaña (qué se sembró en cada lote cada año)
CREATE TABLE lote_campanas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lote_id UUID NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
    campana_id UUID NOT NULL REFERENCES campanas(id),
    cultivo TEXT,
    variedad TEXT,
    fecha_siembra DATE,
    qq_estimados NUMERIC(10,2),
    qq_reales NUMERIC(10,2),
    cerrada BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(lote_id, campana_id)
);

-- Labores (cuaderno de campo)
CREATE TABLE labores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lote_campana_id UUID NOT NULL REFERENCES lote_campanas(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    tipo TEXT NOT NULL,
    producto TEXT,
    dosis TEXT,
    unidad TEXT,
    costo_total NUMERIC(12,2),
    operario_id UUID,
    maquina_id UUID,
    contratista_id UUID,
    observaciones TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Insumos (semillas, agroquímicos, fertilizantes)
CREATE TABLE insumos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre TEXT NOT NULL,
    tipo TEXT,
    unidad TEXT,
    stock_actual NUMERIC(10,2) DEFAULT 0,
    stock_minimo NUMERIC(10,2) DEFAULT 0,
    costo_promedio NUMERIC(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Movimientos de insumos (entradas y salidas)
CREATE TABLE mov_insumos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    insumo_id UUID NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
    cantidad NUMERIC(10,2) NOT NULL,
    fecha DATE NOT NULL,
    costo_unitario NUMERIC(12,2),
    labor_id UUID REFERENCES labores(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================
-- FASE 2.5: Stock de granos (silobolsas y acopios)
-- ==============================================

-- Silobolsas (almacenamiento propio en campo)
CREATE TABLE silobolsas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lote_id UUID REFERENCES lotes(id),
    campana_id UUID REFERENCES campanas(id),
    grano TEXT NOT NULL,
    fecha_armado DATE NOT NULL,
    qq_iniciales NUMERIC(10,2) NOT NULL,
    qq_actuales NUMERIC(10,2) NOT NULL,
    humedad NUMERIC(5,2),
    proteina NUMERIC(5,2),
    peso_hectolitrico NUMERIC(5,2),
    cuerpos_extranos NUMERIC(5,2),
    estado TEXT DEFAULT 'activa' CHECK (estado IN ('activa', 'en_uso', 'vacia', 'descartada')),
    lat NUMERIC(10,7),
    lng NUMERIC(10,7),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Acopios de terceros
CREATE TABLE acopios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre TEXT NOT NULL,
    ubicacion TEXT,
    contacto TEXT,
    tarifa_qq_mes NUMERIC(8,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Stock depositado en acopios
CREATE TABLE stock_acopio (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    acopio_id UUID NOT NULL REFERENCES acopios(id) ON DELETE CASCADE,
    grano TEXT NOT NULL,
    qq_depositados NUMERIC(10,2) NOT NULL,
    fecha_ingreso DATE NOT NULL,
    costo_acumulado NUMERIC(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Movimientos de stock de granos (entradas y salidas de silobolsas/acopios)
CREATE TABLE mov_stock_granos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
    origen_tipo TEXT CHECK (origen_tipo IN ('cosecha', 'silobolsa', 'acopio')),
    origen_id UUID,
    destino_tipo TEXT CHECK (destino_tipo IN ('silobolsa', 'acopio', 'exportador', 'comprador')),
    destino_id UUID,
    grano TEXT NOT NULL,
    qq NUMERIC(10,2) NOT NULL,
    fecha DATE NOT NULL,
    despacho_id UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================
-- FASE 3: Logística y personal
-- ==============================================

-- Maquinaria propia
CREATE TABLE maquinaria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre TEXT NOT NULL,
    tipo TEXT,
    marca TEXT,
    modelo TEXT,
    anio INTEGER,
    horas_totales NUMERIC(10,1) DEFAULT 0,
    costo_hora NUMERIC(10,2) DEFAULT 0,
    proximo_service_fecha DATE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Mantenimientos de maquinaria
CREATE TABLE mantenimientos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    maquina_id UUID NOT NULL REFERENCES maquinaria(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    tipo TEXT,
    costo NUMERIC(12,2),
    descripcion TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Camiones
CREATE TABLE camiones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empresa TEXT,
    patente TEXT,
    chofer TEXT,
    telefono TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Despachos de granos
CREATE TABLE despachos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha DATE NOT NULL,
    lote_id UUID REFERENCES lotes(id),
    cultivo TEXT,
    qq_netos NUMERIC(10,2) NOT NULL,
    camion_id UUID REFERENCES camiones(id),
    destino TEXT,
    ticket_nro TEXT,
    origen_tipo TEXT CHECK (origen_tipo IN ('silobolsa', 'acopio')),
    origen_id UUID,
    nro_cpe TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Contratistas externos
CREATE TABLE contratistas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre TEXT NOT NULL,
    cuit TEXT,
    telefono TEXT,
    especialidad TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Trabajos de contratistas
CREATE TABLE trabajos_contratistas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contratista_id UUID NOT NULL REFERENCES contratistas(id) ON DELETE CASCADE,
    lote_id UUID REFERENCES lotes(id),
    fecha DATE NOT NULL,
    tarea TEXT,
    precio NUMERIC(12,2),
    unidad TEXT,
    pagado BOOLEAN DEFAULT false,
    fecha_pago DATE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Empleados
CREATE TABLE empleados (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre TEXT NOT NULL,
    dni TEXT,
    cuil TEXT,
    rol TEXT,
    fecha_ingreso DATE,
    telefono TEXT,
    jornal_diario NUMERIC(10,2),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Jornadas de empleados
CREATE TABLE jornadas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    horas NUMERIC(4,1),
    lote_id UUID REFERENCES lotes(id),
    tarea TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ==============================================
-- Agregar foreign keys que no se podían crear antes
-- (porque las tablas no existían todavía)
-- ==============================================

ALTER TABLE labores
    ADD CONSTRAINT fk_labores_maquina FOREIGN KEY (maquina_id) REFERENCES maquinaria(id),
    ADD CONSTRAINT fk_labores_contratista FOREIGN KEY (contratista_id) REFERENCES contratistas(id);

ALTER TABLE mov_stock_granos
    ADD CONSTRAINT fk_mov_stock_despacho FOREIGN KEY (despacho_id) REFERENCES despachos(id);

-- ==============================================
-- Activar Row Level Security en TODAS las tablas
-- RLS = "portero" que verifica permisos antes de cada consulta
-- ==============================================

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE campanas ENABLE ROW LEVEL SECURITY;
ALTER TABLE arrendadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos ENABLE ROW LEVEL SECURITY;
ALTER TABLE fracciones_catastrales ENABLE ROW LEVEL SECURITY;
ALTER TABLE clausulas_contrato ENABLE ROW LEVEL SECURITY;
ALTER TABLE saldos ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE alertas_factura ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE lote_campanas ENABLE ROW LEVEL SECURITY;
ALTER TABLE labores ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE mov_insumos ENABLE ROW LEVEL SECURITY;
ALTER TABLE silobolsas ENABLE ROW LEVEL SECURITY;
ALTER TABLE acopios ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_acopio ENABLE ROW LEVEL SECURITY;
ALTER TABLE mov_stock_granos ENABLE ROW LEVEL SECURITY;
ALTER TABLE maquinaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE mantenimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE camiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE despachos ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratistas ENABLE ROW LEVEL SECURITY;
ALTER TABLE trabajos_contratistas ENABLE ROW LEVEL SECURITY;
ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE jornadas ENABLE ROW LEVEL SECURITY;

-- ==============================================
-- Políticas RLS — quién puede hacer qué
-- ==============================================

-- Función auxiliar: obtiene el rol del usuario actual
CREATE OR REPLACE FUNCTION obtener_rol_usuario()
RETURNS TEXT AS $$
    SELECT rol FROM usuarios WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- ---- LECTURA: los 3 roles pueden leer todas las tablas ----

-- Macro: crear política de lectura para una tabla
-- Todos los usuarios autenticados con registro en 'usuarios' pueden leer
DO $$
DECLARE
    tabla TEXT;
    tablas TEXT[] := ARRAY[
        'usuarios', 'campanas', 'arrendadores', 'contratos',
        'fracciones_catastrales', 'clausulas_contrato', 'saldos',
        'movimientos', 'alertas_factura', 'lotes', 'lote_campanas',
        'labores', 'insumos', 'mov_insumos', 'silobolsas', 'acopios',
        'stock_acopio', 'mov_stock_granos', 'maquinaria', 'mantenimientos',
        'camiones', 'despachos', 'contratistas', 'trabajos_contratistas',
        'empleados', 'jornadas'
    ];
BEGIN
    FOREACH tabla IN ARRAY tablas LOOP
        EXECUTE format(
            'CREATE POLICY "Lectura para usuarios autenticados" ON %I FOR SELECT USING (obtener_rol_usuario() IS NOT NULL)',
            tabla
        );
    END LOOP;
END $$;

-- ---- ESCRITURA: admin_total y admin pueden insertar y actualizar ----

DO $$
DECLARE
    tabla TEXT;
    tablas TEXT[] := ARRAY[
        'campanas', 'arrendadores', 'contratos',
        'fracciones_catastrales', 'clausulas_contrato', 'saldos',
        'movimientos', 'alertas_factura', 'lotes', 'lote_campanas',
        'labores', 'insumos', 'mov_insumos', 'silobolsas', 'acopios',
        'stock_acopio', 'mov_stock_granos', 'maquinaria', 'mantenimientos',
        'camiones', 'despachos', 'contratistas', 'trabajos_contratistas',
        'empleados', 'jornadas'
    ];
BEGIN
    FOREACH tabla IN ARRAY tablas LOOP
        EXECUTE format(
            'CREATE POLICY "Insertar para admin" ON %I FOR INSERT WITH CHECK (obtener_rol_usuario() IN (''admin_total'', ''admin''))',
            tabla
        );
        EXECUTE format(
            'CREATE POLICY "Actualizar para admin" ON %I FOR UPDATE USING (obtener_rol_usuario() IN (''admin_total'', ''admin''))',
            tabla
        );
    END LOOP;
END $$;

-- ---- ELIMINACIÓN: solo admin_total puede eliminar ----

DO $$
DECLARE
    tabla TEXT;
    tablas TEXT[] := ARRAY[
        'campanas', 'arrendadores', 'contratos',
        'fracciones_catastrales', 'clausulas_contrato', 'saldos',
        'movimientos', 'alertas_factura', 'lotes', 'lote_campanas',
        'labores', 'insumos', 'mov_insumos', 'silobolsas', 'acopios',
        'stock_acopio', 'mov_stock_granos', 'maquinaria', 'mantenimientos',
        'camiones', 'despachos', 'contratistas', 'trabajos_contratistas',
        'empleados', 'jornadas'
    ];
BEGIN
    FOREACH tabla IN ARRAY tablas LOOP
        EXECUTE format(
            'CREATE POLICY "Eliminar solo admin_total" ON %I FOR DELETE USING (obtener_rol_usuario() = ''admin_total'')',
            tabla
        );
    END LOOP;
END $$;

-- ---- Tabla usuarios: políticas especiales ----
-- Solo admin_total puede crear/editar/eliminar usuarios
CREATE POLICY "Insertar usuarios solo admin_total" ON usuarios
    FOR INSERT WITH CHECK (obtener_rol_usuario() = 'admin_total');
CREATE POLICY "Actualizar usuarios solo admin_total" ON usuarios
    FOR UPDATE USING (obtener_rol_usuario() = 'admin_total');
CREATE POLICY "Eliminar usuarios solo admin_total" ON usuarios
    FOR DELETE USING (obtener_rol_usuario() = 'admin_total');

-- ==============================================
-- Insertar la primera campaña activa
-- ==============================================

INSERT INTO campanas (nombre, anio_inicio, anio_fin, activa)
VALUES ('2025/26', 2025, 2026, true);
