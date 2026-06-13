# PENDIENTES — ERP Agrícola Quintana

Lista de mejoras anotadas para hacer más adelante. No bloquean el uso de la app.

---

## 1. Página "Registro de actividad" (visor de auditoría) 🔵

**Qué es:** una pantalla dentro del ERP para ver el registro de auditoría
(quién cargó/editó/borró qué) sin tener que entrar a Supabase.

**Contexto:** la tabla `auditoria` ya existe y se llena sola con triggers
(ver `supabase/auditoria.sql`). Hoy solo se consulta por SQL. Falta la UI.

**Cómo implementarla:**
- Nueva página `public/registro-actividad.html` + `public/js/registro-actividad.js`
  (copiar la estructura de cualquier página existente, ej: `movimientos.html`).
- Agregar la entrada al sidebar en `public/js/ui.js` (`SECCIONES_MENU`),
  **visible solo para `admin_total`** (Diego). Filtrar por rol al renderizar.
- Cargar datos:
  ```js
  db.from('auditoria')
    .select('creado_en, usuario_email, accion, tabla, registro_id, datos')
    .order('creado_en', { ascending: false })
    .limit(100)
  ```
  (RLS ya bloquea a todos menos `admin_total`, así que la consulta solo
  funciona para Diego — perfecto.)
- Tabla con columnas: Fecha/hora · Usuario · Acción · Tabla · (ver datos).
  - Traducir `accion`: INSERT → "Cargó", UPDATE → "Editó", DELETE → "Borró".
  - Badge de color: verde=INSERT, amarillo=UPDATE, rojo=DELETE.
  - Botón "ver detalle" que abra un modal con el JSON de `datos` formateado.
- Filtros: por usuario, por tabla, por acción, por rango de fechas.
- **Acordarse de escapar con `escaparHTML()`** todo lo que se muestre
  (usuario_email, valores de `datos`), igual que en el resto de la app.

**Prioridad:** baja. La trazabilidad ya funciona; esto es solo comodidad
para no entrar a Supabase.

---

## 2. Definir permisos del rol "empleado" 🟡

**Estado:** pospuesto por decisión del usuario (jun-2026).

Hoy el rol `empleado`:
- **No puede ver** datos sensibles (contratos, arrendadores, tesorería,
  bancos, sueldos) — aplicado en `supabase/endurecimiento-seguridad.sql` (#2).
- **No puede cargar/editar/borrar** nada (solo lectura) — regla base de RLS.
- **Sí puede usar la IA** (extracción de PDF) — se decidió no restringirla.

**Pendiente:** cuando se vaya a crear el primer usuario empleado real,
definir bien qué puede ver y hacer, y ajustar las políticas RLS en
consecuencia (puede requerir darle permisos de escritura en ciertas tablas
si va a cargar datos).

---

## 3. Anti-XSS — módulos secundarios (revisión opcional) 🔵

**Estado:** cubierto lo principal (jun-2026).

Se aplicó `escaparHTML()` en todos los módulos para los campos de texto
libre prominentes (nombres, observaciones, descripciones, campo, emisor,
beneficiario, etc.), priorizando los datos que vienen de extracción de PDF.

**Pendiente opcional:** quedan algunos `<option>` de selects que muestran
nombres sin escapar (riesgo bajo: contexto de opción, y los datos los
cargan usuarios de confianza). Si se quiere cobertura 100%, hacer una
pasada final por los `<option value="...">${x.nombre}</option>`.

---

# IDEAS DE NUEVAS FUNCIONES (charladas jun-2026)

Ordenadas por impacto. Ninguna empezada todavía.

## 4. Resumen diario por WhatsApp 🟢 (alta practicidad)

**Qué es:** un resumen de lo urgente del día (RENSPA por vencer, contratos
por vencer, facturas pendientes, transferencias por ejecutar, adelantos de
qq a pagar) que le llegue a Diego, que vive en WhatsApp.

**El truco:** mandar a WhatsApp de forma automática NO es libre — Meta lo
candadea. Hay dos caminos:
- **Opción A (recomendada para empezar):** el ERP arma el "Resumen del día"
  y muestra un botón **"Enviar por WhatsApp"** (link `wa.me/?text=...`) →
  Diego lo manda con un toque. **Gratis, sin trámites, se hace ya.**
- **Opción B (automático total):** función programada (cron, ej. Netlify
  Scheduled Function o Supabase cron) que a las 7am consulta Supabase, arma
  el texto y lo envía vía **WhatsApp Business API** (Twilio o Meta Cloud API).
  Requiere: número dedicado (distinto al WhatsApp personal), verificación de
  negocio en Meta, plantilla aprobada y costo chico por mensaje.

**Nota:** la lógica de las alertas ya existe casi toda en el frontend; hay
que portarla al backend para el cron. Si se aceptara **email** en vez de
WhatsApp, el automático es trivial (sin trámites de Meta).

**Plan sugerido:** arrancar por la Opción A; escalar a B si convence.

---

## 5. App instalable en el celular (PWA) 🔵 (mejora transversal)

**Qué es:** convertir la web en una app instalable (ícono en el celular,
pantalla completa, carga rápida) sin App Store / Play Store. Útil para los
empleados en el campo.

**Qué implica:**
- `public/manifest.json` (nombre "ERP Quintana", íconos, colores dorado/oscuro,
  `display: standalone`, `start_url: /asistente.html`).
- Íconos PNG en varios tamaños → **hace falta un logo** (se puede hacer simple:
  "Q" dorada sobre fondo oscuro).
- Service worker (`public/sw.js`) para cacheo (carga rápida + cáscara offline).
  Cuidar la **estrategia de actualización** (que no sirva archivos viejos).
- `<link rel="manifest">` + meta `theme-color` en las páginas (o header común).
- HTTPS ya está (Netlify).

**Límite honesto:** NO funciona 100% sin internet (los datos están en Supabase).
Da experiencia tipo app + instalación + carga rápida, no offline real.

**Esfuerzo:** medio día. Lo único que se necesita del usuario: un logo/ícono.

---

## 6. Precio de mercado → valorizar en pesos 🟢 (alto impacto)

**Qué es:** traer el precio diario del qq (Bolsa de Cereales de Rosario, estaba
en el plan original) y mostrar el valor en $ de lo que se debe y del stock.
Ej: "¿cuánto vale en pesos lo que le debo a todos los arrendadores hoy?".
Potencia el asistente (nueva herramienta de tool_use). Convierte qq en plata.

---

## 7. Rentabilidad por lote / campaña 🟢 (alto impacto, datos ya cargados)

**Qué es:** reporte que cruza ingresos (producción × precio) menos costos
(arrendamiento + insumos + labores + contratistas + maquinaria) por lote y
por campaña → saber qué campo dio ganancia y cuál no. Los datos ya se cargan;
falta el cruce y la vista. Es el "para qué" último del ERP.
