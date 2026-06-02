# Guía de seguridad y publicación — ERP Agrícola Quintana

Esta guía cubre los pasos que **vos** tenés que hacer en los paneles (Supabase,
Google, Netlify) para terminar de blindar la app antes de publicarla.
El código ya quedó listo; esto conecta las piezas.

> Hacé los pasos **en orden**. Cada uno tarda pocos minutos.

---

## Resumen de qué cambió en el código

- Las claves de **Gemini y Anthropic ya NO viajan al navegador**. Ahora viven
  como secretos en dos **Edge Functions de Supabase** (`gemini-proxy` y
  `anthropic-proxy`) que verifican que seas un usuario logueado antes de usarlas.
- `/api/env` ahora solo entrega `SUPABASE_URL` y la `anon key` (ambas son
  públicas por diseño; la seguridad real la da RLS).
- Se centralizó el **escapado de HTML** (anti-XSS) y se aplicó en las pantallas
  de arrendadores, ficha de arrendador y ficha de grupo.
- Hay un SQL nuevo para activar **RLS en 4 tablas** que estaban sin políticas.

---

## PASO 1 — Instalar la Supabase CLI (una sola vez)

La CLI es la herramienta para subir las Edge Functions.

```bash
# Windows (con npm, que ya tenés por Netlify)
npm install -g supabase

# Verificar que quedó instalada
supabase --version
```

---

## PASO 2 — Conectar la CLI a tu proyecto (una sola vez)

```bash
# 1. Iniciar sesión (abre el navegador para autorizar)
supabase login

# 2. Enlazar esta carpeta con tu proyecto de Supabase
#    El "ref" lo sacás de: Supabase → Settings → General → Reference ID
supabase link --project-ref TU_REFERENCE_ID
```

---

## PASO 3 — Cargar las claves como secretos del servidor

Estas claves quedan guardadas en Supabase, **nunca** en el navegador ni en GitHub.

```bash
supabase secrets set GEMINI_API_KEY=tu-clave-de-gemini
supabase secrets set ANTHROPIC_API_KEY=tu-clave-de-anthropic

# Orígenes permitidos para CORS (de dónde puede venir el pedido).
# Cuando tengas el dominio definitivo, agregalo separado por coma.
supabase secrets set ALLOWED_ORIGINS=https://TU-SITIO.netlify.app,http://localhost:8888
```

> 📌 Si todavía no tenés dominio, poné por ahora solo la URL de Netlify
> (`https://algo.netlify.app`) y `http://localhost:8888` para desarrollo.
> Más adelante volvés a correr el comando con el dominio nuevo.

---

## PASO 4 — Desplegar las Edge Functions

```bash
supabase functions deploy gemini-proxy
supabase functions deploy anthropic-proxy
```

Cada una debería responder “Deployed Function …”. Listo: el proxy está vivo.

---

## PASO 5 — Activar RLS en las 4 tablas que faltaban

1. Abrí **Supabase → SQL Editor**.
2. Pegá **todo** el contenido de `supabase/rls-tablas-faltantes.sql`.
3. Apretá **Run**.

Debería decir “RLS y políticas aplicadas en …” para cada tabla.

---

## PASO 6 — Verificar que RLS esté prendido en TODAS las tablas

En el **SQL Editor**, corré esta consulta:

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY rowsecurity ASC, tablename;
```

- ✅ **Correcto:** todas las filas con `rowsecurity = true`.
- ❌ **Problema:** si alguna tabla aparece con `rowsecurity = false`, esa tabla
  está desprotegida. Avisame el nombre y le agrego las políticas.

---

## PASO 7 — Limitar el login de Google a tu dominio

1. **Supabase → Authentication → URL Configuration**.
2. En **Site URL** poné tu dominio de producción (ej: `https://tu-sitio.netlify.app`).
3. En **Redirect URLs** dejá SOLO:
   - `https://tu-sitio.netlify.app/**`
   - `http://localhost:8888/**` (para desarrollo)
4. **Borrá** cualquier URL con comodín amplio o de pruebas que no reconozcas.

Esto evita que alguien use tu login desde otro sitio.

---

## PASO 8 — Revisar las variables de entorno en Netlify

En **Netlify → Site settings → Environment variables**, alcanza con tener:

```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

> Las variables `GEMINI_API_KEY` y `ANTHROPIC_API_KEY` que estaban en Netlify
> **ya no se usan en el navegador** y podés borrarlas de Netlify (ahora viven
> como secretos en Supabase, paso 3). No es urgente, pero deja todo más prolijo.

---

## PASO 9 — Prueba final (smoke test)

Después de desplegar, entrá al sitio y probá:

1. **Login con Google** → entrás y ves el dashboard.
2. **Cargar un arrendador** a mano → se guarda y aparece en la lista.
3. **Subir un PDF de contrato** y extraer con **Gemini** → completa los campos.
4. **Subir un PDF** y extraer con **Claude** → completa los campos (esta es la
   prueba clave del proxy con llamadas largas).
5. Abrí las **herramientas de desarrollador (F12) → pestaña Network**, filtrá
   por `env` y confirmá que la respuesta **NO** contiene `GEMINI_API_KEY` ni
   `ANTHROPIC_API_KEY`.

Si los 5 pasos andan, la app quedó publicada y blindada. 🎉

---

## Pendiente conocido (no bloquea el deploy)

- **Escapado anti-XSS en módulos secundarios:** ya está cubierto el ingreso de
  datos (formularios de arrendadores, que es por donde entra el texto de los
  PDFs) y las fichas de arrendador y grupo. Falta hacer la misma pasada en
  módulos secundarios (lotes, maquinaria, insumos, empleados, contratistas,
  stock, labores, despachos, reportes, tesorería en profundidad). Como solo
  pueden cargar datos 2-3 personas de confianza, el riesgo es bajo, pero
  conviene completarlo. Avisame y lo cierro.
