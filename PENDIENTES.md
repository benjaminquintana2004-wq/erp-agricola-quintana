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
