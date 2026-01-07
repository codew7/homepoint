// =====================================================
// CAPA DE ABSTRACCIÓN PARA OPERACIONES DE SUPABASE
// =====================================================
// Este módulo proporciona funciones robustas y reutilizables
// para interactuar con Supabase con manejo de transacciones
// atómicas y control de concurrencia
// =====================================================

/**
 * Clase principal para manejar operaciones de base de datos
 */
class SupabaseDB {
    constructor() {
        if (!window.supabase) {
            throw new Error('Supabase client no inicializado');
        }
        this.client = window.supabase;
    }

    // =====================================================
    // OPERACIONES CON CLIENTES
    // =====================================================

    /**
     * Busca un cliente por nombre (case-insensitive)
     * @param {string} nombre - Nombre del cliente
     * @returns {Promise<Object|null>} Cliente encontrado o null
     */
    async buscarClientePorNombre(nombre) {
        try {
            const { data, error } = await this.client
                .from('clientes')
                .select('*')
                .ilike('nombre', nombre)
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
                throw error;
            }

            return data;
        } catch (error) {
            console.error('Error buscando cliente:', error);
            return null;
        }
    }

    /**
     * Obtiene todos los clientes ordenados por nombre
     * @returns {Promise<Array>} Lista de clientes
     */
    async obtenerTodosLosClientes() {
        try {
            const { data, error } = await this.client
                .from('clientes')
                .select('*')
                .order('nombre', { ascending: true });

            if (error) throw error;

            return data || [];
        } catch (error) {
            console.error('Error obteniendo clientes:', error);
            return [];
        }
    }

    /**
     * Crea o actualiza un cliente
     * @param {Object} clienteData - Datos del cliente
     * @returns {Promise<Object>} Cliente creado/actualizado
     */
    async guardarCliente(clienteData) {
        try {
            // Normalizar nombre para búsqueda
            const nombreNormalizado = clienteData.nombre.trim();

            // Verificar si existe
            const clienteExistente = await this.buscarClientePorNombre(nombreNormalizado);

            if (clienteExistente) {
                // Actualizar cliente existente
                const { data, error } = await this.client
                    .from('clientes')
                    .update({
                        telefono: clienteData.telefono || clienteExistente.telefono,
                        direccion: clienteData.direccion || clienteExistente.direccion,
                        dni: clienteData.dni || clienteExistente.dni,
                        email: clienteData.email || clienteExistente.email,
                        tipo_cliente: clienteData.tipo_cliente || clienteExistente.tipo_cliente,
                    })
                    .eq('id', clienteExistente.id)
                    .select()
                    .single();

                if (error) throw error;
                return data;
            } else {
                // Crear nuevo cliente
                const { data, error } = await this.client
                    .from('clientes')
                    .insert({
                        nombre: nombreNormalizado,
                        telefono: clienteData.telefono || '',
                        direccion: clienteData.direccion || '',
                        dni: clienteData.dni || '',
                        email: clienteData.email || '',
                        tipo_cliente: clienteData.tipo_cliente || 'mayorista',
                    })
                    .select()
                    .single();

                if (error) throw error;
                return data;
            }
        } catch (error) {
            console.error('Error guardando cliente:', error);
            throw new Error(`Error al guardar cliente: ${error.message}`);
        }
    }

    // =====================================================
    // OPERACIONES CON PEDIDOS (TRANSACCIONES ATÓMICAS)
    // =====================================================

    /**
     * Procesa un pedido completo usando la función PostgreSQL
     * que garantiza atomicidad de toda la operación
     * @param {Object} pedidoData - Datos del pedido
     * @param {Array} items - Items del pedido
     * @param {string} pedidoId - ID del pedido (para actualizaciones)
     * @returns {Promise<Object>} Resultado de la operación
     */
    async procesarPedidoCompleto(pedidoData, items, pedidoId = null) {
        try {
            // Preparar datos para la función PostgreSQL
            const pedidoJson = {
                nombre_cliente: pedidoData.cliente.nombre,
                telefono: pedidoData.cliente.telefono || '',
                direccion: pedidoData.cliente.direccion || '',
                dni: pedidoData.cliente.dni || '',
                email: pedidoData.cliente.email || '',
                tipo_cliente: pedidoData.cliente.tipoCliente || 'mayorista',
                status: pedidoData.status || 'DESPACHADO/ENTREGADO',
                entrega: pedidoData.entrega || 'Local',
                nota: pedidoData.nota || '',
                vendedor: pedidoData.vendedor || '',
                medio_pago: pedidoData.pagos.medioPago,
                recargo: pedidoData.pagos.recargo || 0,
                descuento: pedidoData.pagos.descuento || 0,
                envio: pedidoData.pagos.envio || 0,
                subtotal: pedidoData.pagos.subtotal,
                total_final: pedidoData.pagos.totalFinal,
                alias: pedidoData.pagos.alias || '',
                costos: pedidoData.pagos.costos || 0,
                ganancia: pedidoData.pagos.ganancia || 0,
                ganancia_selec: pedidoData.pagos.gananciaSelec || 0,
                cotizacion_cierre: pedidoData.cotizacionCierre || 0,
                costo_usd: pedidoData.costoUSD || 0,
                created_by: pedidoData.createdby || 'admin',
            };

            // Preparar items
            const itemsJson = items.map(item => ({
                codigo: item.codigo || '',
                codigoBarras: item.codigoBarras || '',
                nombre: item.nombre,
                categoria: item.categoria || '',
                seleccionado: item.seleccionado || '',
                cantidad: item.cantidad,
                valorU: item.valorU,
                valorC: item.valorC || 0,
                valorG: item.valorG || 0,
            }));

            // Ejecutar función PostgreSQL
            const { data, error } = await this.client
                .rpc('procesar_pedido_completo', {
                    p_pedido_data: pedidoJson,
                    p_items_data: itemsJson,
                    p_pedido_id: pedidoId,
                });

            if (error) throw error;

            // Verificar resultado
            if (!data || data.length === 0 || !data[0].success) {
                throw new Error(data?.[0]?.mensaje || 'Error procesando pedido');
            }

            return {
                success: true,
                pedidoId: data[0].pedido_id_resultado,
                mensaje: data[0].mensaje,
            };
        } catch (error) {
            console.error('Error procesando pedido completo:', error);
            throw new Error(`Error al procesar pedido: ${error.message}`);
        }
    }

    /**
     * Obtiene un pedido por ID con todos sus items
     * @param {string} pedidoId - ID del pedido
     * @returns {Promise<Object>} Pedido completo con items y cliente
     */
    async obtenerPedidoPorId(pedidoId) {
        try {
            // Obtener pedido con cliente
            const { data: pedido, error: errorPedido } = await this.client
                .from('pedidos')
                .select(`
                    *,
                    cliente:clientes (*)
                `)
                .eq('id', pedidoId)
                .single();

            if (errorPedido) throw errorPedido;
            if (!pedido) return null;

            // Obtener items del pedido
            const { data: items, error: errorItems } = await this.client
                .from('pedido_items')
                .select('*')
                .eq('pedido_id', pedidoId)
                .order('created_at', { ascending: true });

            if (errorItems) throw errorItems;

            // Formatear respuesta para mantener compatibilidad con código existente
            return {
                id: pedido.id,
                status: pedido.status,
                timestamp: new Date(pedido.created_at).getTime(),
                locked: pedido.locked,
                adminViewed: pedido.admin_viewed,
                cliente: {
                    nombre: pedido.cliente.nombre,
                    telefono: pedido.cliente.telefono,
                    direccion: pedido.cliente.direccion,
                    dni: pedido.cliente.dni,
                    email: pedido.cliente.email,
                    tipoCliente: pedido.cliente.tipo_cliente,
                },
                items: items.map(item => ({
                    codigo: item.codigo,
                    codigoBarras: item.codigo_barras,
                    nombre: item.nombre,
                    categoria: item.categoria,
                    seleccionado: item.seleccionado,
                    cantidad: item.cantidad,
                    valorU: item.valor_u,
                    valorC: item.valor_c,
                    valorG: item.valor_g,
                })),
                pagos: {
                    medioPago: pedido.medio_pago,
                    recargo: pedido.recargo,
                    descuento: pedido.descuento,
                    envio: pedido.envio,
                    subtotal: pedido.subtotal,
                    totalFinal: pedido.total_final,
                    alias: pedido.alias,
                    costos: pedido.costos,
                    ganancia: pedido.ganancia,
                    gananciaSelec: pedido.ganancia_selec,
                },
                cotizacionCierre: pedido.cotizacion_cierre,
                costoUSD: pedido.costo_usd,
                entrega: pedido.entrega,
                nota: pedido.nota,
                vendedor: pedido.vendedor,
                createdby: pedido.created_by,
                lastOrderUpdate: pedido.last_order_update,
                fecha: pedido.created_at,
            };
        } catch (error) {
            console.error('Error obteniendo pedido:', error);
            return null;
        }
    }

    /**
     * Obtiene pedidos recientes con paginación
     * @param {number} limite - Número de pedidos a obtener
     * @param {number} offset - Offset para paginación
     * @returns {Promise<Array>} Lista de pedidos
     */
    async obtenerPedidosRecientes(limite = 50, offset = 0) {
        try {
            const { data, error } = await this.client
                .from('vista_pedidos_completos')
                .select('*')
                .order('created_at', { ascending: false })
                .range(offset, offset + limite - 1);

            if (error) throw error;

            return data || [];
        } catch (error) {
            console.error('Error obteniendo pedidos recientes:', error);
            return [];
        }
    }

    /**
     * Obtiene historial de alias únicos ordenados por uso reciente
     * @param {number} limite - Número de alias a obtener
     * @returns {Promise<Array>} Lista de alias
     */
    async obtenerHistorialAlias(limite = 10) {
        try {
            const { data, error } = await this.client
                .from('pedidos')
                .select('alias, created_at')
                .not('alias', 'is', null)
                .neq('alias', '')
                .order('created_at', { ascending: false })
                .limit(200); // Obtener más para filtrar únicos

            if (error) throw error;

            // Filtrar únicos y limitar
            const aliasUnicos = [];
            const aliasSet = new Set();

            for (const pedido of data || []) {
                const alias = pedido.alias.trim().toUpperCase();
                if (alias && !aliasSet.has(alias) && aliasUnicos.length < limite) {
                    aliasSet.add(alias);
                    aliasUnicos.push(alias);
                }
            }

            return aliasUnicos;
        } catch (error) {
            console.error('Error obteniendo historial alias:', error);
            return [];
        }
    }

    // =====================================================
    // OPERACIONES CON STOCK
    // =====================================================

    /**
     * Actualiza el stock de un artículo de forma atómica
     * @param {string} codigo - Código del artículo
     * @param {string} nombre - Nombre del artículo
     * @param {number} cantidad - Cantidad a modificar
     * @param {string} tipo - Tipo de movimiento (ENTRADA, SALIDA, RETIRO)
     * @returns {Promise<Object>} Resultado de la operación
     */
    async actualizarStockAtomico(codigo, nombre, cantidad, tipo) {
        try {
            const { data, error } = await this.client
                .rpc('actualizar_stock_atomico', {
                    p_codigo: codigo,
                    p_nombre: nombre,
                    p_cantidad: cantidad,
                    p_tipo: tipo,
                });

            if (error) throw error;

            if (!data || data.length === 0 || !data[0].success) {
                throw new Error(data?.[0]?.mensaje || 'Error actualizando stock');
            }

            return {
                success: true,
                nuevoStock: data[0].nuevo_stock,
                mensaje: data[0].mensaje,
            };
        } catch (error) {
            console.error('Error actualizando stock:', error);
            throw new Error(`Error al actualizar stock: ${error.message}`);
        }
    }

    /**
     * Obtiene el stock actual de un artículo
     * @param {string} codigo - Código del artículo
     * @returns {Promise<Object|null>} Información del stock
     */
    async obtenerStock(codigo) {
        try {
            const { data, error } = await this.client
                .from('stock')
                .select('*')
                .eq('codigo', codigo)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            return data;
        } catch (error) {
            console.error('Error obteniendo stock:', error);
            return null;
        }
    }

    // =====================================================
    // OPERACIONES CON MOVIMIENTOS DE INVENTARIO
    // =====================================================

    /**
     * Obtiene los movimientos de inventario de un pedido
     * @param {string} pedidoId - ID del pedido
     * @returns {Promise<Array>} Lista de movimientos
     */
    async obtenerMovimientosPorPedido(pedidoId) {
        try {
            const { data, error } = await this.client
                .from('movimientos_inventario')
                .select('*')
                .eq('pedido_id', pedidoId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            return data || [];
        } catch (error) {
            console.error('Error obteniendo movimientos:', error);
            return [];
        }
    }

    /**
     * Obtiene el historial de movimientos con paginación
     * @param {number} limite - Número de movimientos a obtener
     * @param {number} offset - Offset para paginación
     * @returns {Promise<Array>} Lista de movimientos
     */
    async obtenerHistorialMovimientos(limite = 100, offset = 0) {
        try {
            const { data, error } = await this.client
                .from('vista_movimientos_stock')
                .select('*')
                .order('created_at', { ascending: false })
                .range(offset, offset + limite - 1);

            if (error) throw error;

            return data || [];
        } catch (error) {
            console.error('Error obteniendo historial de movimientos:', error);
            return [];
        }
    }

    // =====================================================
    // UTILIDADES
    // =====================================================

    /**
     * Verifica la conexión con Supabase
     * @returns {Promise<boolean>} true si la conexión es exitosa
     */
    async verificarConexion() {
        try {
            const { error } = await this.client
                .from('clientes')
                .select('count')
                .limit(1);

            return !error;
        } catch (error) {
            console.error('Error verificando conexión:', error);
            return false;
        }
    }

    /**
     * Obtiene información del usuario autenticado
     * @returns {Promise<Object|null>} Usuario autenticado
     */
    async obtenerUsuarioActual() {
        try {
            const { data: { user }, error } = await this.client.auth.getUser();
            
            if (error) throw error;
            
            return user;
        } catch (error) {
            console.error('Error obteniendo usuario actual:', error);
            return null;
        }
    }

    /**
     * Cierra sesión del usuario actual
     * @returns {Promise<boolean>} true si el cierre de sesión fue exitoso
     */
    async cerrarSesion() {
        try {
            const { error } = await this.client.auth.signOut();
            
            if (error) throw error;
            
            return true;
        } catch (error) {
            console.error('Error cerrando sesión:', error);
            return false;
        }
    }
}

// =====================================================
// INSTANCIA GLOBAL
// =====================================================
// Se creará después de inicializar el cliente de Supabase
let supabaseDB = null;

/**
 * Inicializa la capa de abstracción de Supabase
 * Debe llamarse después de inicializar el cliente de Supabase
 */
function inicializarSupabaseDB() {
    if (!window.supabase) {
        console.error('Cliente de Supabase no encontrado');
        return null;
    }
    
    supabaseDB = new SupabaseDB();
    console.log('✓ Capa de abstracción de Supabase inicializada');
    return supabaseDB;
}

// Exportar para uso global
window.SupabaseDB = SupabaseDB;
window.inicializarSupabaseDB = inicializarSupabaseDB;
