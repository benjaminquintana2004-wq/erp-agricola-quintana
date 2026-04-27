-- ==============================================
-- Migración: notas a nivel grupo de arrendadores
-- ==============================================
-- Las notas del grupo se almacenan en la tabla `contratos` (campo
-- `notas_grupo`) y se replican en todos los contratos del grupo, igual
-- que `nombre_grupo`. Esto evita crear una tabla nueva y mantiene la
-- consistencia: el "grupo" sigue siendo el conjunto de arrendadores
-- compartido entre contratos, no una entidad propia.
--
-- Las notas personales (`arrendadores.notas`) se conservan tal cual y
-- siguen siendo útiles para observaciones específicas de cada persona.
-- ==============================================

ALTER TABLE contratos
    ADD COLUMN IF NOT EXISTS notas_grupo TEXT;

COMMENT ON COLUMN contratos.notas_grupo IS
    'Notas compartidas a nivel grupo (replicadas en todos los contratos del mismo grupo de arrendadores). Editar desde la ficha del grupo.';
