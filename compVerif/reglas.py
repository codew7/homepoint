r"""
Controles automaticos sobre los datos leidos de un comprobante (sin que el
usuario cargue nada):

    - lo que Claude vio en la imagen (nivel de sospecha y zonas alteradas)
    - digitos verificadores de CBU/CVU (algoritmo del BCRA) y de CUIT/CUIL:
      un numero inventado o retocado suele romperlos
    - fecha futura o vieja
    - historial: numero de operacion repetido, formato por banco y, en
      Mercado Pago, que el numero de operacion crezca con la fecha

Cada control devuelve avisos {gravedad, titulo, detalle, origen}; gravedad es
"rojo", "amarillo", "info" u "ok" (control que salio bien).

Uso suelto (prueba de los digitos verificadores):
    venv\Scripts\python.exe reglas.py cbu 0000003100010000000001
    venv\Scripts\python.exe reglas.py cuit 20-12345678-6
"""

import re
import sys
import unicodedata
from datetime import datetime, timedelta

ORDEN = {"ok": 0, "info": 1, "amarillo": 2, "rojo": 3}

# Dias de antiguedad a partir de los cuales un comprobante "viejo" merece revision
DIAS_VIEJO = 3


def aviso(gravedad, titulo, detalle="", origen="datos"):
    return {"gravedad": gravedad, "titulo": titulo, "detalle": detalle, "origen": origen}


def semaforo(avisos):
    peor = max((ORDEN.get(a["gravedad"], 0) for a in avisos), default=0)
    return "rojo" if peor == 3 else "amarillo" if peor == 2 else "verde"


# ------------------------------------------------------------- normalizacion --

def solo_digitos(texto):
    return re.sub(r"\D", "", str(texto or ""))


def normalizar(texto):
    """Minusculas, sin tildes ni signos, espacios simples (para comparar nombres de banco)."""
    t = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", t.lower()).split())


def a_numero(valor):
    """Monto como float; acepta 25000, "25.000,50" o "$ 25,000.50"."""
    if valor is None or valor == "":
        return None
    if isinstance(valor, (int, float)):
        return float(valor)
    t = re.sub(r"[^\d,.\-]", "", str(valor))
    if not t:
        return None
    if "," in t and "." in t:
        t = t.replace(".", "").replace(",", ".") if t.rfind(",") > t.rfind(".") else t.replace(",", "")
    elif "," in t:
        partes = t.split(",")
        t = t.replace(",", ".") if len(partes[-1]) in (1, 2) else t.replace(",", "")
    elif t.count(".") > 1 or (t.count(".") == 1 and len(t.split(".")[-1]) == 3):
        t = t.replace(".", "")
    try:
        return float(t)
    except ValueError:
        return None


def a_fecha(datos):
    """datetime del comprobante con fecha (YYYY-MM-DD) y hora opcional; None si no se puede."""
    f = str(datos.get("fecha") or "").strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", f)
    if m:
        a, me, d = (int(x) for x in m.groups())
    else:
        m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})", f)
        if not m:
            return None
        d, me, a = (int(x) for x in m.groups())
        a = a + 2000 if a < 100 else a
    h = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?", str(datos.get("hora") or "").strip())
    try:
        if h:
            return datetime(a, me, d, int(h.group(1)), int(h.group(2)), int(h.group(3) or 0))
        return datetime(a, me, d)
    except ValueError:
        return None


def pesos(valor):
    return "$ " + f"{valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".").removesuffix(",00")


# --------------------------------------------------- digitos verificadores --

def _dv_bloque(digitos, pesos_bloque):
    suma = sum(int(d) * p for d, p in zip(digitos, pesos_bloque))
    return (10 - suma % 10) % 10


def cbu_valido(cbu):
    """True/False si es un CBU/CVU de 22 digitos completo; None si no se puede controlar."""
    d = solo_digitos(cbu)
    if len(d) != 22 or re.search(r"[*xX•]", str(cbu or "")):
        return None
    b1 = _dv_bloque(d[:7], (7, 1, 3, 9, 7, 1, 3)) == int(d[7])
    b2 = _dv_bloque(d[8:21], (3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3)) == int(d[21])
    return b1 and b2


def cuit_valido(cuit):
    """True/False si tiene 11 digitos; None si no se puede controlar."""
    d = solo_digitos(cuit)
    if len(d) != 11 or re.search(r"[*xX•]", str(cuit or "")):
        return None
    suma = sum(int(x) * p for x, p in zip(d[:10], (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)))
    dv = 11 - suma % 11
    dv = 0 if dv == 11 else dv
    return dv != 10 and dv == int(d[10])


# ------------------------------------------------------------------ controles --

def control_lectura(datos):
    """Lo que Claude vio en la imagen: es el control principal."""
    avisos = []
    if datos.get("es_comprobante") is False:
        avisos.append(aviso("rojo", "El archivo no parece un comprobante de transferencia", origen="visual"))
    nivel = str(datos.get("nivel_sospecha") or "").lower()
    conclusion = str(datos.get("conclusion") or "").strip()
    zonas = [z for z in (datos.get("zonas_sospechosas") or []) if isinstance(z, dict)]
    detalle = conclusion + (f" Se marcaron {len(zonas)} zona(s) en la imagen." if zonas else "")
    if nivel == "alta":
        avisos.append(aviso("rojo", "Signos claros de alteración visual", detalle, "visual"))
    elif nivel == "media":
        avisos.append(aviso("amarillo", "Detalles visuales para revisar", detalle, "visual"))
    elif nivel == "baja":
        avisos.append(aviso("ok", "Sin signos visuales de alteración",
                            (conclusion + " " if conclusion else "") + "No es garantía: una edición prolija puede no notarse.", "visual"))
    return avisos


def control_numeros(datos):
    """Digitos verificadores: si alguien cambio un numero a mano, casi nunca cierran."""
    avisos = []
    for clave, nombre, fn in (("cbu_destino", "CBU/CVU de destino", cbu_valido), ("cuenta_origen", "CBU/CVU de origen", cbu_valido),
                              ("cuit_origen", "CUIT/CUIL de origen", cuit_valido), ("cuit_destino", "CUIT/CUIL de destino", cuit_valido)):
        v = fn(datos.get(clave))
        if v is False:
            avisos.append(aviso("rojo", f"{nombre} inválido",
                                f"{datos.get(clave)}: los dígitos verificadores no cierran. Un número inventado o retocado suele romperlos."))
        elif v:
            avisos.append(aviso("ok", f"{nombre} con dígitos verificadores correctos"))
    return avisos


def control_fecha(datos, cuando, ahora=None):
    ahora = ahora or datetime.now()
    if not cuando:
        return [aviso("info", "No se pudo leer la fecha del comprobante", str(datos.get("fecha") or ""))] if datos.get("fecha") else []
    tiene_hora = bool(datos.get("hora"))
    futura = cuando > ahora + timedelta(minutes=10) if tiene_hora else cuando.date() > ahora.date()
    if futura:
        return [aviso("rojo", "La fecha del comprobante es futura", cuando.strftime("%d/%m/%Y %H:%M"))]
    dias = (ahora.date() - cuando.date()).days
    if dias > DIAS_VIEJO:
        return [aviso("amarillo", f"Comprobante de hace {dias} días", "Revisá que no sea un pago viejo reutilizado.")]
    return []


def forma(operacion):
    """Patron de un numero de operacion: 'N' por digito, 'A' por letra (p. ej. 'NNNNNNNNNNN')."""
    return "".join("N" if c.isdigit() else "A" if c.isalpha() else c for c in str(operacion).strip().upper())


def control_historial(datos, cuando, previos):
    """previos: analisis anteriores (dicts con id, creado, operacion, coelsa, banco, fecha_op, veredicto)."""
    avisos = []
    op = str(datos.get("numero_operacion") or "").strip()
    for codigo in [c for c in (op, str(datos.get("id_coelsa") or "").strip()) if len(c) >= 5]:
        repetidos = [p for p in previos if codigo in (p.get("operacion"), p.get("coelsa"))]
        if repetidos:
            p = repetidos[0]
            otros = f" y en {len(repetidos) - 1} más" if len(repetidos) > 1 else ""
            avisos.append(aviso("rojo", "Número de operación ya usado en otro comprobante",
                                f"{codigo} ya aparece en el análisis #{p['id']} del {p['creado'][:10]}"
                                + (f", marcado {p['veredicto']}" if p.get("veredicto") else "") + otros + ".", "historial"))
    banco = normalizar(datos.get("banco_origen"))
    if not op or not banco:
        return avisos

    aprobados = [p for p in previos if p.get("veredicto") == "aprobado" and normalizar(p.get("banco")) == banco and p.get("operacion")]
    formas = {forma(p["operacion"]) for p in aprobados}
    if len(aprobados) >= 3 and forma(op) not in formas:
        avisos.append(aviso("amarillo", "Número de operación con formato distinto al habitual",
                            f"«{op}» no se parece a los {len(aprobados)} comprobantes aprobados de {datos.get('banco_origen')}.", "historial"))

    # Mercado Pago numera las operaciones en forma creciente: un numero "del pasado"
    # con fecha de hoy (o al reves) delata un comprobante armado con datos viejos
    if "mercado" in banco and op.isdigit() and cuando:
        n = int(op)
        contras = []
        for p in aprobados:
            fp = datetime.fromisoformat(p["fecha_op"]) if p.get("fecha_op") else None
            if not fp or not str(p["operacion"]).isdigit() or abs(fp - cuando) < timedelta(days=1):
                continue
            np_ = int(p["operacion"])
            if (fp < cuando and np_ > n) or (fp > cuando and np_ < n):
                contras.append(p)
        if contras:
            p = contras[0]
            avisos.append(aviso("amarillo", "El número de operación no concuerda con la fecha",
                                f"En Mercado Pago los números crecen con el tiempo. El #{p['id']} ({p['operacion']}, "
                                f"{p['fecha_op'][:10]}) contradice este ({op}, {cuando:%Y-%m-%d}).", "historial"))
    return avisos


def evaluar(datos, previos, ahora=None):
    cuando = a_fecha(datos)
    return control_lectura(datos) + control_numeros(datos) + control_fecha(datos, cuando, ahora) + control_historial(datos, cuando, previos)


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("cbu", "cuit"):
        print(__doc__)
        sys.exit(1)
    fn = cbu_valido if sys.argv[1] == "cbu" else cuit_valido
    print({True: "valido", False: "INVALIDO", None: "no se puede controlar"}[fn(sys.argv[2])])
