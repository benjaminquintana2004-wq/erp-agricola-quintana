-- ==============================================
-- Trigger: registrar usuarios automáticamente al loguearse
-- Cuando alguien se loguea con Google por primera vez,
-- se crea un registro en la tabla 'usuarios' con el rol correspondiente.
-- ==============================================

-- Función que se ejecuta automáticamente después de cada registro en auth
CREATE OR REPLACE FUNCTION registrar_usuario_nuevo()
RETURNS TRIGGER AS $$
DECLARE
    rol_asignado TEXT;
    nombre_usuario TEXT;
BEGIN
    -- Asignar rol según el email
    CASE NEW.email
        WHEN 'elatacosrl2012@gmail.com' THEN
            rol_asignado := 'admin_total';
        WHEN 'benjaminquintana2004@gmail.com' THEN
            rol_asignado := 'admin';
        ELSE
            -- Cualquier otro email no tiene acceso automático
            -- Un admin_total deberá agregarlo manualmente
            RETURN NEW;
    END CASE;

    -- Obtener el nombre del perfil de Google
    nombre_usuario := COALESCE(
        NEW.raw_user_meta_data ->> 'full_name',
        NEW.raw_user_meta_data ->> 'name',
        NEW.email
    );

    -- Insertar en la tabla usuarios
    INSERT INTO public.usuarios (id, email, nombre, rol, activo)
    VALUES (NEW.id, NEW.email, nombre_usuario, rol_asignado, true)
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Crear el trigger en la tabla auth.users
-- Se dispara cada vez que se crea un usuario nuevo en Supabase Auth
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION registrar_usuario_nuevo();
