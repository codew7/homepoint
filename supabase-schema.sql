-- =====================================================
-- ESQUEMA DE BASE DE DATOS SUPABASE PARA HOMEPOINT
-- =====================================================
-- Este esquema está diseñado para garantizar integridad referencial,
-- transacciones atómicas y manejo óptimo de concurrencia
-- =====================================================

-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- TABLA: clientes
-- =====================================================
CREATE TABLE IF NOT EXISTS clientes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre VARCHAR(100) NOT NULL,
    telefono VARCHAR(20),
    direccion VARCHAR(200),
    dni VARCHAR(15),
    email VARCHAR(100),
    tipo_cliente VARCHAR(50) NOT NULL DEFAULT 'mayorista' CHECK (tipo_cliente IN ('consumidor final', 'mayorista', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Índices para búsquedas rápidas
    CONSTRAINT unique_nombre UNIQUE (nombre),
    CONSTRAINT unique_email UNIQUE (email)
);

CREATE INDEX idx_clientes_nombre ON clientes(nombre);
CREATE INDEX idx_clientes_email ON clientes(email);
CREATE INDEX idx_clientes_tipo ON clientes(tipo_cliente);

-- =====================================================
-- TABLA: pedidos
-- =====================================================
CREATE TABLE IF NOT EXISTS pedidos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    
    -- Información del pedido
    status VARCHAR(50) NOT NULL DEFAULT 'DESPACHADO/ENTREGADO',
    entrega VARCHAR(20) NOT NULL DEFAULT 'Local' CHECK (entrega IN ('Local', 'Envios')),
    nota TEXT,
    vendedor VARCHAR(100),
    
    -- Datos de pago
    medio_pago VARCHAR(50) NOT NULL,
    recargo INTEGER DEFAULT 0,
    descuento INTEGER DEFAULT 0,
    envio INTEGER DEFAULT 0,
    subtotal INTEGER NOT NULL,
    total_final INTEGER NOT NULL,
    alias VARCHAR(100),
    
    -- Costos y ganancias
    costos INTEGER DEFAULT 0,
    ganancia INTEGER DEFAULT 0,
    ganancia_selec INTEGER DEFAULT 0,
    
    -- Información de dólar
    cotizacion_cierre DECIMAL(10,2),
    costo_usd DECIMAL(10,2),
    
    -- Estado y control
    locked BOOLEAN DEFAULT true,
    admin_viewed BOOLEAN DEFAULT true,
    created_by VARCHAR(50) DEFAULT 'admin',
    last_order_update TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Versión para control de concurrencia optimista
    version INTEGER DEFAULT 1
);

CREATE INDEX idx_pedidos_cliente ON pedidos(cliente_id);
CREATE INDEX idx_pedidos_status ON pedidos(status);
CREATE INDEX idx_pedidos_created_at ON pedidos(created_at DESC);
CREATE INDEX idx_pedidos_vendedor ON pedidos(vendedor);
CREATE INDEX idx_pedidos_medio_pago ON pedidos(medio_pago);

-- =====================================================
-- TABLA: pedido_items
-- =====================================================
CREATE TABLE IF NOT EXISTS pedido_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    
    -- Información del artículo
    codigo VARCHAR(50) NOT NULL,
    codigo_barras VARCHAR(100),
    nombre VARCHAR(200) NOT NULL,
    categoria VARCHAR(100),
    seleccionado VARCHAR(10),
    
    -- Cantidades y valores
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    valor_u INTEGER NOT NULL CHECK (valor_u >= 0),
    valor_c INTEGER DEFAULT 0 CHECK (valor_c >= 0),
    valor_g INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pedido_items_pedido ON pedido_items(pedido_id);
CREATE INDEX idx_pedido_items_codigo ON pedido_items(codigo);
CREATE INDEX idx_pedido_items_nombre ON pedido_items(nombre);

-- =====================================================
-- TABLA: stock
-- =====================================================
CREATE TABLE IF NOT EXISTS stock (
    codigo VARCHAR(50) PRIMARY KEY,
    nombre VARCHAR(200) NOT NULL,
    stock_actual INTEGER NOT NULL DEFAULT 0 CHECK (stock_actual >= 0),
    stock_minimo INTEGER DEFAULT 0,
    stock_maximo INTEGER,
    
    -- Control de concurrencia
    version INTEGER DEFAULT 1,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stock_nombre ON stock(nombre);
CREATE INDEX idx_stock_stock_actual ON stock(stock_actual);

-- =====================================================
-- TABLA: movimientos_inventario
-- =====================================================
CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pedido_id UUID REFERENCES pedidos(id) ON DELETE CASCADE,
    
    -- Información del movimiento
    codigo VARCHAR(50) NOT NULL,
    nombre VARCHAR(200) NOT NULL,
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('ENTRADA', 'SALIDA', 'RETIRO', 'AJUSTE')),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_movimientos_pedido ON movimientos_inventario(pedido_id);
CREATE INDEX idx_movimientos_codigo ON movimientos_inventario(codigo);
CREATE INDEX idx_movimientos_tipo ON movimientos_inventario(tipo);
CREATE INDEX idx_movimientos_created_at ON movimientos_inventario(created_at DESC);

-- =====================================================
-- FUNCIONES Y TRIGGERS PARA ACTUALIZACIÓN AUTOMÁTICA
-- =====================================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para clientes
CREATE TRIGGER update_clientes_updated_at
    BEFORE UPDATE ON clientes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger para pedidos
CREATE TRIGGER update_pedidos_updated_at
    BEFORE UPDATE ON pedidos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger para stock
CREATE TRIGGER update_stock_updated_at
    BEFORE UPDATE ON stock
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- FUNCIÓN PARA ACTUALIZAR STOCK CON CONTROL DE CONCURRENCIA
-- =====================================================
CREATE OR REPLACE FUNCTION actualizar_stock_atomico(
    p_codigo VARCHAR(50),
    p_nombre VARCHAR(200),
    p_cantidad INTEGER,
    p_tipo VARCHAR(20)
)
RETURNS TABLE(success BOOLEAN, nuevo_stock INTEGER, mensaje TEXT) AS $$
DECLARE
    v_stock_actual INTEGER;
    v_nuevo_stock INTEGER;
BEGIN
    -- Bloquear la fila para lectura/escritura (serializable)
    SELECT stock_actual INTO v_stock_actual
    FROM stock
    WHERE codigo = p_codigo
    FOR UPDATE;
    
    -- Si no existe, crear registro
    IF v_stock_actual IS NULL THEN
        INSERT INTO stock (codigo, nombre, stock_actual, version)
        VALUES (p_codigo, p_nombre, 0, 1)
        RETURNING stock_actual INTO v_stock_actual;
    END IF;
    
    -- Calcular nuevo stock según tipo de movimiento
    CASE p_tipo
        WHEN 'ENTRADA' THEN
            v_nuevo_stock := v_stock_actual + p_cantidad;
        WHEN 'SALIDA', 'RETIRO' THEN
            v_nuevo_stock := v_stock_actual - p_cantidad;
        ELSE
            RETURN QUERY SELECT false, v_stock_actual, 'Tipo de movimiento inválido'::TEXT;
            RETURN;
    END CASE;
    
    -- Validar que el stock no sea negativo
    IF v_nuevo_stock < 0 THEN
        v_nuevo_stock := 0;
    END IF;
    
    -- Actualizar stock con incremento de versión
    UPDATE stock
    SET stock_actual = v_nuevo_stock,
        version = version + 1,
        nombre = p_nombre
    WHERE codigo = p_codigo;
    
    RETURN QUERY SELECT true, v_nuevo_stock, 'Stock actualizado correctamente'::TEXT;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN QUERY SELECT false, v_stock_actual, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- FUNCIÓN PARA PROCESAR PEDIDO COMPLETO (TRANSACCIÓN ATÓMICA)
-- =====================================================
CREATE OR REPLACE FUNCTION procesar_pedido_completo(
    p_pedido_data JSONB,
    p_items_data JSONB,
    p_pedido_id UUID DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, pedido_id_resultado UUID, mensaje TEXT) AS $$
DECLARE
    v_pedido_id UUID;
    v_cliente_id UUID;
    v_item JSONB;
    v_mov_previo RECORD;
    v_resultado RECORD;
BEGIN
    -- Iniciar transacción implícita (función ya está en transacción)
    
    -- 1. Obtener o crear cliente
    SELECT id INTO v_cliente_id
    FROM clientes
    WHERE nombre = (p_pedido_data->>'nombre_cliente')
    FOR UPDATE; -- Bloquear para evitar duplicados
    
    IF v_cliente_id IS NULL THEN
        INSERT INTO clientes (nombre, telefono, direccion, dni, email, tipo_cliente)
        VALUES (
            p_pedido_data->>'nombre_cliente',
            p_pedido_data->>'telefono',
            p_pedido_data->>'direccion',
            p_pedido_data->>'dni',
            p_pedido_data->>'email',
            p_pedido_data->>'tipo_cliente'
        )
        RETURNING id INTO v_cliente_id;
    END IF;
    
    -- 2. Si es actualización, restaurar stock de movimientos previos
    IF p_pedido_id IS NOT NULL THEN
        -- Restaurar stock de movimientos previos tipo SALIDA
        FOR v_mov_previo IN 
            SELECT codigo, nombre, cantidad
            FROM movimientos_inventario
            WHERE pedido_id = p_pedido_id AND tipo = 'SALIDA'
        LOOP
            -- Restaurar stock (entrada inversa)
            SELECT * INTO v_resultado
            FROM actualizar_stock_atomico(
                v_mov_previo.codigo,
                v_mov_previo.nombre,
                v_mov_previo.cantidad,
                'ENTRADA'
            );
            
            IF NOT v_resultado.success THEN
                RAISE EXCEPTION 'Error restaurando stock: %', v_resultado.mensaje;
            END IF;
        END LOOP;
        
        -- Eliminar movimientos previos
        DELETE FROM movimientos_inventario WHERE pedido_id = p_pedido_id;
        
        -- Eliminar items previos
        DELETE FROM pedido_items WHERE pedido_id = p_pedido_id;
        
        -- Actualizar pedido
        UPDATE pedidos
        SET cliente_id = v_cliente_id,
            status = p_pedido_data->>'status',
            entrega = p_pedido_data->>'entrega',
            nota = p_pedido_data->>'nota',
            vendedor = p_pedido_data->>'vendedor',
            medio_pago = p_pedido_data->>'medio_pago',
            recargo = (p_pedido_data->>'recargo')::INTEGER,
            descuento = (p_pedido_data->>'descuento')::INTEGER,
            envio = (p_pedido_data->>'envio')::INTEGER,
            subtotal = (p_pedido_data->>'subtotal')::INTEGER,
            total_final = (p_pedido_data->>'total_final')::INTEGER,
            alias = p_pedido_data->>'alias',
            costos = (p_pedido_data->>'costos')::INTEGER,
            ganancia = (p_pedido_data->>'ganancia')::INTEGER,
            ganancia_selec = (p_pedido_data->>'ganancia_selec')::INTEGER,
            cotizacion_cierre = (p_pedido_data->>'cotizacion_cierre')::DECIMAL,
            costo_usd = (p_pedido_data->>'costo_usd')::DECIMAL,
            version = version + 1
        WHERE id = p_pedido_id;
        
        v_pedido_id := p_pedido_id;
    ELSE
        -- Crear nuevo pedido
        INSERT INTO pedidos (
            cliente_id, status, entrega, nota, vendedor,
            medio_pago, recargo, descuento, envio, subtotal, total_final, alias,
            costos, ganancia, ganancia_selec,
            cotizacion_cierre, costo_usd,
            locked, admin_viewed, created_by
        )
        VALUES (
            v_cliente_id,
            p_pedido_data->>'status',
            p_pedido_data->>'entrega',
            p_pedido_data->>'nota',
            p_pedido_data->>'vendedor',
            p_pedido_data->>'medio_pago',
            (p_pedido_data->>'recargo')::INTEGER,
            (p_pedido_data->>'descuento')::INTEGER,
            (p_pedido_data->>'envio')::INTEGER,
            (p_pedido_data->>'subtotal')::INTEGER,
            (p_pedido_data->>'total_final')::INTEGER,
            p_pedido_data->>'alias',
            (p_pedido_data->>'costos')::INTEGER,
            (p_pedido_data->>'ganancia')::INTEGER,
            (p_pedido_data->>'ganancia_selec')::INTEGER,
            (p_pedido_data->>'cotizacion_cierre')::DECIMAL,
            (p_pedido_data->>'costo_usd')::DECIMAL,
            true,
            true,
            COALESCE(p_pedido_data->>'created_by', 'admin')
        )
        RETURNING id INTO v_pedido_id;
    END IF;
    
    -- 3. Insertar items del pedido
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items_data)
    LOOP
        INSERT INTO pedido_items (
            pedido_id, codigo, codigo_barras, nombre, categoria, seleccionado,
            cantidad, valor_u, valor_c, valor_g
        )
        VALUES (
            v_pedido_id,
            v_item->>'codigo',
            v_item->>'codigoBarras',
            v_item->>'nombre',
            v_item->>'categoria',
            v_item->>'seleccionado',
            (v_item->>'cantidad')::INTEGER,
            (v_item->>'valorU')::INTEGER,
            (v_item->>'valorC')::INTEGER,
            (v_item->>'valorG')::INTEGER
        );
        
        -- 4. Registrar movimiento de inventario
        INSERT INTO movimientos_inventario (
            pedido_id, codigo, nombre, cantidad, tipo
        )
        VALUES (
            v_pedido_id,
            v_item->>'codigo',
            v_item->>'nombre',
            (v_item->>'cantidad')::INTEGER,
            'SALIDA'
        );
        
        -- 5. Actualizar stock
        SELECT * INTO v_resultado
        FROM actualizar_stock_atomico(
            v_item->>'codigo',
            v_item->>'nombre',
            (v_item->>'cantidad')::INTEGER,
            'SALIDA'
        );
        
        IF NOT v_resultado.success THEN
            RAISE EXCEPTION 'Error actualizando stock para %: %', 
                v_item->>'nombre', v_resultado.mensaje;
        END IF;
    END LOOP;
    
    -- Retornar resultado exitoso
    RETURN QUERY SELECT true, v_pedido_id, 'Pedido procesado correctamente'::TEXT;
    
EXCEPTION
    WHEN OTHERS THEN
        -- En caso de error, PostgreSQL hace rollback automático
        RETURN QUERY SELECT false, NULL::UUID, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- POLÍTICAS DE SEGURIDAD RLS (Row Level Security)
-- =====================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_inventario ENABLE ROW LEVEL SECURITY;

-- Políticas para usuarios autenticados (ajustar según necesidades)
-- Por ahora, permitir todo para usuarios autenticados

CREATE POLICY "Permitir todo a usuarios autenticados" ON clientes
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Permitir todo a usuarios autenticados" ON pedidos
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Permitir todo a usuarios autenticados" ON pedido_items
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Permitir todo a usuarios autenticados" ON stock
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Permitir todo a usuarios autenticados" ON movimientos_inventario
    FOR ALL USING (auth.role() = 'authenticated');

-- =====================================================
-- VISTAS ÚTILES
-- =====================================================

-- Vista de pedidos con información de cliente
CREATE OR REPLACE VIEW vista_pedidos_completos AS
SELECT 
    p.id,
    p.created_at,
    p.updated_at,
    p.status,
    p.entrega,
    p.vendedor,
    p.medio_pago,
    p.subtotal,
    p.total_final,
    p.ganancia,
    p.alias,
    c.nombre as cliente_nombre,
    c.telefono as cliente_telefono,
    c.direccion as cliente_direccion,
    c.tipo_cliente,
    (SELECT COUNT(*) FROM pedido_items WHERE pedido_id = p.id) as cantidad_items,
    (SELECT SUM(cantidad) FROM pedido_items WHERE pedido_id = p.id) as total_unidades
FROM pedidos p
JOIN clientes c ON p.cliente_id = c.id;

-- Vista de movimientos con stock resultante
CREATE OR REPLACE VIEW vista_movimientos_stock AS
SELECT 
    m.id,
    m.created_at,
    m.codigo,
    m.nombre,
    m.cantidad,
    m.tipo,
    m.pedido_id,
    s.stock_actual as stock_resultante
FROM movimientos_inventario m
LEFT JOIN stock s ON m.codigo = s.codigo
ORDER BY m.created_at DESC;

-- =====================================================
-- COMENTARIOS PARA DOCUMENTACIÓN
-- =====================================================

COMMENT ON TABLE clientes IS 'Tabla de clientes con información de contacto y tipo';
COMMENT ON TABLE pedidos IS 'Tabla principal de pedidos con control de versión para concurrencia';
COMMENT ON TABLE pedido_items IS 'Items individuales de cada pedido';
COMMENT ON TABLE stock IS 'Inventario actual de artículos con control de concurrencia';
COMMENT ON TABLE movimientos_inventario IS 'Historial de movimientos de inventario vinculados a pedidos';

COMMENT ON FUNCTION actualizar_stock_atomico IS 'Función atómica para actualizar stock con manejo de concurrencia';
COMMENT ON FUNCTION procesar_pedido_completo IS 'Función para procesar pedido completo en una transacción atómica';

-- =====================================================
-- FIN DEL ESQUEMA
-- =====================================================
