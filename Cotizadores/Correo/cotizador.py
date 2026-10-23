"""
Cliente de cotizacion de envios de MiCorreo (Correo Argentino).

Automatiza el formulario real de la pantalla de cotizacion (envioCla), tal
como lo completaria un usuario: medidas, peso y valor declarado del paquete;
tipo de entrega (domicilio o sucursal), provincia y CP / sucursal de destino;
y lee los precios que el propio sitio calcula (Clasico / Expreso / Hoy).

No reimplementa a mano los endpoints internos (checkcp, consultarSO,
tipoProducto, valNEpreimpo, cotizarNE) porque dependen de tokens CSRF y
estado de sesion que el JS del sitio ya maneja correctamente; en cambio, se
le pide al navegador que haga exactamente lo que haria un usuario real.

El login es automatico: lee MICORREO_EMAIL / MICORREO_PASSWORD desde .env
(ver .env.example) y renueva la sesion sola cuando expira (aprox cada 2
horas segun lo observado). No hace falta ejecutar nada a mano de antemano.

Uso como script:
    # Entrega en domicilio (por CP)
    python cotizador.py --provincia "Buenos Aires" --cp 1900 --peso 2 \
        --largo 20 --ancho 15 --alto 10 --valor 15000

    # Entrega en sucursal (por nombre de sucursal)
    python cotizador.py --entrega sucursal --provincia "Buenos Aires" \
        --sucursal-destino MUNRO --peso 2 --largo 20 --ancho 15 --alto 10 --valor 150000

Uso como libreria:
    from cotizador import cotizar
    r = cotizar(provincia="Buenos Aires", cp="1900", peso_kg=2,
                largo_cm=20, ancho_cm=15, alto_cm=10, valor=15000)
    r = cotizar(provincia="Buenos Aires", tipo_entrega="sucursal",
                sucursal_destino="MUNRO", peso_kg=2,
                largo_cm=20, ancho_cm=15, alto_cm=10, valor=150000)
"""

import argparse
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

from auth import ensure_logged_in, opciones_navegador

ENVIO_CLA_URL = "https://www.correoargentino.com.ar/MiCorreo/public/envioCla"
STATE_FILE = Path("auth_state.json")
LOADING_TEXT = "Cargando..."
WAIT_TIMEOUT_MS = 20000


def _fmt_entero(x) -> str:
    # Medidas y valor declarado: el sitio borra todo lo que no sea digito y
    # limita las medidas a 3 caracteres, asi que "20.0" se rompe. Enviar "20".
    return str(int(round(float(x))))


def _fmt_peso(x) -> str:
    # El sitio espera lo que tipea una persona: "2" o "2,5" (coma decimal).
    x = float(x)
    if x.is_integer():
        return str(int(x))
    return f"{x:.3f}".rstrip("0").rstrip(".").replace(".", ",")


def cotizar(
    provincia: str,
    peso_kg: float,
    largo_cm: float,
    ancho_cm: float,
    alto_cm: float,
    valor: float,
    cp: str | None = None,
    tipo_entrega: str = "domicilio",
    sucursal_destino: str | None = None,
    sucursal_origen: str | None = None,
    headless: bool = True,
) -> dict:
    if tipo_entrega == "domicilio" and not cp:
        raise ValueError("Para entrega en domicilio hace falta el CP de destino (cp=...).")
    if tipo_entrega == "sucursal" and not sucursal_destino:
        raise ValueError("Para entrega en sucursal hace falta el nombre de la sucursal (sucursal_destino=...).")

    ensure_logged_in()

    # Playwright sync no permite anidar instancias, asi que el relogin tiene
    # que ocurrir fuera del bloque del navegador: si la sesion guardada no
    # sirve, cerramos todo, nos logueamos de nuevo y reintentamos una vez.
    for intento in range(2):
        resultado = _cotizar_con_sesion(
            provincia, cp, peso_kg, largo_cm, ancho_cm, alto_cm, valor,
            tipo_entrega, sucursal_destino, sucursal_origen, headless,
        )
        if resultado is not None:
            return resultado
        if intento == 0:
            ensure_logged_in(force=True)

    raise RuntimeError("No se pudo llegar a la pantalla de cotizacion ni siquiera tras relogin.")


def _fijar_origen(page, sucursal_origen):
    # Por defecto el sitio usa la "sucursal cabecera" de la cuenta. Si se pide
    # otra, disparamos el mismo handler que usa el sitio al elegir sucursal.
    if sucursal_origen:
        error = page.evaluate(
            """(suc) => {
                const $suc = $("#sucursalOrigen");
                const $opt = $suc.find('option[value="' + suc + '"]');
                if ($opt.length === 0) return "sucursal de origen " + suc + " no existe en el listado";
                $("#sucursalProvinciaOrigen").val(suc.charAt(0));
                $suc.val(suc).trigger("change");
                return null;
            }""",
            sucursal_origen,
        )
        if error:
            raise RuntimeError(f"No se pudo fijar el origen: {error}")

    return page.evaluate(
        """() => {
            const suc = $("#input_origen_sucursal").val() || $("#tieneSucursalCabecera").val();
            const $opt = $("#sucursalOrigen option[value='" + suc + "']");
            return {
                sucursal: suc,
                nombre: $opt.length ? $opt.text().trim() : null,
                cp: $("#cp_origen").val(),
                provincia: $("#codigoProO").val(),
            };
        }"""
    )


def _destino_domicilio(page, provincia, cp):
    page.wait_for_selector("#provincia", state="visible", timeout=10000)
    page.select_option("#provincia", label=provincia.upper())
    page.wait_for_selector("#cpCpa", state="visible", timeout=10000)
    page.fill("#cpCpa", str(cp))
    page.locator("#cpCpa").press("Tab")
    return {"tipo": "domicilio", "provincia": provincia.upper(), "cp": str(cp)}


def _destino_sucursal(page, provincia, sucursal_destino):
    page.wait_for_selector("#provincia2", state="visible", timeout=10000)
    page.select_option("#provincia2", label=provincia.upper())

    # El sitio carga las sucursales de la provincia via AJAX (/consultarSO).
    page.wait_for_function(
        "() => document.querySelectorAll('#sucursalDestino2 option').length > 1",
        timeout=WAIT_TIMEOUT_MS,
    )

    # Varias sucursales comparten CP (el value del option), asi que elegimos
    # el option exacto por codigo de sucursal (su class, ej. B0721) o, si no,
    # por nombre, y disparamos el change como haria el sitio.
    seleccion = page.evaluate(
        """(nombre) => {
            const target = nombre.trim().toUpperCase();
            const opts = Array.from(document.querySelectorAll('#sucursalDestino2 option'))
                .filter(o => o.value !== '-1');
            let opt = opts.find(o => o.className.trim().toUpperCase() === target)
                   || opts.find(o => o.textContent.trim().toUpperCase() === target)
                   || opts.find(o => o.textContent.trim().toUpperCase().startsWith(target))
                   || opts.find(o => o.textContent.trim().toUpperCase().includes(target));
            if (!opt) {
                return { error: 'no hay sucursal que coincida con "' + nombre + '"',
                         parecidas: opts.map(o => o.textContent.trim())
                                        .filter(t => t.toUpperCase().includes(target.split(' ')[0]))
                                        .slice(0, 15) };
            }
            opt.selected = true;
            $('#sucursalDestino2').trigger('change');
            return { tipo: 'sucursal', sucursal: opt.className, nombre: opt.textContent.trim(), cp: opt.value };
        }""",
        sucursal_destino,
    )
    if seleccion.get("error"):
        raise RuntimeError(f"{seleccion['error']}. Parecidas: {seleccion.get('parecidas')}")
    seleccion["provincia"] = provincia.upper()
    return seleccion


def _abrir_envio_cla(p, headless, opcion=None):
    """Abre envioCla con la sesion guardada. Devuelve (browser, page) o None si la sesion no sirve."""
    browser = p.chromium.launch(headless=headless, **(opcion or {}))
    context = browser.new_context(storage_state=str(STATE_FILE), viewport=None if not headless else {"width": 1280, "height": 900})
    page = context.new_page()
    page.goto(ENVIO_CLA_URL)
    if "envioCla" not in page.url:
        browser.close()
        return None
    return browser, page


def _cargar_medidas(page, largo_cm, ancho_cm, alto_cm, peso_kg=None, valor=None):
    page.fill("#largo", _fmt_entero(largo_cm))
    page.fill("#ancho", _fmt_entero(ancho_cm))
    page.fill("#alto", _fmt_entero(alto_cm))
    if peso_kg is not None:
        page.fill("#peso", _fmt_peso(peso_kg))
    if valor is not None:
        page.fill("#valorContenido", _fmt_entero(valor))
    # El handler de valorContenido limpia el campo en un setTimeout(0);
    # le damos un instante y verificamos que quedo lo que queriamos.
    page.wait_for_timeout(200)
    return page.evaluate(
        """() => ({
            largo: $('#largo').val(), ancho: $('#ancho').val(), alto: $('#alto').val(),
            peso: $('#peso').val(), valor: $('#valorContenido').val(),
        })"""
    )


def _completar_formulario(
    page, provincia, cp, peso_kg, largo_cm, ancho_cm, alto_cm, valor,
    tipo_entrega, sucursal_destino, sucursal_origen,
):
    """Completa el formulario de envioCla igual que un usuario y espera los precios."""
    origen = _fijar_origen(page, sucursal_origen)

    # Paso 1: medidas del paquete (la seccion de destino arranca oculta)
    ingresado = _cargar_medidas(page, largo_cm, ancho_cm, alto_cm, peso_kg, valor)
    page.click("#next")

    # Puede aparecer un modal ofreciendo guardar estas medidas como frecuentes.
    try:
        page.wait_for_selector("#exampleModal.show", timeout=3000)
        page.click("#exampleModal button:has-text('Cancelar')")
        page.wait_for_selector("#exampleModal.show", state="hidden", timeout=3000)
    except Exception:
        pass

    page.wait_for_selector("#eDestino", state="visible", timeout=15000)

    # Paso 2: destino
    page.select_option("#tipoEntrega", value=tipo_entrega)
    if tipo_entrega == "domicilio":
        destino = _destino_domicilio(page, provincia, cp)
    else:
        destino = _destino_sucursal(page, provincia, sucursal_destino)

    # Paso 3: esperar los precios
    try:
        page.wait_for_function(
            """() => ['CLASICO', 'EXPRESO', 'HOY'].some(id => {
                const el = document.getElementById(id);
                const t = el ? el.textContent.trim() : '';
                return t !== '' && t !== 'Cargando...';
            })""",
            timeout=WAIT_TIMEOUT_MS,
        )
    except Exception:
        pass

    resultado = {"origen": origen, "destino": destino, "paquete": ingresado}
    for id_, nombre in (("CLASICO", "clasico"), ("EXPRESO", "expreso"), ("HOY", "hoy")):
        locator = page.locator(f"#{id_}")
        if locator.count() > 0:
            texto = locator.inner_text().strip()
            if texto and texto != LOADING_TEXT:
                resultado[nombre] = texto

    errores = page.locator("#verifi-cpO-cp")
    if errores.count() > 0 and errores.is_visible():
        resultado["_advertencia"] = "El sitio marco un error de validacion de destino."
    return resultado


def _cotizar_con_sesion(
    provincia, cp, peso_kg, largo_cm, ancho_cm, alto_cm, valor,
    tipo_entrega, sucursal_destino, sucursal_origen, headless,
):
    with sync_playwright() as p:
        abierto = _abrir_envio_cla(p, headless)
        if abierto is None:
            return None
        browser, page = abierto
        try:
            resultado = _completar_formulario(
                page, provincia, cp, peso_kg, largo_cm, ancho_cm, alto_cm, valor,
                tipo_entrega, sucursal_destino, sucursal_origen,
            )
            # Refrescar la sesion guardada por si el sitio la extendio.
            try:
                page.context.storage_state(path=str(STATE_FILE))
            except Exception:
                pass
            return resultado
        finally:
            browser.close()


# ---------------------------------------------------------------------------
# Continuar el envio en MiCorreo: abre un navegador visible con el formulario
# ya completo (medidas, destino, cotizacion y, si se pasa, los datos de
# contacto del destinatario) y lo deja en manos del usuario para elegir el
# servicio y pagar. La funcion no retorna hasta que se cierra la ventana.
# ---------------------------------------------------------------------------

# Datos de contacto del destinatario segun el tipo de entrega. La direccion
# (domicilio) no se completa: se carga a mano en el sitio.
CAMPOS_DESTINATARIO = {
    "sucursal": {"nombre": "#nars2", "email": "#correoElectronico2", "cod_area": "#codAreaPaqSuc", "celular": "#celularPaqSuc"},
    "domicilio": {"nombre": "#nars", "email": "#correoElectronico", "cod_area": "#codAreaPaqDom", "celular": "#celularPaqDom"},
}


def _completar_destinatario(page, tipo_entrega, destinatario) -> dict:
    campos = {"nro_orden": "#nroOpcional", **CAMPOS_DESTINATARIO[tipo_entrega]}
    cargado = {}
    for clave, selector in campos.items():
        valor = str(destinatario.get(clave) or "").strip()
        if not valor:
            continue
        loc = page.locator(selector)
        try:
            loc.wait_for(state="visible", timeout=5000)
            loc.fill(valor)
        except Exception:
            # Si el sitio todavia lo tiene oculto, se carga igual: queda al mostrarse.
            page.evaluate("([s, v]) => { $(s).val(v).trigger('input'); }", [selector, valor])
        # Los validadores del sitio corren al cambiar / salir del campo.
        page.evaluate("(s) => { $(s).trigger('change').trigger('blur'); }", selector)
        cargado[clave] = loc.input_value()
    return cargado


def abrir_en_micorreo(
    provincia, peso_kg, largo_cm, ancho_cm, alto_cm, valor, cp=None,
    tipo_entrega="domicilio", sucursal_destino=None, sucursal_origen=None,
    destinatario=None,
) -> dict:
    ensure_logged_in()
    for intento in range(2):
        with sync_playwright() as p:
            abierto = None
            # Brave/Chrome/Edge reales si estan instalados (mas familiar para operar); si no, Chromium.
            for opcion in opciones_navegador():
                try:
                    abierto = _abrir_envio_cla(p, headless=False, opcion=opcion)
                    break
                except Exception:
                    continue
            if abierto is not None:
                browser, page = abierto
                try:
                    resultado = _completar_formulario(
                        page, provincia, cp, peso_kg, largo_cm, ancho_cm, alto_cm, valor,
                        tipo_entrega, sucursal_destino, sucursal_origen,
                    )
                    if destinatario:
                        try:
                            resultado["destinatario"] = _completar_destinatario(page, tipo_entrega, destinatario)
                        except Exception as e:
                            # El envio igual se puede seguir a mano: no se cierra la ventana.
                            resultado["_advertencia_destinatario"] = f"No se pudo completar el destinatario: {e}"
                    page.bring_to_front()
                    try:
                        page.wait_for_event("close", timeout=0)  # hasta que el usuario cierre la pestana
                    except Exception:
                        pass
                    return resultado
                finally:
                    try:
                        browser.close()
                    except Exception:
                        pass
        # Hubo navegador pero la sesion no sirve (o no se pudo lanzar ninguno). El relogin va
        # fuera del bloque del navegador: Playwright sync no permite anidar instancias.
        if intento == 0:
            ensure_logged_in(force=True)
    raise RuntimeError("No se pudo abrir MiCorreo con la sesion guardada.")


# ---------------------------------------------------------------------------
# Guardar medidas frecuentes en MiCorreo (largo/ancho/alto con un alias), la
# unica forma de "guardar" que ofrece el sitio en la etapa de cotizacion.
# ---------------------------------------------------------------------------

def guardar_medidas_micorreo(largo_cm, ancho_cm, alto_cm, alias: str, predeterminada: bool = False, headless: bool = True) -> dict:
    alias = (alias or "").strip()
    if not alias:
        raise ValueError("Hace falta un nombre o alias para las medidas.")
    ensure_logged_in()
    for intento in range(2):
        with sync_playwright() as p:
            abierto = _abrir_envio_cla(p, headless)
            if abierto is None:
                if intento == 0:
                    ensure_logged_in(force=True)
                    continue
                raise RuntimeError("No se pudo llegar a la pantalla de cotizacion ni siquiera tras relogin.")
            browser, page = abierto
            try:
                ingresado = _cargar_medidas(page, largo_cm, ancho_cm, alto_cm)
                # El boton "Guardar medida" abre el modal solo si no hay una medida frecuente elegida.
                page.evaluate("() => { $('#medidasFrecuentes').val('-1'); }")
                page.click("#guardarMedidasF")
                page.wait_for_selector("#exampleModal.show", timeout=5000)
                page.fill("#aliasMedidas", alias)
                if predeterminada:
                    page.check("#recordar")
                with page.expect_response(lambda r: "guardarMedidasFrecuentes" in r.url, timeout=15000) as resp_info:
                    page.click("#btFormModalMF")
                respuesta = resp_info.value
                cuerpo = ""
                try:
                    cuerpo = respuesta.text()
                except Exception:
                    pass
                if respuesta.status != 200:
                    raise RuntimeError(f"MiCorreo respondio {respuesta.status} al guardar las medidas: {cuerpo[:200]}")
                return {"guardado": True, "alias": alias, "predeterminada": predeterminada, "medidas": ingresado, "respuesta": cuerpo[:300]}
            finally:
                browser.close()
    raise RuntimeError("No se pudieron guardar las medidas.")


def main():
    parser = argparse.ArgumentParser(description="Cotizar un envio en MiCorreo")
    parser.add_argument("--provincia", help='Provincia de destino. Ej: "Buenos Aires"')
    parser.add_argument("--entrega", default="domicilio", choices=["domicilio", "sucursal"])
    parser.add_argument("--cp", help="CP de destino (entrega en domicilio)")
    parser.add_argument("--sucursal-destino", help='Codigo (ej. B0721) o nombre (ej. "MUNRO") de la sucursal de destino (entrega en sucursal)')
    parser.add_argument("--peso", type=float, help="Peso en kg")
    parser.add_argument("--largo", type=float, required=True, help="Largo en cm")
    parser.add_argument("--ancho", type=float, required=True, help="Ancho en cm")
    parser.add_argument("--alto", type=float, required=True, help="Alto en cm")
    parser.add_argument("--valor", type=float, help="Valor declarado en $")
    parser.add_argument(
        "--sucursal-origen",
        help="Codigo de sucursal donde entregas el paquete (ej. B0721 = MUNRO). "
             "Por defecto se usa la sucursal cabecera de la cuenta, igual que el sitio.",
    )
    parser.add_argument("--headed", action="store_true", help="Mostrar el navegador (debug)")
    parser.add_argument(
        "--abrir", action="store_true",
        help="En vez de cotizar, abrir MiCorreo en un navegador visible con el formulario completo para continuar el envio y pagar.",
    )
    parser.add_argument("--dest-nombre", help="Con --abrir: nombre y apellido del destinatario")
    parser.add_argument("--dest-email", help="Con --abrir: email del destinatario")
    parser.add_argument("--dest-cod-area", help="Con --abrir: codigo de area del celular, sin 0 (ej. 11)")
    parser.add_argument("--dest-celular", help="Con --abrir: celular sin 15 (ej. 31308444)")
    parser.add_argument("--nro-orden", help="Con --abrir: N de orden opcional del envio (el sitio solo acepta digitos)")
    parser.add_argument("--guardar-medidas", metavar="ALIAS", help="Guardar largo/ancho/alto como medida frecuente en MiCorreo con ese alias y salir.")
    parser.add_argument("--predeterminada", action="store_true", help="Con --guardar-medidas: marcarla como medida predeterminada.")
    args = parser.parse_args()

    if args.guardar_medidas:
        try:
            r = guardar_medidas_micorreo(args.largo, args.ancho, args.alto, args.guardar_medidas, args.predeterminada)
        except (RuntimeError, ValueError) as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return

    faltan = [n for n, v in (("--provincia", args.provincia), ("--peso", args.peso), ("--valor", args.valor)) if v is None]
    if faltan:
        parser.error("faltan argumentos: " + ", ".join(faltan))

    if args.abrir:
        destinatario = {k: v for k, v in (
            ("nombre", args.dest_nombre), ("email", args.dest_email), ("cod_area", args.dest_cod_area),
            ("celular", args.dest_celular), ("nro_orden", args.nro_orden),
        ) if v}
        try:
            abrir_en_micorreo(
                provincia=args.provincia, cp=args.cp, peso_kg=args.peso, largo_cm=args.largo,
                ancho_cm=args.ancho, alto_cm=args.alto, valor=args.valor, tipo_entrega=args.entrega,
                sucursal_destino=args.sucursal_destino, sucursal_origen=args.sucursal_origen,
                destinatario=destinatario or None,
            )
        except (RuntimeError, ValueError) as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
        return

    try:
        resultado = cotizar(
            provincia=args.provincia,
            cp=args.cp,
            peso_kg=args.peso,
            largo_cm=args.largo,
            ancho_cm=args.ancho,
            alto_cm=args.alto,
            valor=args.valor,
            tipo_entrega=args.entrega,
            sucursal_destino=args.sucursal_destino,
            sucursal_origen=args.sucursal_origen,
            headless=not args.headed,
        )
    except (RuntimeError, ValueError) as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(resultado, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
