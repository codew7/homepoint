r"""
Servidor local del comparador de envios: Correo Argentino (Paq.ar) + Via Cargo + Flecha Carga.

Reutiliza los cotizadores hermanos sin copiarlos (../Correo, ../ViaCargo y
"../Flecha Carga" se agregan al sys.path) y expone una unica API para la interfaz (index.html):

    GET  /api/estado                    -> sesion del Correo, fechas de catalogos, limites de Via Cargo
    GET  /api/destinos                  -> catalogo unificado por CP (destinos.py)
    POST /api/destinos/actualizar       -> {"catalogo": "localidades" | "sucursales" | "agencias" | "puntos_flecha" | "todos"}
    POST /api/flecha/cotizar            -> flechacarga.cotizar(...) con la tarifa del CP (tarifario local, instantaneo)
    POST /api/flecha/tarifario          -> {"nombre", "texto"}: importa un CSV nuevo de Flecha Carga
    GET  /api/sucursales?provincia=     -> sucursales del Correo de una provincia (eleccion manual)
    GET  /api/sucursal?codigo=          -> direccion / horario de una sucursal del Correo
    GET  /api/agencias?cp=&localidad=   -> agencias de Via Cargo en un CP / localidad
    POST /api/correo/cotizar            -> cotizador.cotizar(...)  (Playwright, serializado con lock)
    POST /api/viacargo/cotizar          -> viacargo.cotizar(...)   (HTTP directo)
    POST /api/correo/abrir              -> continuar el envio en MiCorreo con el formulario cargado (+ destinatario):
                                           modo "navegador" (Brave del usuario + extension-micorreo) o
                                           "ventana" (navegador aparte de Playwright, cotizador.py --abrir)
    GET  /api/micorreo/pendiente        -> (extension) envio esperando a ser cargado en MiCorreo
    POST /api/micorreo/tomar | resultado -> (extension) lo toma / informa como quedo
    GET  /api/micorreo/encargo?id=      -> (interfaz) en que quedo un envio pedido en modo navegador
    POST /api/micorreo/cancelar         -> (interfaz) descarta un envio que nadie tomo
    GET  /api/pedidos                   -> pedidos pendientes de pedidosv2 (pedidos.py, solo lectura)
    GET  /api/pedido?id=                -> un pedido (datos frescos del cliente)
    POST /api/pedidos/login             -> {"email", "password"} de pedidosv2
    POST /api/pedidos/salir             -> borra la sesion de pedidosv2
    POST /api/correo/credenciales       -> {"email", "password"} de MiCorreo (se guardan en .env)
    POST /api/latido | /api/adios       -> la ventana sigue abierta / se cerro (la app instalada
                                           se apaga sola cuando no quedan ventanas)

Uso:
    ..\Correo\venv\Scripts\python.exe servidor.py [puerto]     (o Cotizador.bat)

Puerto 8613 para convivir con los cotizadores individuales (8611 y 8612).
"""

import json
import os
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
CORREO_DIR = BASE_DIR.parent / "Correo"
VIACARGO_DIR = BASE_DIR.parent / "ViaCargo"
FLECHA_DIR = BASE_DIR.parent / "Flecha Carga"
for d in (CORREO_DIR, VIACARGO_DIR):
    if str(d) not in sys.path:
        sys.path.insert(0, str(d))
# Al final: "Flecha Carga" tiene su propio servidor.py; de ahi solo interesa flechacarga.py.
if str(FLECHA_DIR) not in sys.path:
    sys.path.append(str(FLECHA_DIR))

# cotizador/auth/sucursales del Correo usan rutas relativas (.env, auth_state.json,
# browser_profile/, sucursales.json): el proceso trabaja con cwd = ../Correo, o con la
# carpeta de datos del usuario cuando corre como app instalada (COTIZADOR_DATOS, ver ../Instalador).
DATOS_DIR = Path(os.environ.get("COTIZADOR_DATOS") or CORREO_DIR)
os.chdir(DATOS_DIR)

import auth as correo_auth  # noqa: E402
from cotizador import ENVIO_CLA_URL, _fmt_entero, _fmt_peso, cotizar as cotizar_correo  # noqa: E402
from sucursales import cargar_sucursales, detalle_sucursal  # noqa: E402
from viacargo import (  # noqa: E402
    agencias_en,
    cargar_agencias,
    cargar_localidades,
    cotizar as cotizar_viacargo,
    descargar_agencias,
    limites_valor_declarado,
)
from destinos import PROVINCIAS, actualizar_catalogos, cargar_destinos, normalizar  # noqa: E402
import flechacarga  # noqa: E402
import pedidos  # noqa: E402

HOST = "127.0.0.1"
PORT = 8613
# Sin latidos durante LATIDO_LIMITE segundos la app instalada se cierra. Es largo porque el navegador
# espacia los timers de las ventanas minimizadas a uno por minuto.
LATIDO_LIMITE = 150

# El Correo se cotiza con un navegador que comparte auth_state.json: de a uno.
_lock_correo = threading.Lock()
# Las descargas de catalogos escriben en disco: de a una.
_lock_catalogos = threading.Lock()

# Ultima senal de vida de la interfaz (/api/latido). La app instalada lo vigila para cerrarse.
ultimo_latido = time.time()

# Extension de Brave/Chrome que completa envioCla en el navegador del usuario (con sus cuentas).
# La app instalada la copia a la carpeta de datos (ver ../Instalador/app.py).
EXTENSION_DIR = BASE_DIR / "extension-micorreo"
# Envios pedidos en modo "navegador": la extension los toma desde MiCorreo. Solo en memoria.
ENCARGO_VIGENCIA = 15 * 60
_encargos = {}
_lock_encargos = threading.Lock()
# Ultima vez que la extension pregunto por envios (para mostrar en Configuracion si esta instalada).
extension_contacto = None

ESTATICOS = {
    "/index.html": BASE_DIR / "index.html",
    "/icono.png": BASE_DIR / "icono.png",
    "/logo-correo.png": CORREO_DIR / "logo-correo.png",
    "/logo-viacargo.png": VIACARGO_DIR / "logo-viacargo.png",
    # El logo original de Flecha Carga es blanco (para fondo azul): en general va la version para
    # fondo claro; el original para la tarjeta oscura y el icono cuadrado para la ficha.
    "/logo-flechacarga.png": FLECHA_DIR / "logo-flechacarga-claro.png",
    "/logo-flechacarga-blanco.png": FLECHA_DIR / "logo-flechacarga.png",
    "/logo-flechacarga-icono.png": FLECHA_DIR / "logo-flechacarga-icono.png",
}


def _numero(x, nombre: str) -> float:
    try:
        return float(str(x).strip().replace(",", "."))
    except (TypeError, ValueError):
        raise ValueError(f"{nombre} invalido: {x!r}")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)

    # ---------- GET ----------

    def do_GET(self):
        url = urlparse(self.path)
        ruta, query = url.path, parse_qs(url.query)
        if ruta in ("/", ""):
            ruta = "/index.html"
        if ruta in ESTATICOS:
            self._archivo(ESTATICOS[ruta])
            return
        if ruta == "/api/estado":
            self._json(HTTPStatus.OK, self._estado())
            return
        if ruta == "/api/destinos":
            with _lock_catalogos:
                self._json(HTTPStatus.OK, cargar_destinos())
            return
        if ruta == "/api/sucursales":
            prov = normalizar((query.get("provincia") or [""])[0])
            datos = cargar_sucursales() or {}
            lista = [{"codigo": s["codigo"], "nombre": s["nombre"], "cp": s["cp"]}
                     for s in (datos.get("provincias") or {}).get(prov, []) if s.get("HABILITADA") != "N"]
            self._json(HTTPStatus.OK, {"provincia": prov, "sucursales": lista})
            return
        if ruta == "/api/sucursal":
            codigo = (query.get("codigo") or [""])[0].strip()
            if not codigo:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "falta el parametro codigo"})
                return
            try:
                self._json(HTTPStatus.OK, detalle_sucursal(codigo))
            except ValueError as e:
                self._json(HTTPStatus.NOT_FOUND, {"error": str(e)})
            except Exception as e:
                self._json(HTTPStatus.BAD_GATEWAY, {"error": f"No se pudo consultar la sucursal: {e}"})
            return
        if ruta == "/api/agencias":
            cp = (query.get("cp") or [""])[0].strip()
            localidad = (query.get("localidad") or [""])[0].strip()
            try:
                lista = agencias_en(cp, localidad) if (cp or localidad) else cargar_agencias()["agencias"]
            except Exception as e:
                self._json(HTTPStatus.BAD_GATEWAY, {"error": f"No se pudo cargar el listado de agencias: {e}"})
                return
            lista = sorted(lista, key=lambda a: (not a.get("recibe_encomiendas"), a.get("nombre", "")))
            self._json(HTTPStatus.OK, {"agencias": lista})
            return
        if ruta == "/api/limites":
            self._json(HTTPStatus.OK, limites_valor_declarado())
            return
        if ruta == "/api/micorreo/pendiente":
            self._micorreo_pendiente((query.get("version") or [""])[0])
            return
        if ruta == "/api/micorreo/encargo":
            with _lock_encargos:
                e = _encargos.get((query.get("id") or [""])[0])
                vista = {k: e[k] for k in ("estado", "visto", "mensaje", "avisos")} if e else None
            if vista is None:
                self._json(HTTPStatus.NOT_FOUND, {"error": "envio desconocido"})
            else:
                self._json(HTTPStatus.OK, vista)
            return
        if ruta == "/api/pedidos":
            self._pedidos(lambda: {"pedidos": pedidos.listar_pendientes(), **pedidos.estado()})
            return
        if ruta == "/api/pedido":
            pid = (query.get("id") or [""])[0].strip()
            self._pedidos(lambda: pedidos.obtener(pid))
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "no encontrado"})

    def _pedidos(self, fn):
        try:
            self._json(HTTPStatus.OK, fn())
        except pedidos.SinSesion as e:
            self._json(HTTPStatus.UNAUTHORIZED, {"error": str(e), "sin_sesion": True})
        except ValueError as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(e)})
        except LookupError as e:
            self._json(HTTPStatus.NOT_FOUND, {"error": str(e)})
        except Exception as e:
            self._json(HTTPStatus.BAD_GATEWAY, {"error": f"No se pudieron leer los pedidos: {e}"})

    def _estado(self):
        sesion = correo_auth.STATE_FILE
        edad = time.time() - sesion.stat().st_mtime if sesion.exists() else None
        sucursales = cargar_sucursales() or {}
        try:
            localidades = cargar_localidades()
        except Exception:
            localidades = {}
        try:
            agencias = cargar_agencias()
        except Exception:
            agencias = {}
        try:
            tarifas = flechacarga.cargar_tarifas()
        except Exception:
            tarifas = {}
        try:
            puntos = flechacarga.cargar_sucursales()
        except Exception:
            puntos = {}
        return {
            "flecha": {
                "destinos": len(tarifas.get("destinos") or []),
                "tarifario": tarifas.get("fuente") or "",
                "tarifario_actualizado": tarifas.get("actualizado"),
                "puntos": len(puntos.get("sucursales") or []),
                "puntos_actualizado": puntos.get("actualizado"),
            },
            "correo": {
                "credenciales": bool(os.environ.get("MICORREO_EMAIL") and os.environ.get("MICORREO_PASSWORD")),
                "email": os.environ.get("MICORREO_EMAIL") or "",
                "sesion_guardada": sesion.exists(),
                "sesion_fresca": correo_auth._session_is_fresh(),
                "sesion_minutos": round(edad / 60) if edad is not None else None,
                "sucursales": sucursales.get("total"),
                "sucursales_actualizado": sucursales.get("actualizado"),
            },
            "viacargo": {
                "localidades": localidades.get("cantidad"),
                "localidades_actualizado": localidades.get("actualizado"),
                "agencias": agencias.get("cantidad"),
                "agencias_actualizado": agencias.get("actualizado"),
                "limites": limites_valor_declarado(),
            },
            "provincias": PROVINCIAS,
            "ocupado_correo": _lock_correo.locked(),
            "pedidos": pedidos.estado(),
            "extension": extension_contacto and {**extension_contacto, "hace_segundos": round(time.time() - extension_contacto["cuando"])},
            "extension_carpeta": str(EXTENSION_DIR),
        }

    # ---------- POST ----------

    def do_POST(self):
        global ultimo_latido
        ruta = urlparse(self.path).path
        if ruta in ("/api/latido", "/api/adios"):
            # Al cerrar la ventana llega "adios": se adelanta el reloj para que la app se apague
            # en unos segundos salvo que vuelva un latido (recarga o segunda ventana).
            ultimo_latido = time.time() - (LATIDO_LIMITE - 8 if ruta == "/api/adios" else 0)
            self._json(HTTPStatus.OK, {"ok": True})
            return
        datos = self._leer_json()
        if datos is None:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "JSON invalido"})
            return
        if ruta == "/api/correo/cotizar":
            self._correo_cotizar(datos)
        elif ruta == "/api/viacargo/cotizar":
            self._viacargo_cotizar(datos)
        elif ruta == "/api/flecha/cotizar":
            self._flecha_cotizar(datos)
        elif ruta == "/api/flecha/tarifario":
            self._flecha_tarifario(datos)
        elif ruta == "/api/correo/abrir":
            self._correo_abrir(datos)
        elif ruta == "/api/destinos/actualizar":
            self._actualizar(datos)
        elif ruta == "/api/pedidos/login":
            self._pedidos(lambda: pedidos.iniciar_sesion(datos.get("email"), datos.get("password")))
        elif ruta == "/api/pedidos/salir":
            pedidos.cerrar_sesion()
            self._json(HTTPStatus.OK, pedidos.estado())
        elif ruta == "/api/correo/credenciales":
            self._correo_credenciales(datos)
        elif ruta in ("/api/micorreo/tomar", "/api/micorreo/resultado", "/api/micorreo/cancelar"):
            self._micorreo_encargo(ruta.rsplit("/", 1)[1], datos)
        else:
            self._json(HTTPStatus.NOT_FOUND, {"error": "no encontrado"})

    def _params_paquete(self, datos):
        return dict(
            peso_kg=_numero(datos["peso"], "peso"),
            largo_cm=_numero(datos["largo"], "largo"),
            ancho_cm=_numero(datos["ancho"], "ancho"),
            alto_cm=_numero(datos["alto"], "alto"),
            valor=_numero(datos["valor"], "valor"),
        )

    def _correo_cotizar(self, datos):
        try:
            params = dict(
                provincia=normalizar(datos["provincia"]),
                tipo_entrega=datos.get("entrega", "domicilio"),
                cp=(str(datos.get("cp") or "").strip() or None),
                sucursal_destino=(str(datos.get("sucursal_destino") or "").strip() or None),
                sucursal_origen=(str(datos.get("sucursal_origen") or "").strip() or None),
                **self._params_paquete(datos),
            )
            if params["provincia"] not in PROVINCIAS:
                raise ValueError(f"provincia desconocida: {params['provincia']}")
        except (KeyError, TypeError, ValueError) as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": f"Parametros invalidos: {e}"})
            return
        inicio = time.time()
        with _lock_correo:
            espera = time.time() - inicio
            try:
                resultado = cotizar_correo(**params)
            except (RuntimeError, ValueError) as e:
                self._json(HTTPStatus.BAD_GATEWAY, {"error": str(e)})
                return
            except Exception as e:  # Playwright / red
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"{type(e).__name__}: {e}"})
                return
        resultado["_segundos"] = round(time.time() - inicio, 1)
        resultado["_espera"] = round(espera, 1)
        self._json(HTTPStatus.OK, resultado)

    def _viacargo_cotizar(self, datos):
        try:
            params = dict(
                cp_origen=str(datos["origen"]).strip(),
                cp_destino=str(datos["destino"]).strip(),
                pago=str(datos.get("pago") or "P"),
                bultos=int(datos.get("bultos") or 1),
                **self._params_paquete(datos),
            )
        except (KeyError, TypeError, ValueError) as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": f"Parametros invalidos: {e}"})
            return
        inicio = time.time()
        try:
            resultado = cotizar_viacargo(**params)
        except ValueError as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(e)})
            return
        except RuntimeError as e:
            self._json(HTTPStatus.BAD_GATEWAY, {"error": str(e)})
            return
        except Exception as e:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"{type(e).__name__}: {e}"})
            return
        resultado["_segundos"] = round(time.time() - inicio, 1)
        self._json(HTTPStatus.OK, resultado)

    def _flecha_cotizar(self, datos):
        # La tarifa sale del CP de destino (destinos.json -> flechacarga): Punto Flecha a Punto Flecha.
        cp = str(datos.get("cp") or "").strip()
        with _lock_catalogos:
            destino = next((d for d in cargar_destinos()["destinos"] if d["cp"] == cp), None)
        cob = destino and destino.get("flechacarga")
        if not cob:
            self._json(HTTPStatus.BAD_REQUEST, {"error": f"Flecha Carga no tiene sucursal para retirar en el CP {cp}."})
            return
        try:
            factor = _numero(datos.get("factor_vol") or 0, "factor")
            resultado = flechacarga.cotizar(
                flechacarga.resolver_destino(cob["etiqueta"]),
                peso_kg=_numero(datos["peso"], "peso"),
                largo_cm=_numero(datos.get("largo") or 0, "largo"),
                ancho_cm=_numero(datos.get("ancho") or 0, "ancho"),
                alto_cm=_numero(datos.get("alto") or 0, "alto"),
                seguro=_numero(datos.get("seguro") or 0, "seguro"),
                factor_vol=factor if factor > 0 else None,
            )
        except (KeyError, TypeError, ValueError) as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": f"Parametros invalidos: {e}"})
            return
        resultado["puntos"] = flechacarga.puntos_por_indice(cob["puntos"])
        resultado["tarifa_general"] = cob["general"]
        try:
            resultado["tarifario"] = flechacarga.cargar_tarifas().get("fuente") or ""
        except Exception:
            pass
        self._json(HTTPStatus.OK, resultado)

    def _flecha_tarifario(self, datos):
        texto = str(datos.get("texto") or "")
        try:
            with _lock_catalogos:
                t = flechacarga.importar_tarifario(texto=texto, nombre_fuente=str(datos.get("nombre") or "tarifario.csv"))
                cargar_destinos(forzar=True)
        except ValueError as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(e)})
            return
        self._json(HTTPStatus.OK, {"ok": True, "destinos": len(t["destinos"]), "fuente": t["fuente"]})

    def _correo_abrir(self, datos):
        if datos.get("modo") != "ventana":
            self._correo_abrir_navegador(datos)
            return
        # Modo ventana, igual que el cotizador del Correo: proceso aparte para que la ventana
        # visible no bloquee al servidor (queda abierta hasta que el usuario la cierra).
        try:
            p = self._params_paquete(datos)
            args = [
                sys.executable, str(CORREO_DIR / "cotizador.py"), "--abrir",
                "--provincia", normalizar(datos["provincia"]),
                "--entrega", str(datos.get("entrega", "domicilio")),
                "--peso", str(p["peso_kg"]), "--largo", str(p["largo_cm"]), "--ancho", str(p["ancho_cm"]),
                "--alto", str(p["alto_cm"]), "--valor", str(p["valor"]),
            ]
            if datos.get("cp"):
                args += ["--cp", str(datos["cp"]).strip()]
            if datos.get("sucursal_destino"):
                args += ["--sucursal-destino", str(datos["sucursal_destino"]).strip()]
            if datos.get("sucursal_origen"):
                args += ["--sucursal-origen", str(datos["sucursal_origen"]).strip()]
            # Destinatario del pedido asignado (opcional): MiCorreo lo deja completo.
            dest = datos.get("destinatario") or {}
            for clave, flag in (("nombre", "--dest-nombre"), ("email", "--dest-email"), ("cod_area", "--dest-cod-area"),
                                ("celular", "--dest-celular"), ("nro_orden", "--nro-orden")):
                valor = str(dest.get(clave) or "").strip()
                if valor:
                    args += [flag, valor]
        except (KeyError, TypeError, ValueError) as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": f"Parametros invalidos: {e}"})
            return
        flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
        try:
            # cwd = carpeta de trabajo (../Correo o, en la app instalada, la de datos: ahi no existe ../Correo).
            subprocess.Popen(args, cwd=str(DATOS_DIR), creationflags=flags, stdin=subprocess.DEVNULL,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
        except OSError as e:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"No se pudo iniciar el navegador de MiCorreo: {e}"})
            return
        self._json(HTTPStatus.OK, {"ok": True})

    def _correo_abrir_navegador(self, datos):
        # Modo navegador: se guarda el envio y se abre envioCla en el Brave del usuario, con sus
        # cuentas (Mercado Pago, etc.). extension-micorreo lo toma y completa el formulario con los
        # mismos pasos que cotizador._completar_formulario. Sin extension, el envio vence solo.
        try:
            p = self._params_paquete(datos)
            entrega = str(datos.get("entrega") or "sucursal")
            if entrega not in ("sucursal", "domicilio"):
                raise ValueError(f"entrega desconocida: {entrega}")
            dest = datos.get("destinatario") or {}
            encargo = {
                "provincia": normalizar(datos["provincia"]),
                "entrega": entrega,
                "cp": str(datos.get("cp") or "").strip(),
                "sucursal_destino": str(datos.get("sucursal_destino") or "").strip(),
                "sucursal_origen": str(datos.get("sucursal_origen") or "").strip(),
                "largo": _fmt_entero(p["largo_cm"]), "ancho": _fmt_entero(p["ancho_cm"]), "alto": _fmt_entero(p["alto_cm"]),
                "peso": _fmt_peso(p["peso_kg"]), "valor": _fmt_entero(p["valor"]),
                "destinatario": {k: str(dest.get(k) or "").strip()
                                 for k in ("nombre", "email", "cod_area", "celular", "nro_orden") if dest.get(k)},
            }
        except (KeyError, TypeError, ValueError) as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": f"Parametros invalidos: {e}"})
            return
        lugar = encargo["sucursal_destino"] or f"CP {encargo['cp']}"
        resumen = f"{lugar} · {encargo['largo']}×{encargo['ancho']}×{encargo['alto']} cm · {encargo['peso']} kg"
        id_ = uuid.uuid4().hex[:12]
        with _lock_encargos:
            ahora = time.time()
            # Un envio nuevo reemplaza a los que nadie tomo (si no, la extension podria cargar uno viejo).
            for e in _encargos.values():
                if e["estado"] == "esperando":
                    e["estado"] = "reemplazado"
            for k in [k for k, e in _encargos.items() if ahora - e["creado"] > ENCARGO_VIGENCIA]:
                del _encargos[k]
            _encargos[id_] = {"id": id_, "datos": {"id": id_, **encargo}, "resumen": resumen, "creado": ahora,
                              "estado": "esperando", "visto": False, "mensaje": "", "avisos": []}
        try:
            _abrir_navegador_usuario(ENVIO_CLA_URL)
        except OSError as e:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"No se pudo abrir el navegador: {e}"})
            return
        self._json(HTTPStatus.OK, {"ok": True, "id": id_})

    def _micorreo_pendiente(self, version):
        global extension_contacto
        extension_contacto = {"version": version, "cuando": time.time()}
        with _lock_encargos:
            ahora = time.time()
            vivos = [e for e in _encargos.values() if e["estado"] == "esperando" and ahora - e["creado"] < ENCARGO_VIGENCIA]
            ultimo = max(vivos, key=lambda e: e["creado"], default=None)
            if ultimo:
                ultimo["visto"] = True
        self._json(HTTPStatus.OK, {"encargo": {"id": ultimo["id"], "resumen": ultimo["resumen"]} if ultimo else None})

    def _micorreo_encargo(self, accion, datos):
        with _lock_encargos:
            e = _encargos.get(str(datos.get("id") or ""))
            if e is None:
                self._json(HTTPStatus.NOT_FOUND, {"error": "envio desconocido"})
            elif accion == "tomar":
                if e["estado"] != "esperando" or time.time() - e["creado"] > ENCARGO_VIGENCIA:
                    self._json(HTTPStatus.CONFLICT, {"error": "ese envio ya no esta disponible"})
                else:
                    e["estado"] = "tomado"
                    self._json(HTTPStatus.OK, {"encargo": e["datos"]})
            elif accion == "resultado":
                e["estado"] = "listo" if datos.get("ok") else "error"
                e["mensaje"] = str(datos.get("mensaje") or "")
                e["avisos"] = [str(a) for a in (datos.get("avisos") or [])]
                self._json(HTTPStatus.OK, {"ok": True})
            else:  # cancelar
                if e["estado"] == "esperando":
                    e["estado"] = "cancelado"
                self._json(HTTPStatus.OK, {"ok": True})

    def _correo_credenciales(self, datos):
        # Se guardan en el .env de la carpeta de trabajo (el mismo que lee auth.py) y se
        # aplican al proceso. Con otra cuenta, la sesion guardada ya no sirve.
        email = str(datos.get("email") or "").strip()
        password = str(datos.get("password") or "")
        if not email or not password:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "Falta el email o la contraseña."})
            return
        if "\n" in email + password or '"' in email + password:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "El email o la contraseña tienen caracteres no admitidos."})
            return
        with _lock_correo:
            cambio_cuenta = os.environ.get("MICORREO_EMAIL") != email
            Path(".env").write_text(f'MICORREO_EMAIL="{email}"\nMICORREO_PASSWORD="{password}"\n', encoding="utf-8")
            os.environ["MICORREO_EMAIL"], os.environ["MICORREO_PASSWORD"] = email, password
            if cambio_cuenta:
                correo_auth.STATE_FILE.unlink(missing_ok=True)
        self._json(HTTPStatus.OK, {"ok": True, "email": email})

    def _actualizar(self, datos):
        cual = str(datos.get("catalogo") or "todos")
        if cual not in ("todos", "localidades", "sucursales", "agencias", "puntos_flecha"):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "catalogo desconocido"})
            return
        try:
            with _lock_catalogos:
                hecho = {}
                if cual in ("todos", "puntos_flecha"):
                    # Tambien deja al dia la copia de pedidosv2 ("Sucursales disponibles"), si esta en esta PC.
                    hecho["puntos_flecha"] = len(flechacarga.descargar_sucursales()["sucursales"])
                if cual == "puntos_flecha":
                    hecho["destinos"] = cargar_destinos(forzar=True)["cantidad"]
                if cual in ("todos", "agencias"):
                    hecho["agencias"] = descargar_agencias()["cantidad"]
                if cual not in ("agencias", "puntos_flecha"):
                    # Las sucursales del Correo se bajan con el navegador (requiere sesion).
                    if cual in ("todos", "sucursales"):
                        with _lock_correo:
                            hecho.update(actualizar_catalogos(cual))
                    else:
                        hecho.update(actualizar_catalogos(cual))
        except Exception as e:
            self._json(HTTPStatus.BAD_GATEWAY, {"error": f"No se pudo actualizar ({cual}): {e}"})
            return
        self._json(HTTPStatus.OK, {"ok": True, "actualizado": hecho})

    # ---------- utilidades ----------

    def _archivo(self, path: Path):
        if not path.exists():
            self._json(HTTPStatus.NOT_FOUND, {"error": f"falta {path.name}"})
            return
        tipo = "text/html; charset=utf-8" if path.suffix == ".html" else "image/png"
        cuerpo = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(cuerpo)

    def _leer_json(self):
        try:
            largo = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(largo) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return None

    def _json(self, status, payload):
        cuerpo = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)


def _abrir_navegador_usuario(url):
    # Brave si esta instalado (el navegador de trabajo, con las cuentas abiertas); si no, el predeterminado.
    # Con Brave abierto, el proceso nuevo solo le pasa la URL y termina: se abre como pestana.
    brave = next((r for r in correo_auth.BRAVE_RUTAS if r.is_file()), None)
    if brave is None:
        webbrowser.open(url)
        return
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    subprocess.Popen([str(brave), url], creationflags=flags, stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)


def main():
    numeros = [a for a in sys.argv[1:] if a.isdigit()]
    puerto = int(numeros[0]) if numeros else PORT
    server = ThreadingHTTPServer((HOST, puerto), Handler)
    url = f"http://{HOST}:{puerto}/"
    print(f"Comparador de envios disponible en {url}  (Ctrl+C para detener)")
    if "--sin-navegador" not in sys.argv:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
