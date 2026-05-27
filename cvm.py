import csv
import datetime as dt
import os
import unicodedata
import urllib.request
import zipfile
from functools import lru_cache


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CVM_DIR = os.path.join(BASE_DIR, "cvm")
CADASTRO_URL = "https://dados.cvm.gov.br/dados/CIA_ABERTA/CAD/DADOS/cad_cia_aberta.csv"
DFP_URL_TEMPLATE = (
    "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_{year}.zip"
)


def ensure_data_dir():
    os.makedirs(CVM_DIR, exist_ok=True)


def normalize_cnpj(value):
    if value is None:
        return None
    digits = "".join(ch for ch in str(value) if ch.isdigit())
    return digits or None


def _normalize_text(value):
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return text.casefold()


def _clean_company_name(value):
    text = _normalize_text(value)
    replacements = {
        "(*)": " ",
        "(**)": " ",
        "*": " ",
        "/": " ",
        "-": " ",
        ".": " ",
        ",": " ",
        " s a ": " sa ",
    }
    text = f" {text} "
    for old, new in replacements.items():
        text = text.replace(old, new)
    return " ".join(text.split())


def _tokenize_company_name(value):
    stopwords = {
        "sa", "sa.", "s", "a", "de", "do", "da", "dos", "das", "e",
        "cia", "companhia", "participacoes", "participacao", "investimentos",
        "holding", "grupo", "spe",
    }
    tokens = [token for token in _clean_company_name(value).split() if token not in stopwords]
    return tokens


def _to_float(value):
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", "."))
    except ValueError:
        return None


def _download(url, destination):
    ensure_data_dir()
    with urllib.request.urlopen(url, timeout=120) as response:
        content = response.read()
    with open(destination, "wb") as fh:
        fh.write(content)
    return destination


def ensure_cadastro_csv(force=False):
    ensure_data_dir()
    path = os.path.join(CVM_DIR, "cad_cia_aberta.csv")
    if force or not os.path.exists(path):
        _download(CADASTRO_URL, path)
        load_cadastro.cache_clear()
    return path


def ensure_dfp_zip(year, force=False):
    ensure_data_dir()
    path = os.path.join(CVM_DIR, f"dfp_cia_aberta_{year}.zip")
    if force or not os.path.exists(path):
        _download(DFP_URL_TEMPLATE.format(year=year), path)
        load_financial_metrics.cache_clear()
    return path


def ensure_dfp_extracted(year, force=False):
    zip_path = ensure_dfp_zip(year, force=force)
    extract_dir = os.path.join(CVM_DIR, f"dfp_{year}")
    if force and os.path.isdir(extract_dir):
        for root, dirs, files in os.walk(extract_dir, topdown=False):
            for file_name in files:
                os.remove(os.path.join(root, file_name))
            for dir_name in dirs:
                os.rmdir(os.path.join(root, dir_name))
        os.rmdir(extract_dir)
    if force or not os.path.isdir(extract_dir):
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(extract_dir)
        load_financial_metrics.cache_clear()
    return extract_dir


@lru_cache(maxsize=1)
def load_cadastro():
    path = ensure_cadastro_csv(force=False)
    rows = []
    with open(path, "r", encoding="latin-1", newline="") as fh:
        reader = csv.DictReader(fh, delimiter=";")
        for row in reader:
            row["CNPJ_NUM"] = normalize_cnpj(row.get("CNPJ_CIA"))
            rows.append(row)
    return rows


def search_companies(query="", limit=25, active_only=False):
    query_norm = _normalize_text(query)
    results = []
    for row in load_cadastro():
        if active_only and row.get("SIT") != "ATIVO":
            continue
        haystacks = [
            row.get("DENOM_SOCIAL", ""),
            row.get("DENOM_COMERC", ""),
            row.get("SETOR_ATIV", ""),
            row.get("CNPJ_CIA", ""),
            row.get("CD_CVM", ""),
        ]
        if query_norm and not any(query_norm in _normalize_text(item) for item in haystacks):
            continue
        results.append({
            "cd_cvm": row.get("CD_CVM"),
            "cnpj": row.get("CNPJ_CIA"),
            "denom_social": row.get("DENOM_SOCIAL"),
            "denom_comercial": row.get("DENOM_COMERC"),
            "setor_atividade": row.get("SETOR_ATIV"),
            "situacao": row.get("SIT"),
            "situacao_emissor": row.get("SIT_EMISSOR"),
            "categoria_registro": row.get("CATEG_REG"),
            "controle_acionario": row.get("CONTROLE_ACIONARIO"),
        })
        if len(results) >= limit:
            break
    return results


def resolve_company_by_name(name, active_only=True):
    cleaned = _clean_company_name(name)
    query_tokens = _tokenize_company_name(cleaned)
    search_terms = [
        cleaned,
        " ".join(query_tokens[:3]).strip(),
        query_tokens[0] if query_tokens else "",
    ]

    candidates = []
    seen = set()
    for term in search_terms:
        if not term:
            continue
        for candidate in search_companies(query=term, limit=20, active_only=active_only):
            key = (candidate.get("cnpj"), candidate.get("cd_cvm"))
            if key in seen:
                continue
            seen.add(key)
            candidates.append(candidate)

    if not candidates and active_only:
        candidates = search_companies(query=name, limit=10, active_only=False)
    if not candidates:
        return None

    def score(candidate):
        haystacks = [
            _clean_company_name(candidate.get("denom_social")),
            _clean_company_name(candidate.get("denom_comercial")),
        ]
        token_hits = 0
        for token in query_tokens:
            if any(token in hay for hay in haystacks):
                token_hits += 1

        exact_bonus = 0
        if any(cleaned == hay for hay in haystacks):
            exact_bonus += 100
        if any(cleaned in hay for hay in haystacks):
            exact_bonus += 30

        active_bonus = 15 if candidate.get("situacao") == "ATIVO" else 0
        return exact_bonus + token_hits * 10 + active_bonus

    ranked = sorted(candidates, key=score, reverse=True)
    return ranked[0] if score(ranked[0]) > 0 else None


def _rows_from_csv(csv_path):
    with open(csv_path, "r", encoding="latin-1", newline="") as fh:
        yield from csv.DictReader(fh, delimiter=";")


def _pick_best_statement_group(entries):
    consolidated = [item for item in entries if "consolidado" in _normalize_text(item["GRUPO_DFP"])]
    return consolidated or entries


def _pick_latest_period(entries):
    latest = [item for item in entries if _normalize_text(item.get("ORDEM_EXERC")) == "ultimo"]
    return latest or entries


def _scale_multiplier(scale_name):
    scale = _normalize_text(scale_name)
    if scale == "mil":
        return 1_000.0
    if scale in {"milhao", "milhoes"}:
        return 1_000_000.0
    if scale in {"unidade", "unidades", ""}:
        return 1.0
    return 1.0


def _group_rows(rows):
    grouped = {}
    for row in rows:
        key = normalize_cnpj(row.get("CNPJ_CIA"))
        if not key:
            continue
        grouped.setdefault(key, []).append(row)
    return grouped


def _find_account_value(rows, code_prefixes=None, description_terms=None, fixed_only=True, take_abs=True):
    code_prefixes = code_prefixes or []
    description_terms = description_terms or []
    terms = [_normalize_text(term) for term in description_terms]
    for row in rows:
        if fixed_only and row.get("ST_CONTA_FIXA") != "S":
            continue
        code = row.get("CD_CONTA", "")
        desc = _normalize_text(row.get("DS_CONTA"))
        code_match = bool(code_prefixes) and any(
            code == prefix or code.startswith(prefix + ".")
            for prefix in code_prefixes
        )
        desc_match = bool(terms) and all(term in desc for term in terms)
        if code_prefixes and description_terms:
            if not (code_match and desc_match):
                continue
        elif code_prefixes:
            if not code_match:
                continue
        elif description_terms:
            if not desc_match:
                continue
        else:
            continue
        value = _to_float(row.get("VL_CONTA"))
        if value is None:
            continue
        scaled = float(value) * _scale_multiplier(row.get("ESCALA_MOEDA"))
        return abs(scaled) if take_abs else scaled
    return None


def _build_metric_record(cadastro_row, dre_rows, bpa_rows, bpp_rows, dva_rows, year):
    dre_scope = _pick_latest_period(_pick_best_statement_group(dre_rows))
    bpa_scope = _pick_latest_period(_pick_best_statement_group(bpa_rows))
    bpp_scope = _pick_latest_period(_pick_best_statement_group(bpp_rows))
    dva_scope = _pick_latest_period(_pick_best_statement_group(dva_rows))

    cash = _find_account_value(
        bpa_scope,
        code_prefixes=["1.01.01"],
        description_terms=["caixa", "equivalentes"],
    )
    current_debt = _find_account_value(
        bpp_scope,
        code_prefixes=["2.01.04"],
        description_terms=["emprestimos", "financiamentos"],
    )
    non_current_debt = _find_account_value(
        bpp_scope,
        code_prefixes=["2.02.01"],
        description_terms=["emprestimos", "financiamentos"],
    )
    ebit = _find_account_value(
        dre_scope,
        code_prefixes=["3.05"],
        description_terms=["resultado", "financeiro", "tributos"],
        take_abs=False,
    )
    # D&A structure in DVA varies by company (7.04.01 or 7.05.01); match by description only
    da = _find_account_value(
        dva_scope,
        description_terms=["depreciacao", "amortizacao"],
    )
    revenue = _find_account_value(
        dre_scope,
        code_prefixes=["3.01"],
        take_abs=False,
    )
    net_income = _find_account_value(
        dre_scope,
        code_prefixes=["3.11.01"],
        description_terms=["atribuido", "controladora"],
        take_abs=False,
    )
    financial_result = _find_account_value(
        dre_scope,
        code_prefixes=["3.06"],
        description_terms=["resultado", "financeiro"],
        take_abs=False,
    )
    financial_expense = _find_account_value(
        dre_scope,
        code_prefixes=["3.06.02"],
        description_terms=["despesas", "financeiras"],
    )
    equity = _find_account_value(
        bpp_scope,
        code_prefixes=["2.03"],
        description_terms=["patrimonio", "liquido"],
        fixed_only=False,
        take_abs=False,
    )

    gross_debt = None
    if current_debt is not None or non_current_debt is not None:
        gross_debt = (current_debt or 0.0) + (non_current_debt or 0.0)

    net_debt = None
    if gross_debt is not None and cash is not None:
        net_debt = gross_debt - cash

    ebitda = None
    if ebit is not None and da is not None:
        ebitda = ebit + da

    nd_ebitda = None
    if net_debt is not None and ebitda not in (None, 0):
        nd_ebitda = net_debt / ebitda

    current_debt_ratio = None
    if gross_debt not in (None, 0) and current_debt is not None:
        current_debt_ratio = current_debt / gross_debt

    cash_short_term_debt_coverage = None
    if current_debt not in (None, 0) and cash is not None:
        cash_short_term_debt_coverage = cash / current_debt

    debt_to_equity = None
    if gross_debt is not None and equity not in (None, 0):
        debt_to_equity = gross_debt / equity

    ebit_interest_coverage = None
    if ebit is not None and financial_expense not in (None, 0):
        ebit_interest_coverage = ebit / financial_expense

    ebitda_interest_coverage = None
    if ebitda is not None and financial_expense not in (None, 0):
        ebitda_interest_coverage = ebitda / financial_expense

    ebit_margin = None
    if ebit is not None and revenue not in (None, 0):
        ebit_margin = ebit / revenue

    ebitda_margin = None
    if ebitda is not None and revenue not in (None, 0):
        ebitda_margin = ebitda / revenue

    return {
        "year": year,
        "cd_cvm": cadastro_row.get("CD_CVM") if cadastro_row else None,
        "cnpj": cadastro_row.get("CNPJ_CIA") if cadastro_row else None,
        "denom_social": cadastro_row.get("DENOM_SOCIAL") if cadastro_row else None,
        "setor_atividade": cadastro_row.get("SETOR_ATIV") if cadastro_row else None,
        "situacao": cadastro_row.get("SIT") if cadastro_row else None,
        "cash": cash,
        "current_debt": current_debt,
        "non_current_debt": non_current_debt,
        "gross_debt": gross_debt,
        "net_debt": net_debt,
        "revenue": revenue,
        "ebit": ebit,
        "depreciation_amortization": da,
        "ebitda_proxy": ebitda,
        "net_income": net_income,
        "financial_result": financial_result,
        "financial_expense": financial_expense,
        "equity": equity,
        "nd_ebitda": nd_ebitda,
        "current_debt_ratio": current_debt_ratio,
        "cash_short_term_debt_coverage": cash_short_term_debt_coverage,
        "debt_to_equity": debt_to_equity,
        "ebit_interest_coverage": ebit_interest_coverage,
        "ebitda_interest_coverage": ebitda_interest_coverage,
        "ebit_margin": ebit_margin,
        "ebitda_margin": ebitda_margin,
        "metric_quality": {
            "scope": "consolidated_preferred",
            "ebitda_proxy": da is not None,
            "cash_found": cash is not None,
            "debt_found": gross_debt is not None,
        },
    }


def _load_dfp_metadata(extract_dir, year):
    path = os.path.join(extract_dir, f"dfp_cia_aberta_{year}.csv")
    grouped = {}
    for row in _rows_from_csv(path):
        key = normalize_cnpj(row.get("CNPJ_CIA"))
        if not key:
            continue
        grouped.setdefault(key, []).append(row)
    return grouped


@lru_cache(maxsize=8)
def load_financial_metrics(year):
    extract_dir = ensure_dfp_extracted(year, force=False)
    cadastro_map = {row["CNPJ_NUM"]: row for row in load_cadastro() if row.get("CNPJ_NUM")}

    def _load_grouped(filename):
        path = os.path.join(extract_dir, filename)
        if not os.path.exists(path):
            return {}
        return _group_rows(_rows_from_csv(path))

    dre_con = _load_grouped(f"dfp_cia_aberta_DRE_con_{year}.csv")
    bpa_con = _load_grouped(f"dfp_cia_aberta_BPA_con_{year}.csv")
    bpp_con = _load_grouped(f"dfp_cia_aberta_BPP_con_{year}.csv")
    dva_con = _load_grouped(f"dfp_cia_aberta_DVA_con_{year}.csv")

    dre_ind = _load_grouped(f"dfp_cia_aberta_DRE_ind_{year}.csv")
    bpa_ind = _load_grouped(f"dfp_cia_aberta_BPA_ind_{year}.csv")
    bpp_ind = _load_grouped(f"dfp_cia_aberta_BPP_ind_{year}.csv")
    dva_ind = _load_grouped(f"dfp_cia_aberta_DVA_ind_{year}.csv")

    meta_rows = _load_dfp_metadata(extract_dir, year)

    cnpjs = (
        set(dre_con) | set(bpa_con) | set(bpp_con) | set(dva_con) |
        set(dre_ind) | set(bpa_ind) | set(bpp_ind) | set(dva_ind) |
        set(meta_rows)
    )

    records = {}
    for cnpj_num in cnpjs:
        cadastro_row = cadastro_map.get(cnpj_num)

        # Prefer consolidated; fall back to individual when consolidated absent
        has_con = cnpj_num in dre_con
        dre = dre_con.get(cnpj_num) or dre_ind.get(cnpj_num) or []
        bpa = bpa_con.get(cnpj_num) or bpa_ind.get(cnpj_num) or []
        bpp = bpp_con.get(cnpj_num) or bpp_ind.get(cnpj_num) or []
        dva = dva_con.get(cnpj_num) or dva_ind.get(cnpj_num) or []

        record = _build_metric_record(cadastro_row, dre, bpa, bpp, dva, year)
        record["metric_quality"]["scope"] = "consolidated" if has_con else "individual"

        meta = meta_rows.get(cnpj_num, [])
        if meta:
            latest_meta = sorted(
                meta,
                key=lambda item: (
                    item.get("DT_RECEB") or "",
                    item.get("VERSAO") or "",
                ),
                reverse=True,
            )[0]
            record["dt_refer"] = latest_meta.get("DT_REFER")
            record["dt_receb"] = latest_meta.get("DT_RECEB")
            record["versao"] = latest_meta.get("VERSAO")
            record["categoria_doc"] = latest_meta.get("CATEG_DOC")
            record["id_doc"] = latest_meta.get("ID_DOC")
        records[cnpj_num] = record
    return records


def get_company_snapshot(identifier, year):
    identifier_norm = normalize_cnpj(identifier) or str(identifier).strip()

    cadastro_row = None
    for row in load_cadastro():
        if normalize_cnpj(row.get("CNPJ_CIA")) == identifier_norm or row.get("CD_CVM") == identifier_norm:
            cadastro_row = row
            break

    if cadastro_row is None:
        return None

    metrics = load_financial_metrics(year).get(cadastro_row["CNPJ_NUM"], {})
    company = {
        "cd_cvm":               cadastro_row.get("CD_CVM"),
        "cnpj":                 cadastro_row.get("CNPJ_CIA"),
        "denom_social":         cadastro_row.get("DENOM_SOCIAL"),
        "denom_comercial":      cadastro_row.get("DENOM_COMERC"),
        "setor_atividade":      cadastro_row.get("SETOR_ATIV"),
        "situacao":             cadastro_row.get("SIT"),
        "situacao_emissor":     cadastro_row.get("SIT_EMISSOR"),
        "controle_acionario":   cadastro_row.get("CONTROLE_ACIONARIO"),
        "categoria_registro":   cadastro_row.get("CATEG_REG"),
    }
    return {
        "company": company,
        "financials": metrics,
    }


def get_company_financial_history(identifier, year_end=None, years=5):
    identifier_norm = normalize_cnpj(identifier) or str(identifier).strip()

    cadastro_row = None
    for row in load_cadastro():
        if normalize_cnpj(row.get("CNPJ_CIA")) == identifier_norm or row.get("CD_CVM") == identifier_norm:
            cadastro_row = row
            break

    if cadastro_row is None:
        return None

    if year_end is None:
        year_end = dt.date.today().year - 1
    years = max(1, min(int(years), 10))
    year_start = year_end - years + 1

    history = []
    for year in range(year_start, year_end + 1):
        try:
            metrics = load_financial_metrics(year).get(cadastro_row["CNPJ_NUM"])
        except Exception:
            metrics = None
        if not metrics:
            continue
        history.append(metrics)

    company = {
        "cd_cvm": cadastro_row.get("CD_CVM"),
        "denom_social": cadastro_row.get("DENOM_SOCIAL"),
        "denom_comercial": cadastro_row.get("DENOM_COMERC"),
        "setor_atividade": cadastro_row.get("SETOR_ATIV"),
    }
    return {
        "company": company,
        "history": history,
    }
