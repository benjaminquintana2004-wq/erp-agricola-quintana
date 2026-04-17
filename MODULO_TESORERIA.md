# Módulo de tesorería — ERP agrícola Quintana

> **Contexto para Claude Code:** Este documento describe el nuevo módulo de tesorería a agregar al ERP agrícola Quintana. Leer primero `CLAUDE.md` y `PLAN.md` para entender el contexto general del negocio y el stack técnico (HTML+JS vanilla, Supabase, Netlify, Gemini 2.5 Flash, Leaflet.js). Este módulo se integra con el módulo de arrendamientos ya existente.

---

## 1. Objetivo del módulo

Reemplazar el proceso manual que hoy hace la tía de Benjamín (Vale) para gestionar los cheques y transferencias de las dos empresas (Diego Quintana y El Ataco SRL), calcular el saldo real de las cuentas del Banco Galicia, y proyectar los fondos necesarios para cada fecha de pago.

**Proceso actual (el que reemplazamos):**
1. Empleados firman cheques y mandan foto al grupo de WhatsApp.
2. Vale carga uno por uno en un Excel con fecha, número de cheque, beneficiario, monto.
3. Ordena por fecha de cobro y suma montos por cada fecha terminada en 0 o 5.
4. Entra al home banking de Galicia, compara saldo de hoy vs ayer.
5. Cruza manualmente los débitos del banco con su Excel para marcar cheques cobrados.
6. Calcula saldo real = saldo del banco − cheques pendientes.
7. Arma mensaje de texto a Diego con el resumen diario.

**Dolor principal:** carga manual repetitiva, alto riesgo de error, cheques "fantasma" (empleados que se olvidan de mandar al grupo por falta de señal), proceso diario de ~2 horas para dos empresas.

---

## 2. Reglas clave del negocio

### 2.1 Dos empresas separadas
- **Diego Quintana** — cualquier empleado firma cheques a su nombre.
- **El Ataco SRL** — solo Diego firma cheques.
- Cada empresa tiene su propia cuenta corriente en Banco Galicia.
- Los saldos, cheques y transferencias se manejan por separado por empresa.

### 2.2 Fechas terminadas en 0 o 5
Diego estableció una regla: **todos los cheques se hacen con fecha terminada en 0 o 5** (05/04, 10/04, 15/04, etc.). No hay que redondear cheques — ya vienen con esa fecha.

### 2.3 Transferencias y el sistema de "baldes"
Las transferencias (principalmente pagos a arrendadores, pero también otras) pueden caer en cualquier fecha. Se agrupan por "baldes" de 5 días:

- Cada fecha terminada en 0 o 5 es un balde que recoge todo lo que cae **desde esa fecha hasta la próxima fecha en 0 o 5** (sin incluirla).
- Ejemplo: el balde del **05/04** cubre transferencias del **05/04 al 09/04**.
- Ejemplo: el balde del **30/03** cubre transferencias del **30/03 al 04/04**.
- Una transferencia del 02/04 va al balde del 30/03 (no al del 05/04) porque la plata tiene que estar disponible antes de que se pueda ejecutar.

**Regla matemática:** dada una fecha de transferencia, el balde es la fecha más grande que sea ≤ la fecha de transferencia Y termine en 0 o 5.

### 2.4 Flujo de transferencias a arrendadores (integración con módulo de arrendamientos)
Cuando un arrendador pide vender quintales:
1. Diego le avisa a AGD (u otro comprador) que venda X quintales.
2. AGD le acredita la plata a Diego.
3. Diego tiene que transferir al arrendador **7 días después** del aviso.
4. Esa transferencia pendiente se registra en tesorería con su fecha de ejecución.
5. Se agrupa al balde correspondiente para descontar del saldo proyectado.

### 2.5 Cálculo del saldo real
Ver sección 2.7 para la fórmula completa con los tres tipos de egresos.

### 2.6 Cheques siempre en pesos, préstamos en cualquier moneda
- **Cheques = siempre en pesos argentinos (ARS).** No existen cheques en dólares. El form de carga de cheques NO tiene selector de moneda.
- **Transferencias a arrendadores = siempre en pesos argentinos.** Se generan automáticamente desde el módulo de arrendamientos cuando se vende qq. No hay un form genérico para "cargar transferencia" — las transferencias son exclusivamente las ventas de quintales.
- **Préstamos = pueden ser en ARS o USD.** Diego toma préstamos bancarios que tienen fechas de vencimiento específicas. Estos también restan del saldo proyectado porque son compromisos de pago. Se necesita una sección aparte de "Préstamos" (ver sección 4.1 tabla `prestamos` y sección 5.7).

### 2.7 Tres tipos de egresos que restan del saldo
1. **Cheques** — siempre en ARS, cargados manualmente, con fecha terminada en 0 o 5.
2. **Transferencias a arrendadores** — siempre en ARS, creadas automáticamente desde el módulo de arrendamientos (venta de qq). Se agrupan al balde correspondiente.
3. **Cuotas de préstamos** — en ARS o USD, con fecha de vencimiento fija. Se cargan manualmente al registrar el préstamo.

El saldo real se calcula por separado para cada moneda:
```
saldo_real_ARS = saldo_banco_ARS − cheques_pendientes − transferencias_pendientes − cuotas_prestamos_ARS_pendientes
saldo_real_USD = saldo_banco_USD − cuotas_prestamos_USD_pendientes
```

### 2.8 Tres caminos de conciliación (diseñar preparado para los tres)

**Camino 1 — Carga manual del saldo (fase 1, arrancar con esto):**
- Vale ingresa el saldo diario del banco manualmente.
- El ERP calcula el saldo real automáticamente.
- Vale busca cheques pendientes por monto y los marca como cobrados con un click.

**Camino 2 — Subir PDF del extracto bancario (fase 2):**
- Vale descarga el extracto PDF del Galicia Office Banking.
- Sube el PDF al ERP.
- Gemini 2.5 Flash extrae los movimientos (ya está en el stack, es gratis).
- El sistema cruza automáticamente con los cheques cargados.
- Marca como cobrados los que machean y muestra excepciones.

**Camino 3 — Subir XLS/CSV del extracto (fase 3):**
- Si Galicia permite exportar movimientos como XLS/CSV, parsear directamente.
- Cruce más preciso que el PDF.

---

## 3. Stack y principios técnicos

Mantener consistente con el resto del ERP:

- **Frontend:** HTML + JS vanilla (sin frameworks).
- **DB + Auth + Storage:** Supabase (PostgreSQL).
- **Hosting:** Netlify.
- **Parser de PDFs:** Gemini 2.5 Flash API (ya configurado, gratuito).
- **Tema:** dark theme profesional (reusar variables CSS del resto del ERP).
- **Vocabulario de la UI:** del campo — "cheque", "transferencia", "arrendador", "empresa", "balde", "saldo real". No usar jerga técnica como "conciliación bancaria" en los títulos (usarlo solo en documentación interna).
- **Offline-ready (fase futura):** el schema debe soportar que un empleado cargue un cheque desde el celular sin señal y se sincronice después. Usar timestamps UTC + campo `synced_at` para detectar conflictos.

---

## 4. Schema de Supabase

### 4.1 Tablas nuevas

```sql
-- Empresas (Diego Quintana y El Ataco SRL)
CREATE TABLE empresas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  cuit TEXT,
  tipo TEXT CHECK (tipo IN ('persona_fisica', 'srl')),
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Cuentas bancarias (una por empresa y moneda)
CREATE TABLE cuentas_bancarias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID REFERENCES empresas(id) ON DELETE RESTRICT,
  banco TEXT NOT NULL DEFAULT 'Galicia',
  numero_cuenta TEXT,
  moneda TEXT CHECK (moneda IN ('ARS', 'USD')) NOT NULL,
  alias TEXT,
  activa BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Categorías de gasto (flete, fumigación, siembra, arrendamiento, insumos, etc.)
CREATE TABLE categorias_gasto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT UNIQUE NOT NULL,
  descripcion TEXT,
  activa BOOLEAN DEFAULT TRUE
);

-- Beneficiarios (a quién se le paga — contratistas, proveedores, arrendadores)
CREATE TABLE beneficiarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  cuit TEXT,
  categoria_default_id UUID REFERENCES categorias_gasto(id),
  arrendador_id UUID REFERENCES arrendadores(id) ON DELETE SET NULL,
  notas TEXT,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Movimientos (cheques Y transferencias a arrendadores — tabla unificada, SIEMPRE en ARS)
-- Los cheques se cargan manualmente. Las transferencias se crean automáticamente
-- desde el módulo de arrendamientos cuando un arrendador vende quintales.
CREATE TABLE movimientos_tesoreria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID REFERENCES empresas(id) ON DELETE RESTRICT NOT NULL,
  cuenta_bancaria_id UUID REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT NOT NULL,

  tipo TEXT CHECK (tipo IN ('cheque', 'transferencia')) NOT NULL,

  -- Solo para cheques
  numero_cheque TEXT,

  fecha_emision DATE NOT NULL,
  fecha_cobro DATE NOT NULL,      -- Cheques: siempre en 0 o 5. Transferencias: cualquier fecha.
  fecha_balde DATE NOT NULL,       -- Calculada automáticamente por trigger.

  beneficiario_id UUID REFERENCES beneficiarios(id) ON DELETE RESTRICT,
  categoria_id UUID REFERENCES categorias_gasto(id),

  monto NUMERIC(15,2) NOT NULL,    -- SIEMPRE en pesos argentinos (ARS)

  estado TEXT CHECK (estado IN ('pendiente', 'cobrado', 'anulado')) DEFAULT 'pendiente',
  fecha_cobrado_real DATE,

  -- Solo para transferencias creadas desde arrendamientos
  contrato_arrendamiento_id UUID REFERENCES contratos_arrendamiento(id) ON DELETE SET NULL,

  origen TEXT CHECK (origen IN ('manual_erp', 'manual_sheets', 'auto_arrendamiento', 'import_banco')),

  foto_url TEXT,
  notas TEXT,

  cargado_por UUID REFERENCES auth.users(id),
  cargado_en TIMESTAMPTZ DEFAULT NOW(),
  sincronizado_en TIMESTAMPTZ,
  actualizado_en TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT cheque_requiere_numero CHECK (
    (tipo = 'transferencia') OR (tipo = 'cheque' AND numero_cheque IS NOT NULL)
  )
);

CREATE INDEX idx_movimientos_fecha_balde ON movimientos_tesoreria(fecha_balde, empresa_id, estado);
CREATE INDEX idx_movimientos_empresa_estado ON movimientos_tesoreria(empresa_id, estado);

-- Préstamos (ARS o USD — se cargan manualmente, con cuotas que restan del saldo proyectado)
CREATE TABLE prestamos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID REFERENCES empresas(id) ON DELETE RESTRICT NOT NULL,
  cuenta_bancaria_id UUID REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT,
  acreedor TEXT NOT NULL,          -- Ej: "Banco Galicia", "Banco Nación"
  monto_total NUMERIC(15,2) NOT NULL,
  moneda TEXT CHECK (moneda IN ('ARS', 'USD')) NOT NULL,
  fecha_otorgamiento DATE NOT NULL,
  cantidad_cuotas INT NOT NULL DEFAULT 1,
  tasa_interes NUMERIC(6,4),       -- Tasa anual, ej: 0.4500 = 45%
  notas TEXT,
  estado TEXT CHECK (estado IN ('vigente', 'cancelado')) DEFAULT 'vigente',
  cargado_por UUID REFERENCES auth.users(id),
  cargado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Cuotas de préstamos (cada vencimiento individual)
CREATE TABLE cuotas_prestamo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prestamo_id UUID REFERENCES prestamos(id) ON DELETE CASCADE NOT NULL,
  numero_cuota INT NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  fecha_balde DATE NOT NULL,       -- Calculada automáticamente por trigger
  monto_capital NUMERIC(15,2) NOT NULL,
  monto_interes NUMERIC(15,2) DEFAULT 0,
  monto_total NUMERIC(15,2) NOT NULL,
  moneda TEXT CHECK (moneda IN ('ARS', 'USD')) NOT NULL,
  estado TEXT CHECK (estado IN ('pendiente', 'pagada', 'vencida')) DEFAULT 'pendiente',
  fecha_pago_real DATE,
  notas TEXT,
  UNIQUE(prestamo_id, numero_cuota)
);

CREATE INDEX idx_cuotas_fecha_balde ON cuotas_prestamo(fecha_balde, estado);

-- Saldos bancarios diarios (snapshot que carga Vale o que viene del extracto)
CREATE TABLE saldos_bancarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_bancaria_id UUID REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT NOT NULL,
  fecha DATE NOT NULL,
  saldo NUMERIC(15,2) NOT NULL,
  origen TEXT CHECK (origen IN ('manual', 'pdf_extracto', 'xls_extracto')) DEFAULT 'manual',
  cargado_por UUID REFERENCES auth.users(id),
  cargado_en TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cuenta_bancaria_id, fecha)
);

-- Extractos bancarios subidos (para parseo con Gemini)
CREATE TABLE extractos_bancarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_bancaria_id UUID REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT NOT NULL,
  fecha_desde DATE,
  fecha_hasta DATE,
  archivo_url TEXT NOT NULL,
  tipo_archivo TEXT CHECK (tipo_archivo IN ('pdf', 'xls', 'csv')),
  estado_procesamiento TEXT CHECK (estado_procesamiento IN ('pendiente', 'procesando', 'procesado', 'error')) DEFAULT 'pendiente',
  movimientos_detectados JSONB,
  movimientos_conciliados INT DEFAULT 0,
  movimientos_excepciones INT DEFAULT 0,
  error_mensaje TEXT,
  subido_por UUID REFERENCES auth.users(id),
  subido_en TIMESTAMPTZ DEFAULT NOW()
);

-- Movimientos del banco detectados (cada línea del extracto)
CREATE TABLE movimientos_banco (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extracto_id UUID REFERENCES extractos_bancarios(id) ON DELETE CASCADE,
  cuenta_bancaria_id UUID REFERENCES cuentas_bancarias(id) ON DELETE RESTRICT NOT NULL,
  fecha DATE NOT NULL,
  descripcion TEXT,
  numero_cheque TEXT,
  monto NUMERIC(15,2) NOT NULL,
  tipo TEXT CHECK (tipo IN ('debito', 'credito')),
  movimiento_tesoreria_id UUID REFERENCES movimientos_tesoreria(id) ON DELETE SET NULL,
  estado_conciliacion TEXT CHECK (estado_conciliacion IN ('no_conciliado', 'conciliado_auto', 'conciliado_manual', 'excepcion')) DEFAULT 'no_conciliado'
);
```

### 4.2 Función SQL para calcular la fecha del balde

```sql
CREATE OR REPLACE FUNCTION calcular_fecha_balde(fecha_input DATE)
RETURNS DATE AS $$
DECLARE
  dia INT;
  offset_dias INT;
BEGIN
  dia := EXTRACT(DAY FROM fecha_input)::INT;
  offset_dias := dia % 5;
  RETURN fecha_input - (offset_dias || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

**IMPORTANTE:** probar bien esta función con casos borde — inicio de mes (un movimiento del 02/04 debe ir al balde del 30/03 que es del mes anterior). La implementación simple (resta días) funciona bien para esto porque PostgreSQL maneja las fechas correctamente al cruzar meses.

### 4.3 Trigger para setear `fecha_balde` automáticamente

```sql
CREATE OR REPLACE FUNCTION set_fecha_balde()
RETURNS TRIGGER AS $$
BEGIN
  NEW.fecha_balde := calcular_fecha_balde(NEW.fecha_cobro);
  NEW.actualizado_en := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_fecha_balde
BEFORE INSERT OR UPDATE OF fecha_cobro ON movimientos_tesoreria
FOR EACH ROW EXECUTE FUNCTION set_fecha_balde();

-- Trigger para cuotas de préstamo (misma lógica de baldes)
CREATE OR REPLACE FUNCTION set_fecha_balde_cuota()
RETURNS TRIGGER AS $$
BEGIN
  NEW.fecha_balde := calcular_fecha_balde(NEW.fecha_vencimiento);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_fecha_balde_cuota
BEFORE INSERT OR UPDATE OF fecha_vencimiento ON cuotas_prestamo
FOR EACH ROW EXECUTE FUNCTION set_fecha_balde_cuota();
```

### 4.4 Vista para saldo real proyectado por fecha

```sql
-- Vista unificada: combina cheques + transferencias + cuotas de préstamos pendientes por balde
CREATE OR REPLACE VIEW vista_egresos_pendientes AS
-- Cheques y transferencias (siempre ARS)
SELECT
  mt.empresa_id,
  cb.moneda,
  mt.fecha_balde,
  mt.tipo AS tipo_egreso,
  mt.monto,
  mt.id AS referencia_id,
  'movimiento' AS tabla_origen
FROM movimientos_tesoreria mt
JOIN cuentas_bancarias cb ON cb.id = mt.cuenta_bancaria_id
WHERE mt.estado = 'pendiente'

UNION ALL

-- Cuotas de préstamos (ARS o USD)
SELECT
  p.empresa_id,
  cp.moneda,
  cp.fecha_balde,
  'cuota_prestamo' AS tipo_egreso,
  cp.monto_total AS monto,
  cp.id AS referencia_id,
  'cuota' AS tabla_origen
FROM cuotas_prestamo cp
JOIN prestamos p ON p.id = cp.prestamo_id
WHERE cp.estado = 'pendiente' AND p.estado = 'vigente';

-- Vista resumida por balde para el dashboard
CREATE OR REPLACE VIEW vista_saldo_proyectado AS
SELECT
  empresa_id,
  moneda,
  fecha_balde,
  SUM(monto) AS total_pendiente_balde,
  COUNT(*) AS cantidad_egresos,
  COUNT(*) FILTER (WHERE tipo_egreso = 'cheque') AS cantidad_cheques,
  COUNT(*) FILTER (WHERE tipo_egreso = 'transferencia') AS cantidad_transferencias,
  COUNT(*) FILTER (WHERE tipo_egreso = 'cuota_prestamo') AS cantidad_cuotas
FROM vista_egresos_pendientes
GROUP BY empresa_id, moneda, fecha_balde
ORDER BY moneda, fecha_balde;
```

---

## 5. Pantallas y UI

Un módulo nuevo en el menú lateral del ERP llamado **"Tesorería"**, con las siguientes pantallas:

### 5.1 Dashboard de tesorería (home del módulo)
- Selector de empresa arriba (Diego Quintana / El Ataco SRL / Ambas).
- **Bloque ARS:** Tarjetas con saldo actual del banco, saldo real calculado, total pendiente en cheques, total pendiente en transferencias a arrendadores, total pendiente en cuotas de préstamos ARS.
- **Bloque USD (si hay préstamos en USD):** Saldo banco USD, cuotas pendientes USD.
- Timeline horizontal de los próximos 8-10 baldes con el monto pendiente de cada uno. Badge rojo si el balde supera el saldo real proyectado. Desglose visual por tipo (cheque / transferencia / cuota).
- Botón grande "Cargar cheque" y acceso a "Préstamos".

### 5.2 Cargar cheque
- Form con: empresa, cuenta (ARS), número de cheque (obligatorio), fecha de cobro (validar que termine en 0 o 5), beneficiario (autocomplete con categoría sugerida), categoría, monto (siempre en pesos), foto opcional, notas.
- NO hay selector de moneda — siempre pesos.
- NO hay opción de "cargar transferencia" — las transferencias se crean automáticamente desde arrendamientos.
- El sistema calcula y muestra la fecha del balde en tiempo real ("este cheque se agrupa al balde del **05/04**").
- Si el beneficiario está asociado a un arrendador, mostrar el vínculo.

### 5.3 Listado de movimientos
- Tabla con filtros por: empresa, cuenta, estado (pendiente/cobrado/anulado), fecha desde/hasta, beneficiario, categoría.
- Agrupación visual por fecha de balde (como lo que Vale hace hoy a mano).
- Totales por balde al final de cada grupo.
- Acciones rápidas por fila: marcar cobrado, editar, anular, ver foto.
- Búsqueda por monto (para la conciliación manual del camino 1).

### 5.4 Conciliación
- Una pantalla con dos columnas: pendientes del ERP a la izquierda, movimientos del banco a la derecha.
- Para el camino 1 (manual): Vale busca un débito del banco por monto, encuentra el cheque pendiente, confirma con un click.
- Para el camino 2 (PDF): Vale sube el PDF, el sistema pre-machea, ella revisa las excepciones y confirma.
- Botón "cargar saldo del banco" con fecha + monto.

### 5.5 Reporte diario
- Replicar el formato del mensaje que Vale manda a Diego (lo vimos en el screenshot).
- Saldo del día, saldo proyectado al próximo balde, lista de baldes con faltantes.
- Botón "copiar al portapapeles" para que Vale lo pegue en WhatsApp, y/o botón "enviar por WhatsApp" (link wa.me).

### 5.6 Sincronización con Google Sheets
- Pantalla de configuración donde se conecta un Sheet de Google.
- Botones: "exportar a Sheets ahora", "importar desde Sheets ahora".
- Sync bidireccional: última modificación gana (comparar `actualizado_en`).
- Mostrar log de últimas sincronizaciones y conflictos si los hubo.

### 5.7 Préstamos
- Listado de préstamos vigentes y cancelados, con filtro por empresa y moneda.
- Form para cargar préstamo nuevo: empresa, acreedor, monto total, moneda (ARS/USD), fecha otorgamiento, cantidad de cuotas, tasa de interés (opcional), notas.
- Al cargar un préstamo, el sistema genera automáticamente las N cuotas con sus fechas de vencimiento y montos. Si no se conoce el detalle de cada cuota, generar cuotas iguales distribuidas mensualmente desde la fecha de otorgamiento.
- Vista de cuotas por préstamo: tabla con número de cuota, fecha de vencimiento, fecha balde, monto capital, monto interés, monto total, estado (pendiente/pagada/vencida).
- Acción rápida: marcar cuota como pagada (con fecha real de pago).
- Poder editar cuotas individuales si los montos o fechas reales difieren de lo generado.
- Las cuotas pendientes aparecen automáticamente en el dashboard y en el timeline de baldes junto con los cheques y transferencias.

---

## 6. Integración con el módulo de arrendamientos

Cuando se registra una venta de quintales de un arrendador (en el módulo que ya existe), debe:

1. Crear automáticamente un registro en `movimientos_tesoreria` con:
   - `tipo = 'transferencia'`
   - `fecha_cobro = fecha_aviso + 7 días`
   - `beneficiario_id = arrendador`
   - `monto = pesos equivalentes a los qq vendidos`
   - `contrato_arrendamiento_id = contrato correspondiente`
   - `origen = 'auto_arrendamiento'`
   - `estado = 'pendiente'`
2. El trigger `set_fecha_balde` calcula automáticamente el balde correcto.
3. Descontar los qq del saldo del arrendador en el módulo de arrendamientos (lógica que ya existe).

**Regla:** si se anula la venta en arrendamientos, el movimiento de tesorería asociado pasa a `estado = 'anulado'` automáticamente.

---

## 7. Roles y permisos (RLS en Supabase)

Tres roles iniciales:

- **Admin (Diego, Benjamín):** ve todo, edita todo, acceso a las dos empresas.
- **Contable (Vale):** ve todo, edita movimientos y saldos, acceso a las dos empresas. No puede borrar empresas ni cuentas.
- **Empleado (futuro):** solo carga cheques (no los edita ni borra). Solo ve los que cargó él.

Implementar con Row Level Security en Supabase. Por ahora arrancar con admin y contable funcionando; dejar el rol empleado preparado para la fase 2 (carga desde celular en el campo).

---

## 8. Plan de implementación sugerido

Construir en este orden para tener valor rápido:

**Paso 1 — Schema base:**
Crear todas las tablas (incluyendo `prestamos` y `cuotas_prestamo`), la función `calcular_fecha_balde`, los triggers y las vistas. Sembrar `empresas` con Diego Quintana y El Ataco SRL, `cuentas_bancarias` con las cuentas reales de Galicia, `categorias_gasto` con las que se ven en el Excel actual (flete, fumigación, siembra, arrendamiento, insumos, etc.).

**Paso 2 — Cargar cheques:**
Form de carga de cheques funcionando (solo pesos, número obligatorio, fecha en 0 o 5), con cálculo del balde en vivo. Listado con filtros y agrupación por balde. Marcado manual como cobrado.

**Paso 3 — Dashboard y saldo real:**
Carga manual del saldo diario del banco. Cálculo automático del saldo real (cheques + transferencias + cuotas). Timeline de baldes próximos con alertas de faltante. Bloques separados para ARS y USD.

**Paso 4 — Préstamos:**
Sección para cargar préstamos (ARS o USD), generación automática de cuotas, marcado de cuotas como pagadas. Las cuotas pendientes se integran al dashboard y al timeline de baldes.

**Paso 5 — Reporte diario:**
Generación del mensaje para Diego en el mismo formato del screenshot, con botón de copiar al portapapeles. Incluye desglose de cheques, transferencias y cuotas.

**Paso 6 — Integración arrendamientos:**
Hook en el módulo existente para que las ventas de quintales creen transferencias pendientes automáticamente en tesorería.

**Paso 7 — Sync con Google Sheets:**
Sincronización bidireccional con un Sheet configurado.

**Paso 8 — Conciliación con PDF (camino 2):**
Subir PDF del extracto de Galicia, procesar con Gemini 2.5 Flash, match automático, revisión de excepciones.

**Paso 9 — Conciliación con XLS (camino 3):**
Si Galicia permite exportar movimientos en XLS/CSV, parser directo sin Gemini.

**Paso 10 (futuro) — Modo offline para empleados:**
Service Worker + IndexedDB para cargas desde el campo sin señal.

---

## 9. Consideraciones de UX

- **Tema:** dark profesional, igual al resto del ERP.
- **Números grandes:** los montos se ven en miles con separador de miles (ej: 144.832.543,78) como en el screenshot de Vale, no en notación científica ni abreviada.
- **Monedas:** nunca mezclar ARS y USD en la misma suma. Si una cuenta tiene ambas, mostrar como dos bloques separados.
- **Confirmación de acciones irreversibles:** anular un cheque pide confirmación. Marcar como cobrado no (es reversible).
- **Vista móvil:** el listado de movimientos y el dashboard tienen que ser usables en celular para cuando los empleados carguen desde el campo.
- **Vocabulario:** usar "balde" o "fecha agrupada" en la UI (no "bucket" ni jerga). Si se prefiere algo más descriptivo, usar "fecha de pago agrupada".

---

## 10. Checklist final antes de dar por terminado el módulo

- [ ] Vale puede cargar un cheque en menos de 30 segundos.
- [ ] El sistema calcula automáticamente la fecha del balde al cargar.
- [ ] El dashboard muestra saldo real correcto para las dos empresas.
- [ ] La integración con arrendamientos crea transferencias automáticamente cuando se vende qq.
- [ ] El reporte diario genera el mismo formato que el mensaje actual de Vale a Diego.
- [ ] Google Sheets sincroniza en ambas direcciones.
- [ ] RLS bloquea que un usuario vea empresas que no le corresponden (cuando se implemente el rol empleado).
- [ ] Hay validación en el form para evitar cheques duplicados (mismo número + misma cuenta).
- [ ] Testear la función `calcular_fecha_balde` con fechas de fin de mes (31/03, 28/02 en año no bisiesto, etc.).

---

**Fin del documento.** Cualquier duda sobre reglas de negocio específicas, referirse al hilo de conversación original con Benjamín o consultarle antes de implementar.
