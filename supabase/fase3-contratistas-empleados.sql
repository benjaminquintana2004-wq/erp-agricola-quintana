-- ==============================================
-- Fase 3: Contratistas + Empleados
-- Ejecutar SOLO si estas tablas no existen todavía en Supabase.
-- Si ya ejecutaste el schema.sql completo, NO necesitás correr esto.
-- ==============================================

-- Contratistas externos
CREATE TABLE IF NOT EXISTS contratistas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre TEXT NOT NULL,
    cuit TEXT,
    telefono TEXT,
    especialidad TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Trabajos de contratistas
CREATE TABLE IF NOT EXISTS trabajos_contratistas (
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
CREATE TABLE IF NOT EXISTS empleados (
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
CREATE TABLE IF NOT EXISTS jornadas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    empleado_id UUID NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
    fecha DATE NOT NULL,
    horas NUMERIC(4,1),
    lote_id UUID REFERENCES lotes(id),
    tarea TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Activar RLS
ALTER TABLE contratistas ENABLE ROW LEVEL SECURITY;
ALTER TABLE trabajos_contratistas ENABLE ROW LEVEL SECURITY;
ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE jornadas ENABLE ROW LEVEL SECURITY;

-- Políticas de lectura
CREATE POLICY IF NOT EXISTS "Lectura contratistas" ON contratistas FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);
CREATE POLICY IF NOT EXISTS "Lectura trabajos_contratistas" ON trabajos_contratistas FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);
CREATE POLICY IF NOT EXISTS "Lectura empleados" ON empleados FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);
CREATE POLICY IF NOT EXISTS "Lectura jornadas" ON jornadas FOR SELECT USING (obtener_rol_usuario() IS NOT NULL);

-- Políticas de escritura (admin_total y admin)
CREATE POLICY IF NOT EXISTS "Insertar contratistas" ON contratistas FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY IF NOT EXISTS "Insertar trabajos_contratistas" ON trabajos_contratistas FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY IF NOT EXISTS "Insertar empleados" ON empleados FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY IF NOT EXISTS "Insertar jornadas" ON jornadas FOR INSERT WITH CHECK (obtener_rol_usuario() IN ('admin_total', 'admin'));

CREATE POLICY IF NOT EXISTS "Actualizar contratistas" ON contratistas FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY IF NOT EXISTS "Actualizar trabajos_contratistas" ON trabajos_contratistas FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY IF NOT EXISTS "Actualizar empleados" ON empleados FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));
CREATE POLICY IF NOT EXISTS "Actualizar jornadas" ON jornadas FOR UPDATE USING (obtener_rol_usuario() IN ('admin_total', 'admin'));

-- Políticas de eliminación (solo admin_total)
CREATE POLICY IF NOT EXISTS "Eliminar contratistas" ON contratistas FOR DELETE USING (obtener_rol_usuario() = 'admin_total');
CREATE POLICY IF NOT EXISTS "Eliminar trabajos_contratistas" ON trabajos_contratistas FOR DELETE USING (obtener_rol_usuario() = 'admin_total');
CREATE POLICY IF NOT EXISTS "Eliminar empleados" ON empleados FOR DELETE USING (obtener_rol_usuario() = 'admin_total');
CREATE POLICY IF NOT EXISTS "Eliminar jornadas" ON jornadas FOR DELETE USING (obtener_rol_usuario() = 'admin_total');
