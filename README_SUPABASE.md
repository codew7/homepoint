# ⚡ Guía Rápida - Migración a Supabase

## 🎯 Objetivo

Migrar el sistema de Firebase a Supabase implementando **transacciones atómicas** y **control de concurrencia** para evitar inconsistencias en los datos.

---

## 📦 Archivos Creados

### **Configuración**
- ✅ `supabase-schema.sql` - Esquema completo de BD con funciones atómicas
- ✅ `configSupabase.js` - Configuración de credenciales (COMPLETAR)

### **Código**
- ✅ `supabaseDB.js` - Capa de abstracción con métodos reutilizables
- ✅ `ingresoPedidoSupabase.js` - Funciones de migración
- ✅ `ingresoPedidoSB.js` - MODIFICADO con llamadas a Supabase
- ✅ `ingresoPedidoSB.html` - MODIFICADO con SDK de Supabase

### **Documentación**
- ✅ `MIGRACION_SUPABASE.md` - Documentación completa y detallada

---

## 🚀 Inicio Rápido (5 pasos)

### **Paso 1: Crear Proyecto en Supabase**

1. Ir a https://supabase.com
2. Crear cuenta/login
3. Click "New Project"
4. Anotar:
   - **URL**: `https://xxxxx.supabase.co`
   - **Anon Key**: `Settings > API > anon public`

### **Paso 2: Ejecutar Schema SQL**

1. En Supabase Dashboard → **SQL Editor**
2. Click "New Query"
3. Copiar TODO `supabase-schema.sql`
4. Pegar y click **"Run"**
5. ✅ Verificar: 5 tablas + 2 funciones + 2 vistas creadas

### **Paso 3: Configurar Credenciales**

Editar `configSupabase.js`:

```javascript
const SUPABASE_CONFIG = {
    SUPABASE_URL: 'https://tu-proyecto.supabase.co',  // ← TU URL AQUÍ
    SUPABASE_ANON_KEY: 'eyJhbGc...'  // ← TU KEY AQUÍ
};
```

### **Paso 4: Verificar Archivos**

Asegurar que existen todos los archivos:

```
homepoint/
├── supabase-schema.sql          ✅
├── configSupabase.js            ✅ (con tus credenciales)
├── supabaseDB.js                ✅
├── ingresoPedidoSupabase.js     ✅
├── ingresoPedidoSB.js           ✅ (modificado)
├── ingresoPedidoSB.html         ✅ (modificado)
└── MIGRACION_SUPABASE.md        ✅
```

### **Paso 5: Probar**

1. Abrir `ingresoPedidoSB.html` en navegador
2. Abrir **Consola del Navegador** (F12)
3. Verificar mensajes:

```
✓ Cliente de Supabase inicializado
✓ Capa de abstracción de Supabase inicializada
✓ Conexión con Supabase establecida
✓ Cargados 0 clientes desde Supabase
✓ Cargados 0 alias desde Supabase
✓ Migración a Supabase completada
```

4. Crear pedido de prueba
5. Verificar en Supabase Dashboard → **Table Editor**:
   - Tabla `clientes`: Cliente nuevo
   - Tabla `pedidos`: Pedido nuevo
   - Tabla `pedido_items`: Items del pedido
   - Tabla `movimientos_inventario`: Movimientos registrados
   - Tabla `stock`: Stock actualizado

---

## 🔥 Características Implementadas

### **Transacciones Atómicas**

❌ **Antes (Firebase)**:
```javascript
// Múltiples operaciones separadas (pueden fallar individualmente)
await db.ref('pedidos').push(pedido);
await db.ref('items').push(item1);
await db.ref('items').push(item2);
await db.ref('stock').update(stock);
// Si falla item2, pedido e item1 YA están guardados ❌
```

✅ **Ahora (Supabase)**:
```javascript
// UNA transacción atómica (todo o nada)
await supabaseDB.procesarPedidoCompleto(pedido, items);
// Si CUALQUIER operación falla, TODO se revierte ✅
```

### **Control de Concurrencia**

❌ **Antes (Firebase)**:
```javascript
// Dos usuarios editan el mismo pedido simultáneamente
// Posible inconsistencia en stock ❌
```

✅ **Ahora (Supabase)**:
```javascript
// Bloqueos optimistas y pesimistas
// Versioning automático
// Imposible tener inconsistencias ✅
```

### **Función Principal: `procesar_pedido_completo()`**

Esta función PostgreSQL hace **TODO en una transacción**:

1. ✅ Crea/actualiza cliente
2. ✅ Si es edición: restaura stock de versión anterior
3. ✅ Elimina movimientos previos
4. ✅ Crea/actualiza pedido
5. ✅ Inserta items del pedido
6. ✅ Registra movimientos de inventario
7. ✅ Actualiza stock de cada artículo

**Si CUALQUIER paso falla → ROLLBACK completo automático**

---

## 🧪 Tests de Validación

### **Test 1: Crear Pedido Simple**

```javascript
// En consola del navegador
const pedidoData = {
  cliente: { nombre: 'Test Cliente', telefono: '123', tipoCliente: 'mayorista' },
  status: 'DESPACHADO/ENTREGADO',
  entrega: 'Local',
  vendedor: 'Test',
  pagos: { medioPago: 'Efectivo', subtotal: 1000, totalFinal: 1000 },
  cotizacionCierre: 1000,
  costoUSD: 1
};

const items = [{
  codigo: 'TEST001',
  nombre: 'Producto Test',
  cantidad: 2,
  valorU: 500,
  valorC: 300,
  valorG: 400
}];

await supabaseDB.procesarPedidoCompleto(pedidoData, items);
// ✅ Debe mostrar: { success: true, pedidoId: '...' }
```

### **Test 2: Verificar Transacción Atómica**

1. Crear pedido con item inválido:

```javascript
const itemsInvalidos = [{
  // Falta campo requerido 'nombre'
  codigo: 'TEST002',
  cantidad: 1,
  valorU: 100
}];

await supabaseDB.procesarPedidoCompleto(pedidoData, itemsInvalidos);
// ❌ Debe fallar y NO crear nada en ninguna tabla
```

2. Verificar en Supabase que NO se creó:
   - Cliente
   - Pedido
   - Items
   - Movimientos
   - Cambios en stock

✅ **Si no se creó nada = Transacción atómica funcionando**

### **Test 3: Concurrencia**

1. Abrir mismo pedido en 2 pestañas
2. En ambas: modificar cantidades
3. Guardar en pestaña 1
4. Guardar en pestaña 2
5. Verificar stock en BD

✅ **Stock debe ser correcto (no duplicado ni perdido)**

---

## 🎓 Conceptos Clave

### **Atomicidad**
**TODO o NADA**. Si falla crear item #5, se revierten items #1-4, el pedido y el cliente.

### **Consistency**
Los **constraints** garantizan datos válidos:
- Stock nunca negativo
- Cliente debe existir antes de crear pedido
- Relaciones FK válidas siempre

### **Isolation**
Dos usuarios editando simultáneamente **no interfieren** entre sí gracias a:
- Bloqueos pesimistas (`FOR UPDATE`)
- Versioning optimista (`version` column)

### **Durability**
Una vez que la transacción hace **COMMIT**, los datos están **permanentemente guardados**.

---

## 🔍 Verificación en Supabase Dashboard

### **Ver Pedidos**

```sql
SELECT * FROM vista_pedidos_completos 
ORDER BY created_at DESC 
LIMIT 10;
```

### **Ver Stock Actual**

```sql
SELECT codigo, nombre, stock_actual, version 
FROM stock 
ORDER BY stock_actual ASC;
```

### **Ver Movimientos Recientes**

```sql
SELECT * FROM vista_movimientos_stock 
ORDER BY created_at DESC 
LIMIT 20;
```

### **Ver Historial de un Artículo**

```sql
SELECT * FROM movimientos_inventario 
WHERE codigo = 'ART001' 
ORDER BY created_at DESC;
```

---

## 🚨 Errores Comunes y Soluciones

### **Error: "SupabaseDB no inicializado"**

**Solución**: Verificar que `configSupabase.js` tiene credenciales correctas.

### **Error: "función procesar_pedido_completo no existe"**

**Solución**: Ejecutar `supabase-schema.sql` completamente en SQL Editor.

### **Error: "No se pudo conectar a Supabase"**

**Solución**: 
1. Verificar URL (debe terminar en `.supabase.co`)
2. Verificar anon key en Supabase Dashboard
3. Verificar que el proyecto está activo

### **Error: "violates foreign key constraint"**

**Solución**: Este es un error **esperado** si intentas crear pedido sin cliente válido. La función `procesar_pedido_completo()` debe usarse siempre, ella maneja esto automáticamente.

---

## 📊 Comparación Antes/Después

| Aspecto | Firebase | Supabase |
|---------|----------|----------|
| **Operación Pedido** | 5+ llamadas separadas | 1 llamada atómica |
| **Rollback** | Manual | Automático |
| **Inconsistencias** | Posibles | Imposibles |
| **Concurrencia** | Problemas frecuentes | Controlada |
| **Stock negativo** | Posible | Prevenido |
| **Performance** | N operaciones | 1 transacción |

---

## 📞 Próximos Pasos

1. ✅ **Completar** `configSupabase.js` con tus credenciales
2. ✅ **Ejecutar** `supabase-schema.sql` en SQL Editor
3. ✅ **Probar** crear un pedido
4. ✅ **Verificar** en Supabase que todo se guardó
5. ✅ **Probar** editar el pedido
6. ✅ **Verificar** que stock se actualizó correctamente

---

## 🎉 ¡Listo!

Tu sistema ahora tiene:
- ✨ Transacciones atómicas ACID
- 🔐 Control de concurrencia robusto
- 🚀 Mejor performance
- 🛡️ Integridad de datos garantizada

**Para más detalles**, ver `MIGRACION_SUPABASE.md`
