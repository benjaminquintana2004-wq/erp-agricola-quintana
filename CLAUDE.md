# CLAUDE.md — ERP Agrícola Quintana

Lee este archivo completo antes de hacer cualquier cosa.
El PLAN.md tiene el detalle técnico de cada módulo. Este archivo tiene el contexto del negocio y las reglas de trabajo.

---

## Quién es el cliente y qué hace

**Diego Ricardo Quintana** — Ingeniero Agrónomo, Córdoba, Argentina.
CUIT: 20-20649478-7. Domicilio: Deán Funes 2129, Córdoba.

Diego es un **productor agropecuario arrendatario**: no es dueño de los campos que trabaja, sino que los alquila a distintos propietarios (arrendadores) y los explota productivamente. Produce principalmente soja y maíz, aunque también trigo, girasol y sorgo según la campaña.

**La escala del negocio:**
- ~60-70 contratos de arrendamiento activos
- ~18.000 hectáreas trabajadas
- Múltiples empleados y contratistas externos
- Operaciones en toda la zona de Córdoba

---

## El problema central que resuelve esta app

Hoy Diego gestiona todo en Excel y papel. Los problemas concretos son:

1. **Saldos de quintales** — a cada arrendador le debe una cantidad de qq por año. Cuando el arrendador llama y pide que le "vendan" algunos qq, hay que descontarlos del saldo. Con 60-70 personas esto es caótico.

2. **Facturas pendientes** — cuando Diego vende qq de un arrendador, el arrendador tiene que emitir una factura. Muchas veces no la manda y Diego tiene que acordarse de pedírsela.

3. **Sin visibilidad de la producción** — no hay registro centralizado de qué se sembró en cada lote, cuánto costó, cuánto rindió, qué maquinaria se usó.

4. **Sin trazabilidad** — no se puede rastrear fácilmente el camino de un qq desde el lote hasta la venta.

---

## Vocabulario del negocio — IMPORTANTE

Usá siempre estos términos en la UI, nunca jerga técnica:

| Término del campo | NO usar |
|---|---|
| Quintal (qq) | "unidad", "item" |
| Arrendador | "proveedor", "cliente", "usuario" |
| Contrato de arrendamiento | "acuerdo", "deal" |
| Campaña | "período", "año fiscal" |
| Lote | "parcela", "field" |
| Labor | "tarea", "operación" |
| Insumo | "producto", "material" |
| Saldo pendiente | "deuda", "balance" |
| Factura | "comprobante" (solo si es necesario aclarar) |
| Blanco / Negro | "formal / informal" (solo en documentación técnica) |

**Un quintal = 100 kg de grano.**
El precio del quintal varía diariamente según la Bolsa de Cereales de Rosario.

---

## Contexto legal argentino relevante

**RENSPA** — Registro Nacional Sanitario de Productores Agropecuarios (SENASA).
Diego debe estar inscripto como arrendatario en cada campo que trabaja. La reinscripción es anual.
Desde julio 2025 el RENSPA es obligatorio en la Carta de Porte Electrónica (CPE) para mover granos.

**Factura ARCA** — Las facturas de venta de quintales son emitidas por los arrendadores a través del sistema ARCA (ex-AFIP). Tienen:
- Tipo: Factura A (entre responsables inscriptos)
- Número de comprobante en formato: XXXXX-XXXXXXXX (punto de venta + correlativo)
- CAE (Código de Autorización Electrónica) con fecha de vencimiento
- Condición fiscal: "Productor Agropecuario", no gravado en IVA

**Carta de Porte Electrónica (CPE)** — documento obligatorio para mover granos de un campo a un acopio. Requiere el RENSPA del lote de origen.

**Blanco vs. Negro** — algunas operaciones se registran formalmente (blanco) con factura y todo en regla, y otras informalmente (negro) sin factura. El sistema debe soportar ambas y mostrarlas separadas, sin mezclarlas nunca.

---

## Ejemplo real de operación para entender el flujo

**Contrato Rebufatti (real, ya cargado como ejemplo):**
- Arrendador: Roberto Mateo Rebufatti, DNI 10.677.055, CUIT 20-10677055-8
- Campo: Villa Ascasubi, Córdoba — 7 fracciones catastrales, 33,30 ha totales
- Precio: 10 qq/ha/año de soja → 333 qq/año
- Vigencia: 01/07/2024 al 30/06/2027 (3 años)
- QQ totales del contrato: 999 qq

**Ejemplo de movimiento (real):**
- Arrendador: Malpassi Gerardo Ariel, CUIT 20-23893853-9, Berrotarán, Córdoba
- Factura A N° 00002-00000058, fecha 27/03/2026
- 140 qq de soja a $48.000/qq = $6.720.000 total
- CAE: 86139182102318, vencimiento 06/04/2026
- Este movimiento se descuenta del saldo pendiente de Malpassi

---

## Usuarios del sistema y sus necesidades

**Diego Quintana — rol: admin_total**
- Ve todo, edita todo, aprueba decisiones importantes
- Necesita ver rápido: ¿cuánto le debo a cada arrendador? ¿qué facturas faltan? ¿cómo va la campaña?
- No es técnico en computación — la UI debe ser muy clara
- Accede desde celular y computadora

**Persona administrativa — rol: admin**
- Carga datos diariamente: movimientos, facturas, labores
- Escanea PDFs de contratos y facturas
- Hace seguimiento de facturas pendientes
- Accede principalmente desde desktop

**Empleados — rol: empleado**
- Solo consultan información de su área
- No pueden modificar ni eliminar nada
- Acceden principalmente desde celular en el campo

---

## Stack tecnológico

| Componente | Tecnología | Costo |
|---|---|---|
| Frontend | HTML + JS vanilla (sin frameworks) | Gratis |
| Hosting | Netlify | Gratis |
| Base de datos | Supabase (PostgreSQL) | Gratis |
| Autenticación | Supabase Auth + Google OAuth | Gratis |
| Storage de PDFs | Supabase Storage | Gratis |
| IA para PDFs | Gemini 2.5 Flash API | Gratis |
| Mapas | Leaflet.js | Gratis |
| Precio mercado | API Bolsa de Cereales de Rosario | Gratis |
| Dominio | Por definir (.com.ar preferido) | ~$5-15 USD/año |

---

## Flujo de desarrollo local → producción

```
Claude Code escribe código localmente
        ↓
Probamos con: netlify dev (corre en localhost:8888)
        ↓
Funciona → git commit + git push a GitHub
        ↓
Netlify detecta el push y despliega automáticamente
        ↓
URL pública actualizada (accesible desde cualquier dispositivo)
```

**Variables de entorno necesarias (.env local y en Netlify):**
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
GEMINI_API_KEY=
```

---

## Reglas de trabajo para Claude Code

### Desarrollo
- Un paso a la vez, en el orden exacto del PLAN.md. Nunca saltear pasos.
- Antes de escribir código, explicar brevemente qué se va a hacer y por qué.
- Si hay una decisión técnica con múltiples opciones, presentarlas y recomendar antes de ejecutar.
- Nunca inventar datos, asumir valores ni completar campos con información ficticia.
- Si falta información para continuar, preguntar antes de asumir.
- Después de cada módulo, verificar que funciona antes de pasar al siguiente.

### Código
- HTML + JS vanilla únicamente. Sin React, Vue, ni ningún framework.
- CSS con variables definidas al inicio del archivo. Nunca hardcodear colores ni tamaños.
- Nombres de funciones y variables en español, descriptivos (cargarArrendadores, guardarMovimiento, calcularSaldo).
- Comentarios en español en bloques de lógica compleja.
- Manejo de errores en todos los llamados a Supabase. Nunca un catch vacío.
- Separar el código en archivos lógicos: `app.js`, `supabase.js`, `ui.js`, etc. No todo en un solo archivo.

### Diseño — reglas obligatorias
- **Tema:** dark theme. Fondo oscuro (#0f0e0c o similar), texto claro, acentos en dorado (#c9a84c) y verde (#4a9e6e).
- **Navegación:** sidebar fija a la izquierda con ícono + etiqueta. Nunca tabs horizontales en el nivel principal.
- **Tablas:** filas alternadas, hover effect, columnas bien espaciadas, ordenables.
- **Formularios:** labels arriba del campo (nunca como placeholder). Campos agrupados lógicamente. Validación visible en tiempo real.
- **Estados visuales:** verde=ok/completo, rojo=problema/alerta, amarillo=pendiente/atención, gris=inactivo. Siempre explícitos.
- **Acciones destructivas:** siempre pedir confirmación antes de eliminar. Mostrar qué se va a borrar.
- **Responsive:** funcionar bien en desktop y tablet. Mobile es secundario pero no ignorado.
- **Feedback:** mensajes de éxito/error siempre visibles con toasts o banners. Nunca silenciosos.
- **Loading:** mostrar estado de carga en toda operación asíncrona. El usuario siempre sabe que algo está pasando.
- **Lenguaje:** usar vocabulario del campo (ver tabla de vocabulario arriba). Nunca jerga técnica en la UI.
- **Tipografía:** fuente legible, tamaño generoso. El usuario principal tiene 50+ años.

---

## Contexto de conversación con el desarrollador

Este proyecto fue planificado en detalle. El desarrollador (Benjamín, hijo de Diego) entiende el negocio pero está aprendiendo desarrollo web. Cuando algo no está claro técnicamente, explicar con analogías simples del campo. El objetivo es que Benjamín entienda qué se está construyendo, no solo que funcione.

Ejemplos de cómo explicar conceptos técnicos:
- Supabase Row Level Security → "es como un portero en la puerta de cada tabla que verifica si el usuario tiene permiso antes de dejar pasar la consulta"
- Git commit → "es como sacar una foto del estado del código en este momento, para poder volver a este punto si algo sale mal"
- API → "es como un mozo en un restaurante: vos pedís algo (request), él va a la cocina (servidor) y te trae el resultado (response)"

---

## Archivos del proyecto

| Archivo | Descripción |
|---|---|
| `CLAUDE.md` | Este archivo. Contexto completo del negocio y reglas. |
| `PLAN.md` | Hoja de ruta técnica: fases, módulos, schema, orden de construcción. |
| `arrendamientos_v2.html` | Prototipo funcional existente con Google Sheets (referencia de UI y lógica). |
| `apps_script_backend.js` | Backend anterior en Google Apps Script (referencia, no usar en la nueva versión). |

---

## Lo que YA existe y sirve de referencia

La `arrendamientos_v2.html` es un prototipo funcional que ya:
- Conecta con Google Sheets via Apps Script
- Extrae datos de PDFs con Gemini
- Muestra saldos, movimientos y alertas básicas
- Tiene dashboard con Chart.js

**No migrar ese código directamente.** Usarlo como referencia de lógica y diseño, pero construir la nueva versión desde cero con Supabase como backend.

---

## Decisiones ya tomadas — no volver a discutir

- Base de datos: Supabase (no Google Sheets, no Firebase, no otro)
- Frontend: HTML + JS vanilla (no React, no Vue)
- Hosting: Netlify
- IA para PDFs: Gemini 2.5 Flash (no OpenAI, no Claude API directamente)
- Mapas: Leaflet.js (no Google Maps, no Mapbox — son de pago)
- Dos saldos separados por arrendador: blanco y negro, nunca mezclados
- La factura es opcional al registrar un movimiento
- Flujo de desarrollo: local con netlify dev → deploy automático via GitHub → Netlify
