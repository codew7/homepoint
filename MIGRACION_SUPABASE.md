# 🚀 Migración de Firebase a Supabase - Homepoint

## 📋 Resumen de la Migración

Este documento describe la migración completa del sistema de gestión de pedidos de Firebase Realtime Database a Supabase PostgreSQL, implementando **transacciones atómicas** y **control de concurrencia** para garantizar la integridad de los datos.

---

## 🎯 Objetivos Cumplidos

✅ **Transacciones Atómicas**: Todas las operaciones críticas (pedidos + items + stock + movimientos) se ejecutan en una única transacción.

✅ **Control de Concurrencia**: Uso de bloqueos optimistas (versioning) y bloqueos pesimistas (FOR UPDATE) para evitar condiciones de carrera.

✅ **Integridad Referencial**: Relaciones definidas a nivel de base de datos con claves foráneas y constraints.

✅ **Funciones Almacenadas**: Lógica de negocio crítica implementada en PostgreSQL para máxima atomicidad.

✅ **Rollback Automático**: Si cualquier operación falla, toda la transacción se revierte automáticamente.

---

## 📁 Archivos Creados/Modificados

### **Nuevos Archivos**

1. **`supabase-schema.sql`** - Esquema completo de base de datos
   - Tablas normalizadas con constraints
   - Funciones almacenadas para transacciones atómicas
   - Triggers para auditoría automática
   - Políticas RLS (Row Level Security)
   - Vistas optimizadas para consultas frecuentes

2. **`configSupabase.js`** - Configuración de Supabase
   - Credenciales del proyecto
   - Configuración de API keys
   - Instrucciones de configuración

3. **`supabaseDB.js`** - Capa de abstracción
   - Clase `SupabaseDB` con métodos reutilizables
   - Manejo de errores robusto
   - Conversión de formatos entre Firebase y Supabase

4. **`ingresoPedidoSupabase.js`** - Funciones de migración
   - Wrappers para compatibilidad con código existente
   - Funciones de conversión de datos
   - Inicialización y verificación

### **Archivos Modificados**

1. **`ingresoPedidoSB.html`**
   - Agregado SDK de Supabase
   - Carga de scripts de migración
   - Inicialización dual (Firebase + Supabase)

2. **`ingresoPedidoSB.js`**
   - Reemplazadas operaciones de Firebase con Supabase
   - Mantenida compatibilidad con interfaz existente
   - Agregado manejo de transacciones atómicas

---

## 🗄️ Estructura de Base de Datos

### **Tablas Principales**

#### 1. `clientes`
```sql
id (UUID PK)
nombre (VARCHAR, UNIQUE)
telefono, direccion, dni, email
tipo_cliente (consumidor final | mayorista | admin)
created_at, updated_at
```

#### 2. `pedidos`
```sql
id (UUID PK)
cliente_id (FK → clientes)
status, entrega, nota, vendedor
medio_pago, recargo, descuento, envio
subtotal, total_final
costos, ganancia, ganancia_selec
cotizacion_cierre, costo_usd
version (para concurrencia optimista)
created_at, updated_at
```

#### 3. `pedido_items`
```sql
id (UUID PK)
pedido_id (FK → pedidos, CASCADE)
codigo, codigo_barras, nombre
categoria, seleccionado
cantidad, valor_u, valor_c, valor_g
created_at
```

#### 4. `stock`
```sql
codigo (VARCHAR PK)
nombre, stock_actual
stock_minimo, stock_maximo
version (para concurrencia optimista)
created_at, updated_at
```

#### 5. `movimientos_inventario`
```sql
id (UUID PK)
pedido_id (FK → pedidos, CASCADE)
codigo, nombre, cantidad
tipo (ENTRADA | SALIDA | RETIRO | AJUSTE)
created_at
```

---

## 🔐 Funciones de Transacción Atómica

### **1. `actualizar_stock_atomico()`**

Actualiza el stock de un artículo de forma atómica con control de concurrencia.

**Características:**
- Bloqueo pesimista con `FOR UPDATE`
- Validación de stock negativo
- Incremento automático de versión
- Creación automática si no existe

**Uso:**
```javascript
const resultado = await supabaseDB.actualizarStockAtomico(
  'ART001',      // código
  'Producto X',  // nombre
  5,             // cantidad
  'SALIDA'       // tipo
);
```

### **2. `procesar_pedido_completo()`**

Procesa un pedido completo en una única transacción atómica.

**Operaciones incluidas:**
1. Obtener o crear cliente
2. Si es actualización: restaurar stock de movimientos previos
3. Eliminar movimientos previos
4. Crear/actualizar pedido
5. Insertar items del pedido
6. Registrar movimientos de inventario
7. Actualizar stock de cada artículo

**Características críticas:**
- **Atomicidad total**: Si cualquier paso falla, todo se revierte
- **Bloqueo de cliente**: Evita duplicados con `FOR UPDATE`
- **Restauración de stock**: Al editar, primero restaura y luego aplica nuevos cambios
- **Idempotencia**: Puede ejecutarse múltiples veces con mismo resultado

**Uso:**
```javascript
const resultado = await supabaseDB.procesarPedidoCompleto(
  pedidoData,    // objeto con datos del pedido
  itemsArray,    // array de items
  pedidoId       // null para crear, UUID para actualizar
);
```

---

## 🔄 Flujo de Transacciones

### **Crear Nuevo Pedido**

```
1. Usuario completa formulario y envía
2. Se obtiene cotización del dólar
3. Se llama a guardarPedidoSupabase()
4. Se convierte datos a formato Supabase
5. Se invoca procesar_pedido_completo()
   ├─ 5.1. Busca/crea cliente (con bloqueo)
   ├─ 5.2. Crea registro en tabla pedidos
   ├─ 5.3. Inserta items en pedido_items
   ├─ 5.4. Por cada item:
   │    ├─ Registra movimiento en movimientos_inventario
   │    └─ Actualiza stock con actualizar_stock_atomico()
   └─ 5.5. Commit si todo OK, Rollback si hay error
6. Se actualiza interfaz de usuario
7. Se ofrece opción de imprimir
```

### **Actualizar Pedido Existente**

```
1. Usuario carga pedido desde URL (?id=UUID)
2. Se llama a cargarPedidoSupabase(pedidoId)
3. Se rellenan campos del formulario
4. Usuario modifica y envía
5. Se solicita contraseña de confirmación
6. Se llama a guardarPedidoSupabase() con pedidoId
7. Se invoca procesar_pedido_completo(pedidoId)
   ├─ 7.1. Busca movimientos previos del pedido
   ├─ 7.2. Restaura stock (ENTRADA inversa de SALIDA)
   ├─ 7.3. Elimina movimientos previos
   ├─ 7.4. Elimina items previos
   ├─ 7.5. Actualiza registro de pedido (version++)
   ├─ 7.6. Inserta nuevos items
   ├─ 7.7. Registra nuevos movimientos
   └─ 7.8. Actualiza stock con nuevas cantidades
8. Commit o Rollback automático
```

---

## 🛡️ Manejo de Concurrencia

### **Control Optimista (Versioning)**

Las tablas `pedidos` y `stock` tienen campo `version`:

```sql
UPDATE pedidos 
SET ..., version = version + 1
WHERE id = $1 AND version = $2;
```

Si otra transacción modificó el registro, la actualización no afecta filas y se detecta el conflicto.

### **Control Pesimista (Locks)**

En operaciones críticas se usa `FOR UPDATE`:

```sql
SELECT * FROM stock WHERE codigo = $1 FOR UPDATE;
```

Esto bloquea la fila hasta que la transacción termine, evitando lecturas sucias.

### **Combinación de Estrategias**

- **Stock**: Bloqueo pesimista (operaciones frecuentes)
- **Pedidos**: Versioning optimista (operaciones menos frecuentes)

---

## 📚 API de la Capa de Abstracción

### **Inicialización**

```javascript
// Después de cargar supabaseDB.js
window.supabaseDB = inicializarSupabaseDB();

// Inicializar migración (carga clientes, alias, etc.)
await inicializarMigracionSupabase();
```

### **Clientes**

```javascript
// Buscar cliente por nombre
const cliente = await supabaseDB.buscarClientePorNombre('Juan Pérez');

// Obtener todos los clientes
const clientes = await supabaseDB.obtenerTodosLosClientes();

// Guardar cliente (crea o actualiza)
const cliente = await supabaseDB.guardarCliente({
  nombre: 'Juan Pérez',
  telefono: '123456789',
  direccion: 'Calle 123',
  tipo_cliente: 'mayorista'
});
```

### **Pedidos**

```javascript
// Procesar pedido completo (crear o actualizar)
const resultado = await supabaseDB.procesarPedidoCompleto(
  pedidoData, 
  items, 
  pedidoId // null = crear, UUID = actualizar
);

// Obtener pedido por ID
const pedido = await supabaseDB.obtenerPedidoPorId(pedidoId);

// Obtener pedidos recientes
const pedidos = await supabaseDB.obtenerPedidosRecientes(50, 0);

// Obtener historial de alias
const alias = await supabaseDB.obtenerHistorialAlias(10);
```

### **Stock**

```javascript
// Actualizar stock atómicamente
const resultado = await supabaseDB.actualizarStockAtomico(
  'ART001',
  'Producto X',
  5,
  'SALIDA'
);

// Obtener stock de artículo
const stock = await supabaseDB.obtenerStock('ART001');
```

### **Movimientos de Inventario**

```javascript
// Obtener movimientos de un pedido
const movimientos = await supabaseDB.obtenerMovimientosPorPedido(pedidoId);

// Obtener historial de movimientos
const historial = await supabaseDB.obtenerHistorialMovimientos(100, 0);
```

---

## ⚙️ Configuración Paso a Paso

### **1. Crear Proyecto en Supabase**

1. Ir a [supabase.com](https://supabase.com)
2. Crear cuenta/iniciar sesión
3. Crear nuevo proyecto
4. Anotar:
   - URL del proyecto (https://xxxxx.supabase.co)
   - Anon/Public Key (Settings > API)

### **2. Ejecutar Schema SQL**

1. En dashboard de Supabase, ir a **SQL Editor**
2. Crear nueva query
3. Copiar **TODO** el contenido de `supabase-schema.sql`
4. Pegar y ejecutar (Run)
5. Verificar que se crearon todas las tablas y funciones

### **3. Configurar Credenciales**

Editar `configSupabase.js`:

```javascript
const SUPABASE_CONFIG = {
    SUPABASE_URL: 'https://tu-proyecto.supabase.co',
    SUPABASE_ANON_KEY: 'tu-clave-anon-aqui'
};
```

### **4. Verificar Carga de Scripts**

Asegurarse que `ingresoPedidoSB.html` tiene:

```html
<!-- Supabase SDK -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="configSupabase.js"></script>
<script src="supabaseDB.js"></script>
<script src="ingresoPedidoSupabase.js"></script>
```

### **5. Verificar Inicialización**

Abrir consola del navegador al cargar la página, debe aparecer:

```
✓ Cliente de Supabase inicializado
✓ Capa de abstracción de Supabase inicializada
✓ Conexión con Supabase establecida
✓ Cargados X clientes desde Supabase
✓ Cargados X alias desde Supabase
✓ Migración a Supabase completada
```

---

## 🧪 Pruebas de Validación

### **Test 1: Crear Pedido**

1. Completar formulario con cliente nuevo
2. Agregar artículos
3. Enviar pedido
4. Verificar en Supabase:
   - Tabla `clientes`: Nuevo cliente creado
   - Tabla `pedidos`: Nuevo pedido
   - Tabla `pedido_items`: Items insertados
   - Tabla `movimientos_inventario`: Movimientos registrados
   - Tabla `stock`: Stock descontado

### **Test 2: Editar Pedido**

1. Cargar pedido existente (?id=UUID)
2. Modificar items (cambiar cantidades o agregar/quitar)
3. Guardar cambios
4. Verificar en Supabase:
   - Movimientos previos eliminados
   - Stock restaurado de movimientos previos
   - Nuevos movimientos creados
   - Stock actualizado con nuevas cantidades

### **Test 3: Concurrencia**

1. Abrir mismo pedido en dos pestañas
2. Modificar en ambas simultáneamente
3. Guardar en ambas
4. Verificar que no hay inconsistencias en stock

### **Test 4: Rollback**

1. Crear pedido con item inválido (forzar error)
2. Verificar que NO se creó:
   - Pedido
   - Items
   - Movimientos
   - Cambios en stock

---

## 🔍 Monitoreo y Debugging

### **Ver Logs en Consola**

Todos los mensajes críticos se logean:

```javascript
console.log('✓ Pedido guardado correctamente');
console.error('❌ Error guardando pedido:', error);
```

### **Verificar Transacciones**

En Supabase Dashboard:
- **Database** > **Query Editor**
- Consultar vistas creadas

```sql
-- Ver pedidos completos con cliente
SELECT * FROM vista_pedidos_completos 
ORDER BY created_at DESC 
LIMIT 10;

-- Ver movimientos con stock resultante
SELECT * FROM vista_movimientos_stock 
ORDER BY created_at DESC 
LIMIT 20;

-- Ver stock actual
SELECT * FROM stock 
ORDER BY stock_actual ASC;
```

### **Detectar Problemas de Concurrencia**

```sql
-- Ver pedidos con muchas actualizaciones (version alto)
SELECT id, version, updated_at 
FROM pedidos 
WHERE version > 5 
ORDER BY version DESC;

-- Ver stock con cambios frecuentes
SELECT codigo, nombre, version, stock_actual 
FROM stock 
WHERE version > 10 
ORDER BY version DESC;
```

---

## 🚨 Solución de Problemas Comunes

### **Error: "SupabaseDB no inicializado"**

**Causa**: Scripts no cargados en orden correcto o config inválida

**Solución**:
1. Verificar que `configSupabase.js` tiene credenciales correctas
2. Verificar orden de scripts en HTML
3. Revisar consola para errores de carga

### **Error: "No se pudo conectar a Supabase"**

**Causa**: URL o API key incorrectas

**Solución**:
1. Verificar URL (debe terminar en `.supabase.co`)
2. Verificar anon key (debe ser una cadena larga)
3. Verificar que proyecto de Supabase esté activo

### **Error: "Función procesar_pedido_completo no encontrada"**

**Causa**: Schema SQL no ejecutado completamente

**Solución**:
1. Ir a SQL Editor en Supabase
2. Re-ejecutar `supabase-schema.sql` completo
3. Verificar que no hubo errores en la ejecución

### **Error: "Stock negativo"**

**Causa**: La función previene stock negativo por diseño

**Solución**:
1. Verificar stock disponible antes de vender
2. Agregar más stock con tipo 'ENTRADA'
3. Ajustar cantidades en el pedido

---

## 📊 Ventajas de la Nueva Arquitectura

### **vs Firebase Realtime Database**

| Característica | Firebase | Supabase |
|----------------|----------|----------|
| **Transacciones** | Limitadas | Completas (ACID) |
| **Concurrencia** | Manual | Automática |
| **Relaciones** | Denormalizadas | Normalizadas con FK |
| **Queries complejos** | Difícil | SQL nativo |
| **Atomicidad** | Por operación | Por transacción |
| **Rollback** | Manual | Automático |
| **Escalabilidad** | Limitada | PostgreSQL |
| **Costos** | Por operación | Por almacenamiento |

### **Garantías ACID**

✅ **Atomicity**: Todas las operaciones o ninguna
✅ **Consistency**: Datos siempre válidos (constraints)
✅ **Isolation**: Transacciones no interfieren entre sí
✅ **Durability**: Datos persistidos inmediatamente

---

## 🔄 Migración de Datos Históricos

Si necesitas migrar datos existentes de Firebase a Supabase:

1. **Exportar de Firebase**:
```javascript
// Script de exportación (ejecutar en consola)
db.ref('pedidos').once('value').then(snap => {
  const data = snap.val();
  console.log(JSON.stringify(data, null, 2));
});
```

2. **Transformar formato**:
- Usar script de transformación personalizado
- Mapear estructura de Firebase a Supabase

3. **Importar a Supabase**:
```javascript
// Script de importación
for (const pedidoId in datosFirebase) {
  const pedido = datosFirebase[pedidoId];
  await supabaseDB.procesarPedidoCompleto(
    convertirPedido(pedido),
    pedido.items,
    null
  );
}
```

---

## 📞 Soporte y Contacto

Para dudas o problemas con la migración:

1. Revisar logs en consola del navegador
2. Verificar logs en Supabase Dashboard
3. Consultar documentación de Supabase: [supabase.com/docs](https://supabase.com/docs)

---

## ✅ Checklist de Migración Completa

- [x] Esquema de base de datos diseñado
- [x] Funciones de transacción atómica creadas
- [x] Capa de abstracción implementada
- [x] Operaciones CRUD migradas
- [x] Control de concurrencia implementado
- [x] HTML actualizado con SDK
- [x] Funciones de compatibilidad creadas
- [x] Documentación completa
- [ ] Configurar credenciales en configSupabase.js
- [ ] Ejecutar schema SQL en Supabase
- [ ] Probar creación de pedidos
- [ ] Probar edición de pedidos
- [ ] Verificar integridad de stock
- [ ] Validar transacciones atómicas

---

## 🎉 ¡Migración Lista!

El sistema ahora está preparado para usar Supabase con:
- ✨ Transacciones atómicas completas
- 🔐 Control de concurrencia robusto
- 🚀 Mejor rendimiento y escalabilidad
- 🛡️ Integridad de datos garantizada

**Próximo paso**: Configurar credenciales y ejecutar schema SQL.
