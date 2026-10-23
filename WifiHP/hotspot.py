"""
Zona con cobertura inalambrica movil de Windows (NetworkOperatorTetheringManager, WinRT).

Es el mismo mecanismo que el interruptor de Configuracion > Red > Zona con cobertura movil.
Comparte la conexion que tiene internet (en el comercio, el cable) por una red Wi-Fi nueva.
Limites de Windows: hasta 8 clientes, clave de 8 caracteres o mas, no expulsa clientes.

Las llamadas WinRT asincronicas corren en un loop de asyncio propio (hilo aparte), asi la
interfaz nunca queda trabada esperando a Windows.
"""

import asyncio
import threading

from winrt.windows.networking import HostNameType
from winrt.windows.networking.connectivity import NetworkInformation
from winrt.windows.networking.networkoperators import (
    NetworkOperatorTetheringManager,
    TetheringCapability,
    TetheringOperationalState,
    TetheringOperationStatus,
    TetheringWiFiBand,
)

# Mensajes para quien usa la app: sin codigos ni jerga.
_CAPACIDAD = {
    TetheringCapability.DISABLED_BY_GROUP_POLICY: "Windows tiene bloqueada la zona con cobertura por una política del equipo.",
    TetheringCapability.DISABLED_BY_HARDWARE_LIMITATION: "La placa Wi-Fi de esta PC no permite crear una red para clientes.",
    TetheringCapability.DISABLED_BY_OPERATOR: "La conexión actual no permite compartir internet.",
    TetheringCapability.DISABLED_BY_SKU: "Esta versión de Windows no permite compartir internet.",
    TetheringCapability.DISABLED_BY_REQUIRED_APP_NOT_INSTALLED: "Falta un componente de Windows para compartir internet.",
    TetheringCapability.DISABLED_DUE_TO_UNKNOWN_CAUSE: "Windows no permite compartir internet en este momento.",
    TetheringCapability.DISABLED_BY_SYSTEM_CAPABILITY: "Windows no permite compartir internet en este equipo.",
}
_OPERACION = {
    TetheringOperationStatus.WI_FI_DEVICE_OFF: "El Wi-Fi de la PC está apagado. Encendelo desde la barra de tareas y probá de nuevo.",
    TetheringOperationStatus.ENTITLEMENT_CHECK_FAILURE: "La conexión actual no permite compartir internet.",
    TetheringOperationStatus.BLUETOOTH_DEVICE_OFF: "Windows pide el Bluetooth encendido para compartir. Encendelo y probá de nuevo.",
    TetheringOperationStatus.NETWORK_LIMITED_CONNECTIVITY: "La PC no tiene internet ahora. Revisá el cable de red.",
    TetheringOperationStatus.OPERATION_IN_PROGRESS: "Windows todavía está encendiendo o apagando la red. Esperá unos segundos.",
    TetheringOperationStatus.RADIO_RESTRICTION: "El modo avión está activado. Desactivalo y probá de nuevo.",
    TetheringOperationStatus.BAND_INTERFERENCE: "La placa Wi-Fi no puede emitir en esta banda ahora. Probá de nuevo en unos segundos.",
}


class ErrorHotspot(Exception):
    """Error con un mensaje listo para mostrar."""


class Hotspot:
    def __init__(self):
        self._loop = asyncio.new_event_loop()
        threading.Thread(target=self._loop.run_forever, name="winrt", daemon=True).start()

    def _correr(self, coro, espera=40):
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result(espera)

    # --- conexion con internet ---------------------------------------------------------

    @staticmethod
    def _perfil():
        perfil = NetworkInformation.get_internet_connection_profile()
        if perfil is None:
            raise ErrorHotspot("La PC no tiene internet ahora. Revisá el cable de red.")
        return perfil

    def conexion(self):
        """Describe la conexion que se comparte: {'ok', 'nombre', 'tipo'} (tipo: cable/wifi/otra)."""
        try:
            perfil = self._perfil()
        except ErrorHotspot:
            return {"ok": False, "nombre": "", "tipo": ""}
        iana = perfil.network_adapter.iana_interface_type
        tipo = {6: "cable", 71: "wifi"}.get(iana, "otra")
        return {"ok": True, "nombre": perfil.profile_name or "", "tipo": tipo}

    def _manager(self):
        perfil = self._perfil()
        capacidad = NetworkOperatorTetheringManager.get_tethering_capability_from_connection_profile(perfil)
        if capacidad != TetheringCapability.ENABLED:
            raise ErrorHotspot(_CAPACIDAD.get(capacidad, "Windows no permite compartir internet en este equipo."))
        return NetworkOperatorTetheringManager.create_from_connection_profile(perfil)

    # --- estado -------------------------------------------------------------------------

    def encendido(self):
        try:
            estado = self._manager().tethering_operational_state
        except Exception:
            return False
        return estado in (TetheringOperationalState.ON, TetheringOperationalState.IN_TRANSITION)

    def clientes(self):
        """Lista de {'mac', 'nombre', 'ips'} de los telefonos conectados ahora."""
        try:
            lista = self._manager().get_tethering_clients()
        except Exception:
            return []
        salida = []
        for c in lista:
            ips, nombre = [], ""
            for h in c.host_names:
                if h.type == HostNameType.IPV4:
                    ips.append(h.canonical_name)
                elif h.type == HostNameType.DOMAIN_NAME and not nombre:
                    nombre = h.display_name.split(".")[0]
            salida.append({"mac": c.mac_address.lower(), "nombre": nombre, "ips": ips})
        return salida

    # --- encender / apagar --------------------------------------------------------------

    def encender(self, ssid, clave):
        self._correr(self._encender(ssid, clave))

    async def _encender(self, ssid, clave):
        manager = self._manager()
        if manager.tethering_operational_state == TetheringOperationalState.ON:
            await manager.stop_tethering_async()
        cfg = manager.get_current_access_point_configuration()
        cfg.ssid = ssid
        cfg.passphrase = clave
        try:
            if cfg.is_band_supported(TetheringWiFiBand.AUTO):
                cfg.band = TetheringWiFiBand.AUTO
        except Exception:
            pass  # Windows 10 viejo: no tiene banda configurable
        await manager.configure_access_point_async(cfg)
        resultado = await manager.start_tethering_async()
        if resultado.status not in (TetheringOperationStatus.SUCCESS, TetheringOperationStatus.ALREADY_ON):
            raise ErrorHotspot(
                _OPERACION.get(resultado.status)
                or "Windows no pudo encender la red para clientes. Probá de nuevo en unos segundos."
            )

    def apagar(self):
        self._correr(self._apagar())

    async def _apagar(self):
        try:
            manager = self._manager()
        except ErrorHotspot:
            return
        if manager.tethering_operational_state != TetheringOperationalState.OFF:
            await manager.stop_tethering_async()
