# PLAN.md — ERP Agrícola Quintana

---

## INSTRUCCIONES GENERALES PARA CLAUDE CODE

### Filosofía de desarrollo
- Construir de a un módulo a la vez. No avanzar al siguiente sin que el anterior funcione.
- Antes de escribir código, explicar brevemente qué se va a hacer y por qué.
- Si hay una decisión técnica importante, presentar las opciones y recomendar una antes de ejecutar.
- Nunca inventar datos ni asumir valores. Si falta información, preguntar.

### Interfaz — reglas de diseño obligatorias
- Estética: dark theme (fondo oscuro, texto claro, acentos dorados/verdes). Profesional, no prototipo.
- Navegación lateral fija con íconos + etiquetas. Nunca tabs horizontales en el nivel principal.
- Tablas con filas alternadas, hover effect, columnas bien espaciadas.
- Formularios con labels arriba del campo, no como placeholder. Campos agrupados lógicamente.
- Estados visuales explícitos siempre: verde=ok, rojo=problema, amarillo=atención, gris=inactivo.
- Botones destructivos (eliminar) siempre con confirmación previa.
- La app debe verse bien en escritorio y tablet. Mobile es secundario.
- Mensajes de éxito/error siempre visibles con toasts o banners. Nunca silenciosos.
- Cada sección con título claro, subtítulo descriptivo y breadcrumb si hay subniveles.
- Loading states en toda operación asíncrona. El usuario siempre sabe que algo está pasando.

### Código — estándares
- HTML + JS vanilla. Sin frameworks (no React, no Vue).
- CSS con variables definidas al inicio. No hardcodear colores.
- Funciones con nombres descriptivos en español (ej: cargarArrendadores, guardarMovimiento).
- Comentarios en español en bloques de lógica compleja.
- Manejo de errores en todos los llamados a Supabase. Nunca catch vacío.

---

## Stack

- Frontend: HTML + JS vanilla → Netlify (gratis)
- Base de datos + Auth + Storage: Supabase (gratis)
- IA para PDFs: Gemini 2.5 Flash API (gratis)
- Precio de mercado: API Bolsa de Cereales de Rosario

---

## FASE 1 — Base del sistema

### 1.1 Autenticación y roles
- Login con Google via Supabase Auth
- 3 roles: admin_total (Diego, acceso completo), admin (carga y edición), empleado (solo lectura)
- Página de login limpia con botón "Ingresar con Google"
- Redirección automática según rol al iniciar sesión

### 1.2 Arrendadores y contratos
- CRUD completo de arrendadores
- Campos del arrendador: nombre completo, DNI, CUIT, domicilio, teléfono, email
- Campo de notas/observaciones por arrendador (texto libre para info blanda: "prefiere cobrar en USD", "el hijo maneja todo", "siempre paga tarde", etc.)
- Contratos plurianuales: duración en años, qq pactados por año, grano, moneda
- Vista por arrendador: pagado año pasado / saldo año actual / pendiente año próximo
- Saldo BLANCO y saldo NEGRO independientes por arrendador y por campaña
- PDF del contrato adjunto (Supabase Storage), visualizable desde la app
- Carga manual o escaneo automático con Gemini (extrae nombre, DNI, CUIT, domicilio, hectáreas, qq/ha, fechas, grano, cultivos permitidos, jurisdicción)
- Resumen de cuenta por arrendador exportable a PDF: saldo actual (blanco/negro), últimos movimientos, facturas pendientes — pensado para enviar por WhatsApp en 2 clicks

#### Vencimientos y renovaciones de contratos — NUEVO
- Estado del contrato: vigente / por_vencer / vencido / renovado
- Alertas automáticas a 90, 60 y 30 días del vencimiento
- Panel en dashboard: contratos que vencen esta campaña
- Al renovar, se crea un nuevo contrato vinculado al anterior (historial)
- Con ~70 contratos activos, perder uno por descuido sería un problema grave

#### RENSPA por campo — NUEVO
- Campo en la ficha del contrato: número de RENSPA + fecha de vencimiento
- La reinscripción es anual y obligatoria
- Desde julio 2025 el RENSPA es requerido en la Carta de Porte Electrónica (CPE) para mover granos
- Si se vence un RENSPA, Diego no puede despachar granos de ese campo
- Alerta automática a 60 y 30 días antes del vencimiento
- Estado: vigente / por_vencer / vencido

#### Fracciones catastrales por contrato — NUEVO
- Un contrato puede estar compuesto por múltiples fracciones (ej: contrato Rebufatti tiene 7 fracciones)
- Cada fracción tiene: denominación catastral, número de cuenta, porcentaje de titularidad (ej: 50%), hectáreas y coordenadas GPS (lat/lng)
- Hectáreas totales del contrato = suma automática de las fracciones
- Coordenadas de cada fracción se usan para mostrar marcadores individuales en el mapa Leaflet
- Gemini extrae las fracciones automáticamente del PDF del contrato

#### Cláusulas contractuales relevantes — NUEVO
- Campo estructurado para registrar cláusulas clave extraídas del contrato:
  - Cultivos permitidos (ej: soja, trigo, sorgo, maíz)
  - Obligaciones de control de malezas (genera labor recurrente en cuaderno de campo)
  - Prohibición de subarrendar (registro informativo)
  - Derecho de inspección del arrendador (permite agendar visitas)
  - Responsabilidad de impuestos: arrendador o arrendatario
- Estas cláusulas se muestran en la ficha del contrato como recordatorio operativo

### 1.3 Movimientos y ventas de quintales
- Registro sin necesidad de factura (factura es opcional)
- Campos: arrendador, fecha, qq, precio, moneda, tipo (blanco/negro), observaciones
- Snapshot del precio de mercado del día al registrar el movimiento (se guarda automáticamente para comparar en retrospectiva si vendió caro o barato)
- PDF de factura adjunto opcional via Supabase Storage
- Escaneo automático de factura con Gemini (extrae: vendedor, CUIT vendedor, qq, precio unitario, total, CAE, fecha de vencimiento del CAE, número de comprobante en formato punto_de_venta-número)

#### Validación de CAE — NUEVO
- Al adjuntar una factura, el sistema extrae el número de CAE y su fecha de vencimiento
- Si la fecha de vencimiento del CAE es anterior a la fecha de recepción de la factura → alerta roja "CAE vencido, factura inválida"
- Si el CAE es válido → se registra junto al movimiento para trazabilidad legal
- Campo adicional en movimientos: punto_de_venta (ej: 00002) y nro_comprobante (ej: 00000058), guardados por separado para búsqueda y validación

#### Formato legal del número de comprobante — NUEVO
- El número de comprobante se guarda en formato estándar ARCA: XXXXX-XXXXXXXX (punto de venta + número correlativo)
- La app valida que el formato sea correcto antes de guardar
- Búsqueda de movimientos por número de comprobante completo

#### Estado de factura — indicadores visuales
- 🔴 sin_factura — movimiento registrado, factura no recibida
- 🟡 reclamada — ya se le pidió al arrendador, esperando respuesta
- 🟢 factura_ok — PDF adjunto correctamente
- Columna "días sin factura" en tabla, ordenable
- Filtro rápido: "Solo sin factura"

#### Alertas de facturas pendientes
- Intervalos configurables: por defecto 10, 20 y 30 días desde la fecha del movimiento
- Cada intervalo genera notificación interna (badge rojo en el menú)
- Panel de alertas en el dashboard: arrendador, qq, días transcurridos
- Botón "Ya reclamada" cambia estado y silencia hasta el próximo intervalo
- Historial de reclamos por movimiento (quién reclamó y cuándo)

### 1.4 Dashboard principal
- Resumen: arrendadores activos, qq pendientes totales, movimientos sin factura, alertas activas
- Lista de alertas urgentes (facturas > 20 días)
- Top 5 arrendadores con mayor saldo pendiente
- Últimos 10 movimientos registrados
- Gráfico: qq entregados por mes (últimos 12 meses)
- Gráfico: saldo pendiente por arrendador (barras horizontales, top 10)

---

## FASE 2 — Gestión de producción

### 2.1 Lotes
- Alta de lotes: nombre, hectáreas, campo, arrendador (si aplica), ubicación
- Estado: libre / en preparación / sembrado / cosechado / barbecho
- Historial de cultivos por lote (qué se sembró cada campaña)

### 2.2 Campañas agrícolas
- Una campaña por año (ej: 2024/25)
- Asociar a cada lote: cultivo, variedad, fecha siembra estimada, qq/ha esperados
- Al cerrar campaña: registrar qq/ha reales obtenidos
- Comparativa estimado vs. real al cierre

### 2.3 Cuaderno de campo — labores
- Registro por labor: tipo (siembra/fumigación/fertilización/cosecha/herbicida/otro), fecha, lote,
  producto, dosis, operario o contratista, maquinaria, costo
- Vista cronológica por lote (línea de tiempo)
- Exportable como PDF

### 2.4 Control de insumos y stock
- Alta de insumos: nombre, tipo, unidad, stock mínimo
- Movimientos: entrada (compra) y salida (aplicación en labor)
- Stock calculado automáticamente
- Alerta cuando cae bajo el mínimo
- Costo promedio ponderado

### 2.5 Stock de granos — Silobolsas y Acopios — NUEVO
El grano cosechado no se vende directo. Diego almacena en silobolsas en el campo y despacha a acopios de terceros o exportadores cuando el arrendador pide vender. Sin este módulo, la cadena queda cortada entre la cosecha y la venta.

#### Silobolsas (stock propio en campo)
- Alta de silobolsa: ubicación (lote), grano, campaña, fecha de armado, qq iniciales
- Datos de calidad al momento de la cosecha: humedad (%), proteína (%), peso hectolítrico, cuerpos extraños (%) — afectan el precio de venta
- Estado: activa / en uso / vacía / descartada
- Stock actual calculado: qq iniciales − qq despachados
- Coordenadas GPS para ubicar en el mapa Leaflet

#### Acopios de terceros
- Alta de acopio: nombre, ubicación, contacto, tarifa por qq/mes (muy baja según el negocio)
- Stock en acopio: grano, qq depositados, fecha de ingreso
- Costo acumulado de almacenamiento calculado automáticamente

#### Movimientos de stock
- Entrada: cosecha → silobolsa (vinculado a lote y campaña)
- Salida: silobolsa → acopio o silobolsa → exportador/comprador
- Cada salida genera o se vincula a un despacho
- Vista rápida: "¿cuánta soja tengo disponible en total?" (suma de silobolsas + acopios)

### 2.6 Costo real por lote y rentabilidad
- Suma automática de costos de labores + insumos por lote y campaña
- Costo total y costo por hectárea
- Rentabilidad = (qq cosechados × precio) − costos totales
- Comparativa de rentabilidad entre lotes de la misma campaña

---

## FASE 3 — Logística y personal

### 3.1 Maquinaria propia
- Alta de máquinas: nombre, tipo, marca, modelo, año
- Registro de uso: horas trabajadas por campaña y labor
- Mantenimientos: tipo, fecha, costo, próximo service
- Alerta cuando se acerca el próximo service
- Costo operativo por hora calculado automáticamente

### 3.2 Camiones y despachos
- Registro de despacho: fecha, lote, cultivo, qq netos, camión, empresa, chofer, destino
- Origen del despacho: silobolsa o acopio (vinculado al módulo de stock de granos)
- Asociar a: venta de qq de arrendamiento
- Número de CPE (Carta de Porte Electrónica) registrado como campo de trazabilidad — no se emite desde la app, se registra después de emitirlo en ARCA
- Ticket correlativo generado automáticamente
- Historial filtrable por lote, cultivo, destino, fecha, número de CPE

### 3.3 Contratistas externos
- Alta: nombre/empresa, CUIT, teléfono, especialidad
- Trabajos: lote, tarea, fecha, precio pactado, unidad (por ha/hora/total)
- Estado de pago: pendiente / parcialmente pagado / pagado
- Saldo adeudado calculado automáticamente
- Alerta cuando hay pagos pendientes hace más de X días

### 3.4 Empleados
- Legajo: nombre, DNI, CUIL, rol, fecha ingreso, teléfono, jornal diario
- Asignación a labores diarias
- Registro de jornadas: fecha, empleado, horas, lote, tarea
- Liquidación mensual: jornadas × jornal diario

---

## FASE 4 — Inteligencia y reportes

### 4.1 Precio de mercado en tiempo real
- Integración con API Bolsa de Cereales de Rosario (soja, maíz, girasol, trigo)
- Precio del quintal visible en el header, actualizado automáticamente
- Al registrar un movimiento, el precio del día se precarga (editable)
- Histórico: gráfico de evolución últimos 12 meses por cultivo

### 4.2 Trazabilidad completa
- Desde cualquier qq vendido o entregado como arrendamiento, rastrear la cadena completa:
  lote → campaña → cosecha → silobolsa (con datos de calidad) → CPE → despacho → acopio/exportador → destino final
- También rastrear: qué labores se hicieron → qué insumos se usaron → qué maquinaria → qué contratista
- Accesible desde el movimiento, desde el lote y desde la silobolsa
- Historial de precio: comparar precio de venta vs. precio de mercado del día (¿vendió caro o barato?)

### 4.3 Reportes exportables
- Reporte mensual por arrendador: movimientos, saldo blanco/negro, facturas pendientes
- Reporte de campaña: costos, ingresos, rentabilidad por lote
- Reporte de despachos por período
- Cuaderno de campo por lote (PDF imprimible)
- Stock actual de insumos
- Todo exportable a PDF y Excel

### 4.4 Dashboard avanzado
- KPIs campaña actual: ha sembradas, ha cosechadas, qq producidos, costo/ha promedio, rentabilidad total
- Comparativa entre campañas
- Mapa visual de lotes coloreado por estado
- Ranking de rentabilidad por lote y por campo arrendado

---

## Schema Supabase

```
usuarios              → id, email, nombre, rol, activo
arrendadores          → id, nombre, dni, cuit, domicilio, telefono, email, campo, hectareas, grano, moneda,
                         umbral_alerta_qq, notas
contratos             → id, arrendador_id, campaña_id, fecha_inicio, fecha_fin, qq_pactados_anual, tipo, pdf_url,
                         estado(vigente/por_vencer/vencido/renovado), contrato_anterior_id,
                         renspa_numero, renspa_vencimiento, renspa_estado(vigente/por_vencer/vencido)
saldos                → id, arrendador_id, campaña_id, qq_deuda_blanco, qq_deuda_negro
movimientos           → id, arrendador_id, fecha, qq, precio_quintal, precio_mercado_dia, moneda, tipo,
                         estado_factura(sin_factura/reclamada/factura_ok),
                         pdf_url, punto_venta, nro_comprobante, cae, cae_vencimiento, cae_valido,
                         fecha_ultimo_reclamo, observaciones, usuario_id
alertas_factura       → id, movimiento_id, dias_intervalo, fecha_disparo, reclamada, fecha_reclamo, usuario_id
fracciones_catastrales → id, contrato_id, denominacion_catastral, nro_cuenta, porcentaje_titularidad, hectareas, lat, lng
clausulas_contrato    → id, contrato_id, tipo(cultivos_permitidos/malezas/subarrendar/inspeccion/impuestos/otra), descripcion
lotes                 → id, nombre, hectareas, campo, arrendador_id, estado
campañas              → id, nombre, año_inicio, año_fin, activa
lote_campañas         → id, lote_id, campaña_id, cultivo, variedad, fecha_siembra, qq_estimados, qq_reales, cerrada
labores               → id, lote_campaña_id, fecha, tipo, producto, dosis, unidad, costo_total, operario_id, maquina_id, contratista_id
insumos               → id, nombre, tipo, unidad, stock_actual, stock_minimo, costo_promedio
mov_insumos           → id, insumo_id, tipo, cantidad, fecha, costo_unitario, labor_id
silobolsas            → id, lote_id, campaña_id, grano, fecha_armado, qq_iniciales, qq_actuales,
                         humedad, proteina, peso_hectolitrico, cuerpos_extraños,
                         estado(activa/en_uso/vacia/descartada), lat, lng
acopios               → id, nombre, ubicacion, contacto, tarifa_qq_mes
stock_acopio          → id, acopio_id, grano, qq_depositados, fecha_ingreso, costo_acumulado
mov_stock_granos      → id, tipo(entrada/salida), origen_tipo(cosecha/silobolsa/acopio), origen_id,
                         destino_tipo(silobolsa/acopio/exportador/comprador), destino_id,
                         grano, qq, fecha, despacho_id
maquinaria            → id, nombre, tipo, marca, modelo, año, horas_totales, costo_hora, proximo_service_fecha
mantenimientos        → id, maquina_id, fecha, tipo, costo, descripcion
camiones              → id, empresa, patente, chofer, telefono
despachos             → id, fecha, lote_id, cultivo, qq_netos, camion_id, destino, ticket_nro,
                         origen_tipo(silobolsa/acopio), origen_id, nro_cpe
contratistas          → id, nombre, cuit, telefono, especialidad
trabajos_contratistas → id, contratista_id, lote_id, fecha, tarea, precio, unidad, pagado, fecha_pago
empleados             → id, nombre, dni, cuil, rol, fecha_ingreso, telefono, jornal_diario, activo
jornadas              → id, empleado_id, fecha, horas, lote_id, tarea
```

---

## Orden de construcción

```
PASO 1  → Supabase: crear proyecto, tablas, políticas RLS básicas
PASO 2  → Login Google + roles + redirección por rol
PASO 3  → Módulo arrendadores: CRUD + contratos + PDF adjunto + notas + resumen exportable
PASO 4  → Vencimientos de contratos: estados + alertas a 90/60/30 días + panel en dashboard
PASO 5  → RENSPA por campo: registro + alertas de vencimiento
PASO 6  → Módulo movimientos: registro + snapshot precio mercado + estados de factura + alertas
PASO 7  → Dashboard principal: stats + alertas (facturas, contratos, RENSPA) + gráficos
PASO 8  → Módulo lotes + campañas
PASO 9  → Cuaderno de campo (labores) + control de insumos
PASO 10 → Stock de granos: silobolsas + acopios + movimientos de stock + calidad
PASO 11 → Costo por lote + rentabilidad
PASO 12 → Maquinaria + mantenimientos
PASO 13 → Camiones + despachos + CPE como trazabilidad (vinculado a stock de granos)
PASO 14 → Contratistas + empleados + jornadas
PASO 15 → Precio de mercado en tiempo real + historial por movimiento
PASO 16 → Reportes exportables (PDF + Excel) + resumen de cuenta por arrendador
PASO 17 → Dashboard avanzado con KPIs + mapa de silobolsas
PASO 18 → Deploy en Netlify + dominio
```

---

## Prompt para iniciar en Claude Code

Leé el CLAUDE.md y el PLAN.md completo antes de escribir una sola línea de código.

Vamos a construir un ERP agrícola profesional para un productor agropecuario de Córdoba, Argentina.
El sistema maneja arrendamientos de ~70 campos, producción de soja y maíz, logística y personal.

Reglas de trabajo:
1. Un paso a la vez, en el orden exacto del PLAN.md
2. Explicar brevemente qué vas a hacer antes de hacerlo
3. Diseño oscuro, profesional y ordenado (ver instrucciones de diseño en PLAN.md)
4. Si algo no está claro, preguntar antes de asumir

Empezamos por el PASO 1: crear el proyecto en Supabase con todas las tablas del schema.
Guiame paso a paso, incluyendo qué hacer en la interfaz web de Supabase.
