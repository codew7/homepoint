// =====================================================
// INGRESO DE PEDIDOS CON SUPABASE - VERSIÓN MIGRADA
// =====================================================
// Este archivo contiene las funciones críticas migradas de Firebase a Supabase
// Mantiene la misma interfaz de usuario pero usa Supabase para persistencia
// =====================================================

// =====================================================
// FUNCIONES DE MIGRACIÓN CRÍTICAS
// =====================================================

/**
 * Reemplaza: db.ref('clientes').once('value')
 * Carga todos los clientes desde Supabase
 */
async function cargarClientesSupabase() {
    if (!window.supabaseDB) {
        console.error('SupabaseDB no inicializado');
        return;
    }

    try {
        const clientes = await window.supabaseDB.obtenerTodosLosClientes();
        
        // Actualizar estructuras globales (mantener compatibilidad)
        window.clientesRegistrados = clientes;
        window.clientesPorNombre = {};
        
        const datalistClientes = document.getElementById('clientesDatalist');
        if (datalistClientes) {
            datalistClientes.innerHTML = '';
        }
        
        clientes.forEach(cli => {
            if (cli && cli.nombre) {
                window.clientesPorNombre[cli.nombre.toLowerCase()] = {
                    nombre: cli.nombre,
                    telefono: cli.telefono,
                    direccion: cli.direccion,
                    dni: cli.dni,
                    email: cli.email,
                    tipoCliente: cli.tipo_cliente,
                };
                
                if (datalistClientes) {
                    const opt = document.createElement('option');
                    opt.value = cli.nombre;
                    datalistClientes.appendChild(opt);
                }
            }
        });
        
        console.log(`✓ Cargados ${clientes.length} clientes desde Supabase`);
    } catch (error) {
        console.error('Error cargando clientes desde Supabase:', error);
    }
}

/**
 * Reemplaza: db.ref('pedidos').orderByChild('timestamp').limitToLast(200)
 * Carga historial de alias desde Supabase
 */
async function cargarHistorialAliasSupabase() {
    if (!window.supabaseDB) {
        console.error('SupabaseDB no inicializado');
        return;
    }

    try {
        const aliasUnicos = await window.supabaseDB.obtenerHistorialAlias(10);
        
        const datalistAlias = document.getElementById('aliasDatalist');
        if (datalistAlias) {
            datalistAlias.innerHTML = '';
            aliasUnicos.forEach(alias => {
                const option = document.createElement('option');
                option.value = alias;
                datalistAlias.appendChild(option);
            });
        }
        
        console.log(`✓ Cargados ${aliasUnicos.length} alias desde Supabase`);
    } catch (error) {
        console.error('Error cargando historial de alias:', error);
    }
}

/**
 * Reemplaza: db.ref('pedidos/' + pedidoId).once('value')
 * Carga un pedido completo desde Supabase
 */
async function cargarPedidoSupabase(pedidoId) {
    if (!window.supabaseDB) {
        console.error('SupabaseDB no inicializado');
        return null;
    }

    try {
        const pedido = await window.supabaseDB.obtenerPedidoPorId(pedidoId);
        
        if (!pedido) {
            console.warn(`Pedido ${pedidoId} no encontrado`);
            return null;
        }
        
        console.log(`✓ Pedido ${pedidoId} cargado desde Supabase`);
        return pedido;
    } catch (error) {
        console.error('Error cargando pedido:', error);
        return null;
    }
}

/**
 * Reemplaza: pedidoRef.set(pedidoObj) y db.ref('pedidos/' + pedidoId).set(pedidoObj)
 * Guarda o actualiza un pedido completo usando transacciones atómicas
 */
async function guardarPedidoSupabase(pedidoData, items, pedidoId = null) {
    if (!window.supabaseDB) {
        throw new Error('SupabaseDB no inicializado');
    }

    try {
        console.log('Iniciando proceso de guardado en Supabase...');
        console.log('Pedido ID:', pedidoId || 'NUEVO');
        console.log('Items:', items.length);
        
        // Usar la función de transacción atómica de PostgreSQL
        const resultado = await window.supabaseDB.procesarPedidoCompleto(
            pedidoData,
            items,
            pedidoId
        );
        
        if (!resultado.success) {
            throw new Error(resultado.mensaje || 'Error procesando pedido');
        }
        
        console.log('✓ Pedido guardado correctamente en Supabase');
        console.log('ID del pedido:', resultado.pedidoId);
        
        return {
            success: true,
            pedidoId: resultado.pedidoId,
            mensaje: resultado.mensaje,
        };
    } catch (error) {
        console.error('❌ Error guardando pedido en Supabase:', error);
        throw error;
    }
}

/**
 * Reemplaza: registrarMovimientosInventario con Firebase
 * Los movimientos ahora se procesan automáticamente en la función PostgreSQL
 * Esta función queda vacía pero se mantiene por compatibilidad
 */
async function registrarMovimientosInventarioSupabase(items, cotizacionCierre, pedidoId) {
    // Los movimientos de inventario ya se procesaron en procesar_pedido_completo
    // Esta función se mantiene solo por compatibilidad
    console.log('✓ Movimientos de inventario procesados automáticamente en Supabase');
    return true;
}

/**
 * Reemplaza: actualizarStock con transacciones de Firebase
 * Actualiza stock usando función atómica de PostgreSQL
 */
async function actualizarStockSupabase(codigo, nombre, cantidad, tipo) {
    if (!window.supabaseDB) {
        throw new Error('SupabaseDB no inicializado');
    }

    try {
        const resultado = await window.supabaseDB.actualizarStockAtomico(
            codigo,
            nombre,
            cantidad,
            tipo
        );
        
        if (!resultado.success) {
            throw new Error(resultado.mensaje || 'Error actualizando stock');
        }
        
        console.log(`✓ Stock actualizado: ${codigo} -> ${resultado.nuevoStock}`);
        return resultado;
    } catch (error) {
        console.error('Error actualizando stock:', error);
        throw error;
    }
}

/**
 * Reemplaza: db.ref('clientes').push() o update
 * Guarda o actualiza un cliente en Supabase
 */
async function guardarClienteSupabase(clienteData) {
    if (!window.supabaseDB) {
        throw new Error('SupabaseDB no inicializado');
    }

    try {
        const clienteGuardado = await window.supabaseDB.guardarCliente({
            nombre: clienteData.nombre,
            telefono: clienteData.telefono || '',
            direccion: clienteData.direccion || '',
            dni: clienteData.dni || '',
            email: clienteData.email || '',
            tipo_cliente: clienteData.tipoCliente || 'mayorista',
        });
        
        console.log('✓ Cliente guardado en Supabase:', clienteGuardado.nombre);
        
        // Recargar lista de clientes
        await cargarClientesSupabase();
        
        return clienteGuardado;
    } catch (error) {
        console.error('Error guardando cliente:', error);
        throw error;
    }
}

// =====================================================
// FUNCIONES AUXILIARES DE MIGRACIÓN
// =====================================================

/**
 * Convierte objeto de pedido del formato interno al formato de Supabase
 */
function convertirPedidoAFormatoSupabase(pedidoObj) {
    return {
        cliente: {
            nombre: pedidoObj.cliente.nombre,
            telefono: pedidoObj.cliente.telefono || '',
            direccion: pedidoObj.cliente.direccion || '',
            dni: pedidoObj.cliente.dni || '',
            email: pedidoObj.cliente.email || '',
            tipoCliente: pedidoObj.cliente.tipoCliente || 'mayorista',
        },
        status: pedidoObj.status || 'DESPACHADO/ENTREGADO',
        entrega: pedidoObj.entrega || 'Local',
        nota: pedidoObj.nota || '',
        vendedor: pedidoObj.vendedor || '',
        pagos: {
            medioPago: pedidoObj.pagos.medioPago,
            recargo: pedidoObj.pagos.recargo || 0,
            descuento: pedidoObj.pagos.descuento || 0,
            envio: pedidoObj.pagos.envio || 0,
            subtotal: pedidoObj.pagos.subtotal,
            totalFinal: pedidoObj.pagos.totalFinal,
            alias: pedidoObj.pagos.alias || '',
            costos: pedidoObj.pagos.costos || 0,
            ganancia: pedidoObj.pagos.ganancia || 0,
            gananciaSelec: pedidoObj.pagos.gananciaSelec || 0,
        },
        cotizacionCierre: pedidoObj.cotizacionCierre,
        costoUSD: pedidoObj.costoUSD,
        locked: pedidoObj.locked !== false,
        adminViewed: pedidoObj.adminViewed !== false,
        createdby: pedidoObj.createdby || 'admin',
        lastOrderUpdate: pedidoObj.lastOrderUpdate || null,
    };
}

/**
 * Verifica si Supabase está correctamente inicializado
 */
function verificarSupabaseInicializado() {
    if (!window.supabase) {
        console.error('❌ Cliente de Supabase no inicializado');
        console.error('Asegúrate de incluir el SDK de Supabase en el HTML');
        return false;
    }
    
    if (!window.supabaseDB) {
        console.error('❌ Capa de abstracción de Supabase no inicializada');
        console.error('Llama a inicializarSupabaseDB() después de cargar supabaseDB.js');
        return false;
    }
    
    return true;
}

/**
 * Inicializa todas las funciones de migración
 */
async function inicializarMigracionSupabase() {
    console.log('=== INICIANDO MIGRACIÓN A SUPABASE ===');
    
    if (!verificarSupabaseInicializado()) {
        console.error('❌ No se puede inicializar la migración');
        return false;
    }
    
    try {
        // Verificar conexión
        const conexionOk = await window.supabaseDB.verificarConexion();
        if (!conexionOk) {
            throw new Error('No se pudo conectar a Supabase');
        }
        console.log('✓ Conexión con Supabase establecida');
        
        // Cargar datos iniciales
        await cargarClientesSupabase();
        await cargarHistorialAliasSupabase();
        
        console.log('✓ Migración a Supabase completada');
        return true;
    } catch (error) {
        console.error('❌ Error en la migración a Supabase:', error);
        return false;
    }
}

// =====================================================
// EXPORTAR FUNCIONES GLOBALMENTE
// =====================================================
window.cargarClientesSupabase = cargarClientesSupabase;
window.cargarHistorialAliasSupabase = cargarHistorialAliasSupabase;
window.cargarPedidoSupabase = cargarPedidoSupabase;
window.guardarPedidoSupabase = guardarPedidoSupabase;
window.registrarMovimientosInventarioSupabase = registrarMovimientosInventarioSupabase;
window.actualizarStockSupabase = actualizarStockSupabase;
window.guardarClienteSupabase = guardarClienteSupabase;
window.convertirPedidoAFormatoSupabase = convertirPedidoAFormatoSupabase;
window.inicializarMigracionSupabase = inicializarMigracionSupabase;

console.log('✓ Módulo de migración a Supabase cargado');
