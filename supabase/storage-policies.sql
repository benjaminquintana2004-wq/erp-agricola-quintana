-- ==============================================
-- Políticas de Storage para buckets de PDFs
-- Ejecutar DESPUÉS de crear los buckets 'contratos' y 'facturas'
-- ==============================================

-- ---- Bucket: contratos ----

-- Todos los usuarios autenticados pueden ver los contratos
CREATE POLICY "Leer contratos" ON storage.objects
    FOR SELECT USING (bucket_id = 'contratos' AND auth.role() = 'authenticated');

-- Solo admin_total y admin pueden subir contratos
CREATE POLICY "Subir contratos" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'contratos'
        AND auth.role() = 'authenticated'
        AND (SELECT rol FROM usuarios WHERE id = auth.uid()) IN ('admin_total', 'admin')
    );

-- Solo admin_total puede eliminar contratos
CREATE POLICY "Eliminar contratos" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'contratos'
        AND (SELECT rol FROM usuarios WHERE id = auth.uid()) = 'admin_total'
    );

-- ---- Bucket: facturas ----

-- Todos los usuarios autenticados pueden ver las facturas
CREATE POLICY "Leer facturas" ON storage.objects
    FOR SELECT USING (bucket_id = 'facturas' AND auth.role() = 'authenticated');

-- Solo admin_total y admin pueden subir facturas
CREATE POLICY "Subir facturas" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'facturas'
        AND auth.role() = 'authenticated'
        AND (SELECT rol FROM usuarios WHERE id = auth.uid()) IN ('admin_total', 'admin')
    );

-- Solo admin_total puede eliminar facturas
CREATE POLICY "Eliminar facturas" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'facturas'
        AND (SELECT rol FROM usuarios WHERE id = auth.uid()) = 'admin_total'
    );
