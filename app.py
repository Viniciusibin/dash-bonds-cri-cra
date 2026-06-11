import os
import urllib.request
import urllib.parse
import urllib.error
from datetime import date as dt_date, timedelta
from flask import Flask, request, jsonify, render_template, send_from_directory
from werkzeug.utils import secure_filename
from parser import (
    parse_debentures,
    parse_cricra_csv,
    scan_directory,
    scan_cricra_directory,
)
from cvm import (
    ensure_cadastro_csv,
    ensure_dfp_extracted,
    ensure_dfp_zip,
    get_company_financial_history,
    get_company_snapshot,
    resolve_company_by_name,
    search_companies,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEB_DIR = os.path.join(BASE_DIR, "debentures")
CRI_DIR = os.path.join(BASE_DIR, "cri-cra")

DEB_EXTS = {".xls", ".xlsx"}
CRI_EXTS = {".csv"}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB

# In-memory store: {date_str: [rows]}
store = {
    "deb": {},
    "cri": {},
}


def _latest_date(data: dict):
    if not data:
        return None
    return sorted(data.keys())[-1]


def _build_history(data: dict, codigo: str):
    """Return [{date, taxaIndicativa, puPar, taxaCompra, taxaVenda, pu, duration}]."""
    points = []
    for date_str in sorted(data.keys()):
        row = next((r for r in data[date_str] if r.get("codigo") == codigo), None)
        if row:
            points.append({
                "date":           date_str,
                "taxaIndicativa": row.get("taxaIndicativa"),
                "puPar":          row.get("puPar"),
                "taxaCompra":     row.get("taxaCompra"),
                "taxaVenda":      row.get("taxaVenda"),
                "pu":             row.get("pu"),
                "duration":       row.get("duration"),
            })
    return points


# ─── routes ────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ── Debentures ──────────────────────────────────────────────────────────────

@app.route("/api/debentures/dates")
def deb_dates():
    return jsonify(sorted(store["deb"].keys()))


@app.route("/api/debentures")
def deb_data():
    requested = request.args.get("date")
    dates = sorted(store["deb"].keys())
    if not dates:
        return jsonify({"dates": [], "date": None, "rows": []})
    date = requested if requested in store["deb"] else dates[-1]
    return jsonify({
        "dates": dates,
        "date":  date,
        "rows":  store["deb"][date],
    })


@app.route("/api/debentures/history/<codigo>")
def deb_history(codigo):
    return jsonify(_build_history(store["deb"], codigo))


@app.route("/api/debentures/upload", methods=["POST"])
def deb_upload():
    files = request.files.getlist("file")
    if not files:
        return jsonify({"error": "Nenhum arquivo enviado"}), 400
    loaded = []
    for f in files:
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in DEB_EXTS:
            continue
        fname = secure_filename(f.filename)
        save_path = os.path.join(DEB_DIR, fname)
        os.makedirs(DEB_DIR, exist_ok=True)
        f.save(save_path)
        try:
            date_str, rows = parse_debentures(save_path)
            if date_str and rows:
                store["deb"][date_str] = rows
                loaded.append({"file": fname, "date": date_str, "count": len(rows)})
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    if not loaded:
        return jsonify({"error": "Nenhum arquivo válido enviado"}), 400
    return jsonify({"loaded": loaded})


# ── CRI / CRA ───────────────────────────────────────────────────────────────

@app.route("/api/cricra/dates")
def cri_dates():
    return jsonify(sorted(store["cri"].keys()))


@app.route("/api/cricra")
def cri_data():
    requested = request.args.get("date")
    dates = sorted(store["cri"].keys())
    if not dates:
        return jsonify({"dates": [], "date": None, "rows": []})
    date = requested if requested in store["cri"] else dates[-1]
    return jsonify({
        "dates": dates,
        "date":  date,
        "rows":  store["cri"][date],
    })


@app.route("/api/cricra/history/<codigo>")
def cri_history(codigo):
    return jsonify(_build_history(store["cri"], codigo))


@app.route("/api/cricra/upload", methods=["POST"])
def cri_upload():
    files = request.files.getlist("file")
    if not files:
        return jsonify({"error": "Nenhum arquivo enviado"}), 400
    loaded = []
    for f in files:
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in CRI_EXTS:
            continue
        fname = secure_filename(f.filename)
        save_path = os.path.join(CRI_DIR, fname)
        os.makedirs(CRI_DIR, exist_ok=True)
        f.save(save_path)
        try:
            _, rows = parse_cricra_csv(save_path)
            if not rows:
                continue
            from parser import _parse_date_str, _extract_date_from_filename
            dates_added = set()
            for row in rows:
                raw = row.get("dataRef", "")
                date_str = _parse_date_str(raw) if raw else _extract_date_from_filename(save_path)
                if date_str:
                    store["cri"].setdefault(date_str, []).append(row)
                    dates_added.add(date_str)
            for d in dates_added:
                loaded.append({"file": fname, "date": d, "count": len(store["cri"][d])})
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    if not loaded:
        return jsonify({"error": "Nenhum arquivo válido enviado"}), 400
    return jsonify({"loaded": loaded})


# ─── bootstrap ─────────────────────────────────────────────────────────────

@app.route("/api/cvm/companies")
def cvm_companies():
    query = request.args.get("q", "").strip()
    active_only = request.args.get("active_only", "").lower() in {"1", "true", "yes"}
    limit = request.args.get("limit", default=25, type=int)
    limit = min(max(limit, 1), 100)
    return jsonify(search_companies(query=query, limit=limit, active_only=active_only))


@app.route("/api/cvm/company/<identifier>")
def cvm_company(identifier):
    year = request.args.get("year", default=2025, type=int)
    snapshot = get_company_snapshot(identifier, year)
    if snapshot is None:
        return jsonify({"error": "Companhia não encontrada"}), 404
    return jsonify(snapshot)


@app.route("/api/cvm/resolve")
def cvm_resolve():
    name = request.args.get("name", "").strip()
    year = request.args.get("year", default=2025, type=int)
    if not name:
        return jsonify({"error": "Nome do emissor não informado"}), 400
    company = resolve_company_by_name(name)
    if company is None:
        return jsonify({"error": "Companhia não encontrada"}), 404
    snapshot = get_company_snapshot(company["cnpj"], year)
    if snapshot is None:
        return jsonify({"company": company, "financials": {}})
    return jsonify(snapshot)


@app.route("/api/cvm/history/<identifier>")
def cvm_history(identifier):
    year_end = request.args.get("year_end", default=2025, type=int)
    years = request.args.get("years", default=5, type=int)
    history = get_company_financial_history(identifier, year_end=year_end, years=years)
    if history is None:
        return jsonify({"error": "Companhia não encontrada"}), 404
    return jsonify(history)


@app.route("/api/cvm/refresh", methods=["POST"])
def cvm_refresh():
    payload = request.get_json(silent=True) or {}
    year = int(payload.get("year", 2025))
    force = bool(payload.get("force", False))
    ensure_cadastro_csv(force=force)
    ensure_dfp_zip(year, force=force)
    extract_dir = ensure_dfp_extracted(year, force=force)
    return jsonify({
        "cadastro": "ok",
        "dfp_year": year,
        "dfp_extract_dir": extract_dir,
        "force": force,
    })


_PT_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
_ANBIMA_DEB_BASE = "https://www.anbima.com.br/informacoes/merc-sec-debentures/arqs/"
_ANBIMA_CRICRA_BASE = "https://www.anbima.com.br/pt_br/anbima/TaxasCriCraExport/exportarCSV"


def _anbima_deb_url(d: dt_date) -> tuple[str, str]:
    fname = f"d{d.strftime('%y')}{_PT_MONTHS[d.month - 1]}{d.strftime('%d')}.xls"
    return fname, _ANBIMA_DEB_BASE + fname


@app.route("/api/debentures/fetch", methods=["POST"])
def deb_fetch():
    os.makedirs(DEB_DIR, exist_ok=True)
    today = dt_date.today()
    payload = request.get_json(silent=True) or {}

    raw_start = payload.get("start_date")
    if raw_start:
        try:
            from datetime import datetime as _dt
            start = _dt.strptime(raw_start, "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"error": "start_date inválido (use YYYY-MM-DD)"}), 400
    elif store["deb"]:
        latest_str = sorted(store["deb"].keys())[-1]
        from datetime import datetime as _dt
        start = _dt.strptime(latest_str, "%Y-%m-%d").date() + timedelta(days=1)
    elif store["cri"]:
        from datetime import datetime as _dt
        oldest_cri = sorted(store["cri"].keys())[0]
        start = _dt.strptime(oldest_cri, "%Y-%m-%d").date()
    else:
        start = today - timedelta(days=90)

    if start > today:
        return jsonify({"loaded": [], "skipped": 0, "message": "Dados já atualizados"})

    loaded = []
    skipped = 0
    candidate = start
    while candidate <= today:
        fname, url = _anbima_deb_url(candidate)
        save_path = os.path.join(DEB_DIR, fname)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                content = resp.read()
            with open(save_path, "wb") as f:
                f.write(content)
            date_str, rows = parse_debentures(save_path)
            if date_str and rows:
                store["deb"][date_str] = rows
                loaded.append({"date": date_str, "count": len(rows), "file": fname})
            else:
                skipped += 1
        except urllib.error.HTTPError as e:
            if e.code == 404:
                skipped += 1  # weekend or holiday — normal
            else:
                return jsonify({"error": str(e), "loaded": loaded}), 502
        except Exception as e:
            return jsonify({"error": str(e), "loaded": loaded}), 502
        candidate += timedelta(days=1)

    latest = loaded[-1]["date"] if loaded else None
    store_latest = sorted(store["deb"].keys())[-1] if store["deb"] else None
    return jsonify({"loaded": loaded, "skipped": skipped, "latest": latest, "store_latest": store_latest})


@app.route("/api/cricra/fetch", methods=["POST"])
def cri_fetch():
    os.makedirs(CRI_DIR, exist_ok=True)
    today = dt_date.today()
    payload = request.get_json(silent=True) or {}

    raw_start = payload.get("start_date")
    if raw_start:
        try:
            from datetime import datetime as _dt
            start = _dt.strptime(raw_start, "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"error": "start_date inválido (use YYYY-MM-DD)"}), 400
    elif store["cri"]:
        latest_str = sorted(store["cri"].keys())[-1]
        from datetime import datetime as _dt
        start = _dt.strptime(latest_str, "%Y-%m-%d").date() + timedelta(days=1)
    elif store["deb"]:
        from datetime import datetime as _dt
        oldest_deb = sorted(store["deb"].keys())[0]
        start = _dt.strptime(oldest_deb, "%Y-%m-%d").date()
    else:
        start = today - timedelta(days=90)

    if start > today:
        return jsonify({"loaded": [], "skipped": 0, "message": "Dados já atualizados"})

    loaded = []
    skipped = 0
    candidate = start
    while candidate <= today:
        date_param = candidate.strftime("%d/%m/%Y")
        fname = f"cri_cra-{candidate.strftime('%Y-%m-%d')}.csv"
        save_path = os.path.join(CRI_DIR, fname)
        url = f"{_ANBIMA_CRICRA_BASE}?filtroTermo=&filtroData={urllib.parse.quote(date_param)}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                content = resp.read()
            # Empty or tiny response means no data for that day
            if len(content) < 200:
                skipped += 1
                candidate += timedelta(days=1)
                continue
            with open(save_path, "wb") as f:
                f.write(content)
            from parser import _parse_date_str as _pds
            _, rows = parse_cricra_csv(save_path)
            if rows:
                for row in rows:
                    raw = row.get("dataRef", "")
                    ds = _pds(raw) if raw else str(candidate)
                    if ds:
                        store["cri"].setdefault(ds, []).append(row)
                loaded.append({"date": str(candidate), "count": len(rows), "file": fname})
            else:
                skipped += 1
        except urllib.error.HTTPError as e:
            if e.code == 404:
                skipped += 1
            else:
                return jsonify({"error": str(e), "loaded": loaded}), 502
        except Exception as e:
            return jsonify({"error": str(e), "loaded": loaded}), 502
        candidate += timedelta(days=1)

    latest = loaded[-1]["date"] if loaded else None
    store_latest = sorted(store["cri"].keys())[-1] if store["cri"] else None
    return jsonify({"loaded": loaded, "skipped": skipped, "latest": latest, "store_latest": store_latest})


def load_existing_files():
    print("Carregando arquivos existentes...")
    store["deb"] = scan_directory(DEB_DIR, parse_debentures, DEB_EXTS)
    store["cri"] = scan_cricra_directory(CRI_DIR)
    print(f"  Debêntures: {len(store['deb'])} datas, "
          f"CRI/CRA: {len(store['cri'])} datas")


if __name__ == "__main__":
    load_existing_files()
    app.run(debug=False, port=5001)
