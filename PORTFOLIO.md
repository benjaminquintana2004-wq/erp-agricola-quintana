# ERP Agrícola Quintana — Caso de estudio

## Contexto

Sistema integral de gestión para una empresa agropecuaria arrendataria de Córdoba, Argentina, con ~70 contratos de arrendamiento activos y ~18.000 hectáreas trabajadas. Reemplaza la operatoria previa basada en Excel y papel, que generaba pérdida de visibilidad sobre saldos en quintales, facturación pendiente y producción.

**Usuario final:** un productor agropecuario de 50+ años (no técnico) y personal administrativo que carga datos diariamente desde escritorio y celular.

---

## Stack técnico

- **Frontend:** HTML5 + JavaScript vanilla (sin frameworks). Decisión deliberada para mantener simple el mantenimiento y evitar dependencias.
- **Backend / DB:** Supabase (PostgreSQL gestionado, Row Level Security, Auth con Google OAuth, Storage privado con signed URLs).
- **IA documental:** Gemini 2.5 Flash + Claude Sonnet 4.5 con sistema dual seleccionable y fallback automático entre modelos.
- **Hosting:** Netlify con deploy continuo desde GitHub.
- **Mapas:** Leaflet.js. **Tipografía:** Inter. **Tema oscuro** con sistema completo de design tokens en CSS variables.

---

## Módulos implementados

### Núcleo del negocio
- Arrendadores con soporte multi-arrendador (familias / sucesiones / sociedades comparten contratos N:N).
- Contratos con extracción IA de PDFs: arrendadores, representantes legales, fracciones catastrales, qq/ha, adelantos.
- Movimientos en quintales con saldos por contrato y por campaña.

### Operación
- Tesorería con cheques en "baldes" de 5 días, conciliación, factura adjunta N:N (un cheque puede tener múltiples facturas y viceversa).
- Mapa de campos y silobolsas (Leaflet).
- Lotes, labores, insumos, stock de granos, maquinaria.
- Despachos, contratistas, empleados.

### Información
- Dashboard con KPIs y alertas (RENSPA vencidos, contratos por vencer, facturas faltantes).
- Página de reportes con 5 plantillas (contratos próximos a vencer, adelantos pendientes, saldos por grupo, cheques por vencer, facturas faltantes), exportables a PDF / WhatsApp / portapapeles.
- Vista de campaña agrícola con cumplimiento global y por empresa.

---

## Decisiones técnicas destacables

**1. Modelo N:N en lugar de 1:1 para facturas-cheques.** El caso real (una factura cubre varios cheques o un cheque salda varias facturas) no encajaba en el modelo simple. Migración SQL con `UNIQUE NULLS NOT DISTINCT` para deduplicar por (número + CUIT) y `ON DELETE CASCADE` para limpieza atómica.

**2. Sistema dual de IA con fallback.** Gemini gratuito como motor principal, Claude como respaldo cuando hay rate limits. Tres modelos Gemini (2.5 → 2.0 → 1.5) en cascada con backoff exponencial. Costo total estimado: ~$2 USD/año.

**3. Extracción diferida de facturas en creación de cheques.** Archivo en memoria del navegador hasta el guardado, evitando subidas huérfanas a Storage si la operación falla a mitad. Pattern transaccional sin bloqueos de DB.

**4. Auto-cálculo bidireccional en formularios.** En contratos, modificar hectáreas o qq/ha recalcula el total anual automáticamente, blanco y negro independientes. Reduce errores de transcripción.

**5. Fechas en formato local (dd/mm/aaaa).** Reemplazo de `<input type="date">` por inputs de texto con máscara automática y conversión a ISO al guardar, en ~23 lugares de la app.

**6. Soft delete con reactivación.** Cheques anulados pueden recuperarse; el sistema decide automáticamente si vuelve a `pendiente` o `futuro` según fecha de cobro.

---

## Lo que demuestra el proyecto

- **Modelado de dominio complejo** (contratos plurianuales, saldos por campaña, baldes financieros, blanco/negro contable).
- **Integración de IA aplicada** a un problema de negocio real (extracción estructurada de PDFs argentinos: contratos ARCA, facturas de proveedores, RENSPA).
- **Trabajo con DB relacional** (Postgres, RLS, migraciones, triggers, índices parciales).
- **Diseño centrado en el usuario** (vocabulario del campo en lugar de jerga técnica, tema oscuro de alto contraste, tipografía generosa para usuarios mayores).
- **Iteración incremental** sobre un sistema en producción con datos reales (~70 contratos cargados, ~18.000 ha).
- **Pragmatismo en decisiones técnicas:** vanilla JS sobre frameworks, plantillas predefinidas sobre constructor genérico, fallback de IA gratuita sobre solución 100% paga.

---

## Métricas

- **~15 módulos funcionales** integrados.
- **~30 archivos HTML / JS / CSS** en frontend.
- **~10 migraciones SQL** documentadas en `/supabase`.
- **Costo de infraestructura:** $0 USD/mes (todo en planes free de Supabase, Netlify, Gemini).

---

## Vocabulario del dominio (glosario rápido para entrevistas)

| Término | Significado |
|---|---|
| Quintal (qq) | 100 kg de grano. Unidad de cuenta en arrendamientos. |
| Arrendador | Propietario que alquila el campo a Diego. |
| Contrato de arrendamiento | Acuerdo plurianual donde Diego paga al arrendador X qq por hectárea por año. |
| Campaña | Año agrícola (julio a junio típicamente). |
| Lote / Fracción | Unidad geográfica de cultivo dentro de un campo. |
| Balde de 5 días | Agrupador de vencimientos financieros (cheques que vencen entre el 1° y 5° día de cada mes, etc.). |
| RENSPA | Registro Nacional Sanitario de Productores Agropecuarios. Obligatorio para mover granos. |
| CPE | Carta de Porte Electrónica para transportar granos. |
| Blanco / Negro | Operaciones formales (con factura) vs informales (sin factura). |
