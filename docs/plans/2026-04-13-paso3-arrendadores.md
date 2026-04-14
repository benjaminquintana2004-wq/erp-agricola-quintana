# PASO 3: Módulo Arrendadores — Plan de Implementación

**Goal:** Construir el CRUD completo de arrendadores con sidebar de navegación, tabla con búsqueda, formulario modal para agregar/editar, y vista de detalle con contratos.

**Architecture:** SPA con navegación por sidebar. Cada sección (arrendadores, movimientos, dashboard) es una página HTML independiente que comparte layout (sidebar + header). Los datos se leen/escriben directo a Supabase vía el cliente JS.

**Tech Stack:** HTML + JS vanilla, CSS variables (dark theme), Supabase JS Client v2

---

## Archivos a crear/modificar

| Archivo | Responsabilidad |
|---|---|
| `public/css/layout.css` | Sidebar, header, estructura general de páginas |
| `public/css/tablas.css` | Estilos de tablas, búsqueda, paginación |
| `public/css/formularios.css` | Estilos de modales, formularios, inputs |
| `public/js/ui.js` | Componentes reutilizables: sidebar, header, modales, toasts |
| `public/js/arrendadores.js` | Lógica CRUD de arrendadores |
| `public/arrendadores.html` | Página principal de arrendadores |
| `public/index.html` | Modificar: reemplazar dashboard temporal por redirección |

---

## Task 1: Layout base (sidebar + header)

**Files:**
- Create: `public/css/layout.css`
- Create: `public/js/ui.js`

- [ ] **Step 1: Crear layout.css con sidebar y header**

Sidebar fija a la izquierda con ícono + etiqueta para cada sección.
Header con título de la sección actual, nombre del usuario y botón cerrar sesión.
Área de contenido principal a la derecha del sidebar.

- [ ] **Step 2: Crear ui.js con funciones para renderizar sidebar y header**

Funciones: `renderizarSidebar()`, `renderizarHeader(titulo)`, `crearLayout(titulo)`.
El sidebar marca como activa la sección actual según `window.location.pathname`.

- [ ] **Step 3: Verificar visualmente en el navegador**

Abrir la página, confirmar que sidebar aparece a la izquierda con los ítems correctos.

- [ ] **Step 4: Commit**

---

## Task 2: Estilos de tablas y formularios

**Files:**
- Create: `public/css/tablas.css`
- Create: `public/css/formularios.css`

- [ ] **Step 1: Crear tablas.css**

Filas alternadas, hover effect, columnas espaciadas, header sticky.
Barra de búsqueda arriba de la tabla.
Badges de estado con colores semánticos.

- [ ] **Step 2: Crear formularios.css**

Modal centrado con overlay oscuro.
Labels arriba del campo (nunca placeholder).
Grupos de campos lógicos.
Validación visual en tiempo real (borde rojo/verde).
Botones de acción en el footer del modal.

- [ ] **Step 3: Commit**

---

## Task 3: Página de arrendadores — estructura HTML

**Files:**
- Create: `public/arrendadores.html`

- [ ] **Step 1: Crear arrendadores.html con layout completo**

Incluye: sidebar, header "Arrendadores", barra de búsqueda, botón "Nuevo Arrendador", tabla vacía, modal de formulario (oculto).
Carga los scripts en orden: config → supabase → auth → ui → arrendadores.

- [ ] **Step 2: Verificar que la página carga sin errores en consola**

- [ ] **Step 3: Commit**

---

## Task 4: Listar arrendadores (READ)

**Files:**
- Create: `public/js/arrendadores.js`

- [ ] **Step 1: Implementar cargarArrendadores()**

Consulta a Supabase: `db.from('arrendadores').select('*').eq('activo', true).order('nombre')`.
Renderiza cada arrendador como fila de tabla con: nombre, CUIT, campo, hectáreas, grano, teléfono, botones editar/ver.

- [ ] **Step 2: Implementar buscarArrendadores(termino)**

Filtra la tabla en tiempo real por nombre, CUIT o campo (búsqueda local en los datos ya cargados).

- [ ] **Step 3: Verificar que muestra la tabla (vacía por ahora, sin datos)**

- [ ] **Step 4: Commit**

---

## Task 5: Crear arrendador (CREATE)

**Files:**
- Modify: `public/js/arrendadores.js`

- [ ] **Step 1: Implementar abrirModalArrendador()**

Abre el modal de formulario vacío para crear un nuevo arrendador.
Campos: nombre, DNI, CUIT, domicilio, teléfono, email, campo, hectáreas, grano, moneda, umbral alerta, notas.

- [ ] **Step 2: Implementar guardarArrendador()**

Valida campos obligatorios (nombre como mínimo).
Inserta en Supabase: `db.from('arrendadores').insert(datos)`.
Cierra modal, muestra toast de éxito, recarga la tabla.

- [ ] **Step 3: Probar creando un arrendador de prueba**

- [ ] **Step 4: Commit**

---

## Task 6: Editar arrendador (UPDATE)

**Files:**
- Modify: `public/js/arrendadores.js`

- [ ] **Step 1: Implementar editarArrendador(id)**

Carga datos del arrendador y los pone en el modal.
El modal muestra "Editar arrendador" en vez de "Nuevo arrendador".

- [ ] **Step 2: Modificar guardarArrendador() para soportar update**

Si hay un ID existente, hace update en vez de insert.
`db.from('arrendadores').update(datos).eq('id', id)`.

- [ ] **Step 3: Probar editando el arrendador de prueba**

- [ ] **Step 4: Commit**

---

## Task 7: Eliminar arrendador (DELETE)

**Files:**
- Modify: `public/js/arrendadores.js`

- [ ] **Step 1: Implementar eliminarArrendador(id)**

Muestra confirmación: "¿Seguro que querés eliminar a [nombre]?"
Soft delete: `db.from('arrendadores').update({ activo: false }).eq('id', id)`.
Solo admin_total puede eliminar (verificar rol antes).

- [ ] **Step 2: Probar eliminando y verificando que desaparece de la tabla**

- [ ] **Step 3: Commit**

---

## Task 8: Actualizar index.html y navegación

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Reemplazar dashboard temporal por layout con sidebar**

El index.html ahora muestra el layout completo con sidebar.
Contenido temporal: "Dashboard — se construye en el PASO 7".
La navegación entre páginas funciona.

- [ ] **Step 2: Verificar flujo completo: login → index → arrendadores → volver**

- [ ] **Step 3: Commit final del PASO 3**
