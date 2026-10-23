r"""
Filtros de red para los clientes del hotspot, con la Plataforma de Filtrado de Windows (WFP).

Sin drivers externos: son filtros de "bloquear/permitir" que se cargan desde la app (necesita
administrador). La sesion es DINAMICA: si la app se cierra o se cuelga, Windows borra todos
los filtros solo, asi nunca queda nada bloqueado de mas.

Que se filtra (subred del hotspot, por defecto 192.168.137.0/24, puerta 192.168.137.1):
  * Red interna del comercio: se descarta lo que llega a los telefonos desde direcciones
    privadas (10/8, 172.16/12, 192.168/16, 169.254/16). Sin respuestas no hay conexion posible.
  * La PC: desde el hotspot solo se aceptan DNS (53) y DHCP (67); nada de carpetas
    compartidas, escritorio remoto, etc.
  * Clientes vencidos o cortados: todo lo que va hacia su IP, y todo acceso a la PC.

Por que solo se filtra lo que va HACIA el telefono: Windows traduce las direcciones (NAT) de
lo que sale del telefono antes de clasificarlo, asi que en IPFORWARD e INBOUND_IPPACKET ese
trafico ya no aparece con la IP del telefono (probado: filtros por IP de origen no cortan
nada). La vuelta, en cambio, llega a IPFORWARD con la IP del telefono como destino.
"""

import ctypes
import ipaddress
import uuid
import winreg
from ctypes import POINTER, Structure, Union, byref, c_uint8, c_uint16, c_uint32, c_uint64, c_void_p, c_wchar_p
from ctypes import wintypes

# --- identificadores de WFP (fwpmu.h) --------------------------------------------------------

LAYER_INBOUND_IPPACKET_V4 = uuid.UUID("c86fd1bf-21cd-497e-a0bb-17425c885c58")
LAYER_IPFORWARD_V4 = uuid.UUID("a82acc24-4ee1-4ee1-b465-fd1d25cb10a4")
LAYER_ALE_AUTH_RECV_ACCEPT_V4 = uuid.UUID("e1cd9fe7-f4b5-4273-96c0-592e487b8650")

COND_IP_LOCAL_ADDRESS = uuid.UUID("d9ee00de-c1ef-4617-bfe3-ffd8f5a08957")
COND_IP_REMOTE_ADDRESS = uuid.UUID("b235ae9a-1d64-49b8-a44c-5ff3d9095045")
COND_IP_SOURCE_ADDRESS = uuid.UUID("ae96897e-2e94-4bc9-b313-b27ee80e574d")
COND_IP_DESTINATION_ADDRESS = uuid.UUID("2d79133b-b390-45c6-8699-acaceaafed33")
COND_IP_LOCAL_PORT = uuid.UUID("0c1ba1af-5765-453f-af22-a8f791ac775b")
COND_IP_PROTOCOL = uuid.UUID("3971ef2b-623e-4f9a-8cb1-6e79b806b9a7")

# Subcapa propia de la app (fija para que se reconozca en "netsh wfp show filters").
SUBCAPA = uuid.UUID("7a3f5c1e-9b2d-4e8a-b6c4-1d2e3f4a5b6c")

FWP_EMPTY, FWP_UINT8, FWP_UINT16, FWP_UINT32 = 0, 1, 2, 3
FWP_V4_ADDR_MASK = 0x100
FWP_MATCH_EQUAL = 0
FWP_ACTION_BLOCK = 0x1001
FWP_ACTION_PERMIT = 0x1002
FWPM_SESSION_FLAG_DYNAMIC = 0x1
RPC_C_AUTHN_WINNT = 10
IPPROTO_TCP, IPPROTO_UDP = 6, 17

PRIVADAS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16"]

# Pesos dentro de la subcapa (0-15, gana el mayor).
PESO_CLIENTE, PESO_PERMITIR, PESO_BASE = 15, 10, 5


# --- estructuras -------------------------------------------------------------------------------

class GUID(Structure):
    _fields_ = [("Data1", c_uint32), ("Data2", c_uint16), ("Data3", c_uint16), ("Data4", c_uint8 * 8)]

    @classmethod
    def de(cls, u):
        return cls.from_buffer_copy(u.bytes_le)


class DISPLAY_DATA(Structure):
    _fields_ = [("name", c_wchar_p), ("description", c_wchar_p)]


class BYTE_BLOB(Structure):
    _fields_ = [("size", c_uint32), ("data", POINTER(c_uint8))]


class V4_ADDR_AND_MASK(Structure):
    _fields_ = [("addr", c_uint32), ("mask", c_uint32)]


class _VALOR(Union):
    _fields_ = [("uint8", c_uint8), ("uint16", c_uint16), ("uint32", c_uint32), ("puntero", c_void_p)]


class VALUE(Structure):  # FWP_VALUE0 y FWP_CONDITION_VALUE0 tienen la misma forma
    _fields_ = [("type", c_uint32), ("v", _VALOR)]


class FILTER_CONDITION(Structure):
    _fields_ = [("fieldKey", GUID), ("matchType", c_uint32), ("conditionValue", VALUE)]


class _ACCION(Union):
    _fields_ = [("filterType", GUID), ("calloutKey", GUID)]


class ACTION(Structure):
    _fields_ = [("type", c_uint32), ("a", _ACCION)]


class _CONTEXTO(Union):
    _fields_ = [("rawContext", c_uint64), ("providerContextKey", GUID)]


class FILTER(Structure):
    _fields_ = [
        ("filterKey", GUID),
        ("displayData", DISPLAY_DATA),
        ("flags", c_uint32),
        ("providerKey", POINTER(GUID)),
        ("providerData", BYTE_BLOB),
        ("layerKey", GUID),
        ("subLayerKey", GUID),
        ("weight", VALUE),
        ("numFilterConditions", c_uint32),
        ("filterCondition", POINTER(FILTER_CONDITION)),
        ("action", ACTION),
        ("c", _CONTEXTO),
        ("reserved", POINTER(GUID)),
        ("filterId", c_uint64),
        ("effectiveWeight", VALUE),
    ]


class SUBLAYER(Structure):
    _fields_ = [
        ("subLayerKey", GUID),
        ("displayData", DISPLAY_DATA),
        ("flags", c_uint32),
        ("providerKey", POINTER(GUID)),
        ("providerData", BYTE_BLOB),
        ("weight", c_uint16),
    ]


class SESSION(Structure):
    _fields_ = [
        ("sessionKey", GUID),
        ("displayData", DISPLAY_DATA),
        ("flags", c_uint32),
        ("txnWaitTimeoutInMSec", c_uint32),
        ("processId", wintypes.DWORD),
        ("sid", c_void_p),
        ("username", c_wchar_p),
        ("kernelMode", wintypes.BOOL),
    ]


# --- condiciones --------------------------------------------------------------------------------

def _ip(texto):
    return int(ipaddress.IPv4Address(texto))


class _Condiciones:
    """Arma el arreglo de condiciones y mantiene vivos los punteros mientras se usa."""

    def __init__(self):
        self._items, self._vivos = [], []

    def ip(self, campo, texto):
        red = ipaddress.IPv4Network(texto, strict=False)
        c = FILTER_CONDITION(fieldKey=GUID.de(campo), matchType=FWP_MATCH_EQUAL)
        if red.prefixlen == 32:
            c.conditionValue.type = FWP_UINT32
            c.conditionValue.v.uint32 = int(red.network_address)
        else:
            m = V4_ADDR_AND_MASK(int(red.network_address), int(red.netmask))
            self._vivos.append(m)
            c.conditionValue.type = FWP_V4_ADDR_MASK
            c.conditionValue.v.puntero = ctypes.addressof(m)
        self._items.append(c)
        return self

    def protocolo(self, numero):
        c = FILTER_CONDITION(fieldKey=GUID.de(COND_IP_PROTOCOL), matchType=FWP_MATCH_EQUAL)
        c.conditionValue.type = FWP_UINT8
        c.conditionValue.v.uint8 = numero
        self._items.append(c)
        return self

    def puerto_local(self, numero):
        c = FILTER_CONDITION(fieldKey=GUID.de(COND_IP_LOCAL_PORT), matchType=FWP_MATCH_EQUAL)
        c.conditionValue.type = FWP_UINT16
        c.conditionValue.v.uint16 = numero
        self._items.append(c)
        return self

    def arreglo(self):
        arr = (FILTER_CONDITION * len(self._items))(*self._items)
        self._vivos.append(arr)
        return arr


# --- motor --------------------------------------------------------------------------------------

def es_admin():
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except OSError:
        return False


def subred_hotspot():
    """(subred, puerta) que Windows usa para compartir internet. Por defecto 192.168.137.0/24."""
    puerta = "192.168.137.1"
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters") as k:
            puerta = str(ipaddress.IPv4Address(winreg.QueryValueEx(k, "ScopeAddress")[0]))
    except (OSError, ValueError):
        pass
    return str(ipaddress.IPv4Network(f"{puerta}/24", strict=False)), puerta


class ErrorFiltro(Exception):
    pass


class Filtro:
    def __init__(self):
        self._dll = None
        self._motor = None
        self._clientes = {}  # ip -> [ids de filtro]
        self.subred, self.puerta = subred_hotspot()
        try:
            dll = ctypes.WinDLL("fwpuclnt.dll")
            dll.FwpmEngineOpen0.argtypes = [c_wchar_p, c_uint32, c_void_p, POINTER(SESSION), POINTER(wintypes.HANDLE)]
            dll.FwpmEngineClose0.argtypes = [wintypes.HANDLE]
            dll.FwpmSubLayerAdd0.argtypes = [wintypes.HANDLE, POINTER(SUBLAYER), c_void_p]
            dll.FwpmFilterAdd0.argtypes = [wintypes.HANDLE, POINTER(FILTER), c_void_p, POINTER(c_uint64)]
            dll.FwpmFilterDeleteById0.argtypes = [wintypes.HANDLE, c_uint64]
            for f in ("FwpmEngineOpen0", "FwpmEngineClose0", "FwpmSubLayerAdd0", "FwpmFilterAdd0", "FwpmFilterDeleteById0"):
                getattr(dll, f).restype = wintypes.DWORD
            self._dll = dll
        except OSError:
            pass

    @property
    def disponible(self):
        return self._dll is not None and es_admin()

    @property
    def activo(self):
        return self._motor is not None

    def _ok(self, codigo, que):
        if codigo:
            raise ErrorFiltro(f"{que}: 0x{codigo & 0xFFFFFFFF:08X}")

    # --- ciclo de vida -------------------------------------------------------------------------

    def activar(self):
        """Abre la sesion dinamica y carga la proteccion base (red interna y la PC)."""
        if self.activo:
            return
        if not self.disponible:
            raise ErrorFiltro("se necesitan permisos de administrador")
        sesion = SESSION(flags=FWPM_SESSION_FLAG_DYNAMIC, displayData=DISPLAY_DATA("WiFi Clientes", None))
        motor = wintypes.HANDLE()
        self._ok(self._dll.FwpmEngineOpen0(None, RPC_C_AUTHN_WINNT, None, byref(sesion), byref(motor)), "abrir WFP")
        self._motor = motor
        try:
            capa = SUBLAYER(subLayerKey=GUID.de(SUBCAPA), weight=0x7FFF,
                            displayData=DISPLAY_DATA("WiFi Clientes", "Filtros de la red para clientes"))
            self._ok(self._dll.FwpmSubLayerAdd0(self._motor, byref(capa), None), "crear subcapa")
            self._base()
        except Exception:
            self.desactivar()
            raise

    def desactivar(self):
        """Cierra la sesion: Windows borra todos los filtros de la app."""
        if self._motor is not None:
            self._dll.FwpmEngineClose0(self._motor)
        self._motor = None
        self._clientes.clear()

    def _agregar(self, capa, condiciones, accion, peso, nombre):
        arr = condiciones.arreglo()
        f = FILTER(
            displayData=DISPLAY_DATA(f"WiFi Clientes: {nombre}", None),
            layerKey=GUID.de(capa),
            subLayerKey=GUID.de(SUBCAPA),
            numFilterConditions=len(arr),
            filterCondition=ctypes.cast(arr, POINTER(FILTER_CONDITION)),
        )
        f.weight.type = FWP_UINT8
        f.weight.v.uint8 = peso
        f.action.type = accion
        id_ = c_uint64()
        self._ok(self._dll.FwpmFilterAdd0(self._motor, byref(f), None, byref(id_)), f"filtro '{nombre}'")
        return id_.value

    def _base(self):
        red = self.subred

        # Red interna: lo que la red del comercio le responde a los telefonos se descarta.
        lan = _Condiciones().ip(COND_IP_DESTINATION_ADDRESS, red)
        for p in PRIVADAS:  # mismo campo repetido = cualquiera de ellas
            lan.ip(COND_IP_SOURCE_ADDRESS, p)
        self._agregar(LAYER_IPFORWARD_V4, lan, FWP_ACTION_BLOCK, PESO_BASE, "bloquear red interna")

        # La PC: solo DNS y DHCP.
        self._agregar(LAYER_ALE_AUTH_RECV_ACCEPT_V4,
                      _Condiciones().ip(COND_IP_REMOTE_ADDRESS, red).protocolo(IPPROTO_UDP).puerto_local(53).puerto_local(67),
                      FWP_ACTION_PERMIT, PESO_PERMITIR, "permitir DNS/DHCP")
        self._agregar(LAYER_ALE_AUTH_RECV_ACCEPT_V4,
                      _Condiciones().ip(COND_IP_REMOTE_ADDRESS, red).protocolo(IPPROTO_TCP).puerto_local(53),
                      FWP_ACTION_PERMIT, PESO_PERMITIR, "permitir DNS (tcp)")
        self._agregar(LAYER_ALE_AUTH_RECV_ACCEPT_V4,
                      _Condiciones().ip(COND_IP_REMOTE_ADDRESS, red),
                      FWP_ACTION_BLOCK, PESO_BASE, "proteger la PC")

    # --- clientes ------------------------------------------------------------------------------

    def bloquear(self, ip):
        """Corta todo el trafico de un cliente (vencido o cortado a mano)."""
        if not self.activo or ip in self._clientes:
            return
        nombre = f"cliente {ip}"
        self._clientes[ip] = [
            self._agregar(LAYER_IPFORWARD_V4, _Condiciones().ip(COND_IP_DESTINATION_ADDRESS, ip),
                          FWP_ACTION_BLOCK, PESO_CLIENTE, nombre),
            self._agregar(LAYER_INBOUND_IPPACKET_V4, _Condiciones().ip(COND_IP_REMOTE_ADDRESS, ip),
                          FWP_ACTION_BLOCK, PESO_CLIENTE, nombre + " (PC)"),
            self._agregar(LAYER_ALE_AUTH_RECV_ACCEPT_V4, _Condiciones().ip(COND_IP_REMOTE_ADDRESS, ip),
                          FWP_ACTION_BLOCK, PESO_CLIENTE, nombre + " (PC, conexiones)"),
        ]

    def desbloquear(self, ip):
        for id_ in self._clientes.pop(ip, []):
            self._dll.FwpmFilterDeleteById0(self._motor, id_)

    def bloqueadas(self):
        return set(self._clientes)
