import os
from flask import Flask, request, jsonify, render_template, send_from_directory
from werkzeug.utils import secure_filename
from parser import (
    parse_debentures,
    parse_cricra_csv,
    scan_directory,
)
from cvm import (
    ensure_cadastro_csv,
    ensure_dfp_zip,
    get_company_snapshot,
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
            date_str, rows = parse_cricra_csv(save_path)
            if date_str and rows:
                store["cri"][date_str] = rows
                loaded.append({"file": fname, "date": date_str, "count": len(rows)})
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


@app.route("/api/cvm/refresh", methods=["POST"])
def cvm_refresh():
    payload = request.get_json(silent=True) or {}
    year = int(payload.get("year", 2025))
    force = bool(payload.get("force", False))
    ensure_cadastro_csv(force=force)
    ensure_dfp_zip(year, force=force)
    return jsonify({
        "cadastro": "ok",
        "dfp_year": year,
        "force": force,
    })


def load_existing_files():
    print("Carregando arquivos existentes...")
    store["deb"] = scan_directory(DEB_DIR, parse_debentures, DEB_EXTS)
    store["cri"] = scan_directory(CRI_DIR, parse_cricra_csv, CRI_EXTS)
    print(f"  Debêntures: {len(store['deb'])} datas, "
          f"CRI/CRA: {len(store['cri'])} datas")


if __name__ == "__main__":
    load_existing_files()
    app.run(debug=False, port=5001)
