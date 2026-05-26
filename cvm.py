import csv
import io
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


def _rows_from_zip(zip_path, member_name):
    with zipfile.ZipFile(zip_path) as zf:
        with zf.open(member_name) as fh:
            wrapper = io.TextIOWrapper(fh, encoding="latin-1", newline="")
            yield from csv.DictReader(wrapper, delimiter=";")


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


def _find_account_value(rows, code_prefixes=None, description_terms=None, fixed_only=True):
    code_prefixes = code_prefixes or []
    description_terms = description_terms or []
    terms = [_normalize_text(term) for term in description_terms]
    for row in rows:
        if fixed_only and row.get("ST_CONTA_FIXA") != "S":
            continue
        code = row.get("CD_CONTA", "")
        desc = _normalize_text(row.get("DS_CONTA"))
        code_match = any(code == prefix or code.startswith(prefix + ".") for prefix in code_prefixes)
        desc_match = terms and all(term in desc for term in terms)
        if code_match or desc_match:
            value = _to_float(row.get("VL_CONTA"))
            if value is None:
                continue
            return abs(value) * _scale_multiplier(row.get("ESCALA_MOEDA"))
    return None


def _build_metric_record(cadastro_row, dre_rows, bpa_rows, bpp_rows, dva_rows, year):
    dre_scope = _pick_latest_period(_pick_best_statement_group(dre_rows))
    bpa_scope = _pick_latest_period(_pick_best_statement_group(bpa_rows))
    bpp_scope = _pick_latest_period(_pick_best_statement_group(bpp_rows))
    dva_scope = _pick_latest_period(_pick_best_statement_group(dva_rows))

    cash = _find_account_value(
        bpa_scope,
        code_prefixes=["1.01", "1.01.01"],
        description_terms=["caixa", "equivalentes", "caixa"],
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
        description_terms=["resultado antes do resultado financeiro e dos tributos"],
    )
    if ebit is None:
        ebit = _find_account_value(
            dre_scope,
            code_prefixes=["3.05"],
            description_terms=["resultado antes dos tributos sobre o lucro"],
        )
    da = _find_account_value(
        dva_scope,
        description_terms=["depreciacao", "amortizacao", "exaustao"],
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
        "ebit": ebit,
        "depreciation_amortization": da,
        "ebitda_proxy": ebitda,
        "nd_ebitda": nd_ebitda,
        "metric_quality": {
            "scope": "consolidated_preferred",
            "ebitda_proxy": da is not None,
            "cash_found": cash is not None,
            "debt_found": gross_debt is not None,
        },
    }


@lru_cache(maxsize=8)
def load_financial_metrics(year):
    zip_path = ensure_dfp_zip(year, force=False)
    cadastro_map = {row["CNPJ_NUM"]: row for row in load_cadastro() if row.get("CNPJ_NUM")}

    dre_rows = _group_rows(_rows_from_zip(zip_path, f"dfp_cia_aberta_DRE_con_{year}.csv"))
    bpa_rows = _group_rows(_rows_from_zip(zip_path, f"dfp_cia_aberta_BPA_con_{year}.csv"))
    bpp_rows = _group_rows(_rows_from_zip(zip_path, f"dfp_cia_aberta_BPP_con_{year}.csv"))
    dva_rows = _group_rows(_rows_from_zip(zip_path, f"dfp_cia_aberta_DVA_con_{year}.csv"))

    cnpjs = set(dre_rows) | set(bpa_rows) | set(bpp_rows) | set(dva_rows)
    records = {}
    for cnpj_num in cnpjs:
        cadastro_row = cadastro_map.get(cnpj_num)
        record = _build_metric_record(
            cadastro_row,
            dre_rows.get(cnpj_num, []),
            bpa_rows.get(cnpj_num, []),
            bpp_rows.get(cnpj_num, []),
            dva_rows.get(cnpj_num, []),
            year,
        )
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
        "cd_cvm": cadastro_row.get("CD_CVM"),
        "cnpj": cadastro_row.get("CNPJ_CIA"),
        "denom_social": cadastro_row.get("DENOM_SOCIAL"),
        "denom_comercial": cadastro_row.get("DENOM_COMERC"),
        "setor_atividade": cadastro_row.get("SETOR_ATIV"),
        "situacao": cadastro_row.get("SIT"),
        "situacao_emissor": cadastro_row.get("SIT_EMISSOR"),
        "controle_acionario": cadastro_row.get("CONTROLE_ACIONARIO"),
        "categoria_registro": cadastro_row.get("CATEG_REG"),
    }
    return {
        "company": company,
        "financials": metrics,
    }
