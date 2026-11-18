#!/usr/bin/env python3
"""Convert the finance workbook into data/model.json for the web app.

Usage: python3 tools/build_model.py <workbook.xlsx> <out_dir> [--expected test_dir]

Everything the page needs is taken from the workbook: layout, styles, formulas
(parsed into a compact tree with relative references), drop-downs, colour rules,
charts and the current values of the unlocked input cells.
"""
import sys, re, json, datetime, warnings, colorsys
import openpyxl
from openpyxl.formula.tokenizer import Tokenizer
from openpyxl.utils import get_column_letter, column_index_from_string, range_boundaries
warnings.filterwarnings('ignore')

SRC, OUT = sys.argv[1], sys.argv[2]
EXP = sys.argv[sys.argv.index('--expected') + 1] if '--expected' in sys.argv else None

wb = openpyxl.load_workbook(SRC)
SHEETS = wb.sheetnames
SIDX = {n: i for i, n in enumerate(SHEETS)}
EPOCH = datetime.datetime(1899, 12, 30)

def serial(v):
    if isinstance(v, datetime.datetime): d = v - EPOCH; return d.days + d.seconds / 86400
    if isinstance(v, datetime.date): return (datetime.datetime(v.year, v.month, v.day) - EPOCH).days
    if isinstance(v, datetime.time): return (v.hour * 3600 + v.minute * 60 + v.second) / 86400
    return v

# ---------------------------------------------------------------- tables
TABLES = {}
for ws in wb:
    for t in ws.tables.values():
        c1, r1, c2, r2 = range_boundaries(t.ref)
        hdr = 1 if t.headerRowCount is None else t.headerRowCount
        tot = t.totalsRowCount or 0
        TABLES[t.name] = dict(sheet=SIDX[ws.title], c1=c1 - 1, c2=c2 - 1, hr=r1 - 1,
                              r1=r1 - 1 + hdr, r2=r2 - 1 - tot,
                              cols=[tc.name for tc in t.tableColumns])

# ---------------------------------------------------------------- formula parser
REF_RE = re.compile(r"^(?:(?:'((?:[^']|'')+)'|([A-Za-z0-9_.]+))!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?$")
TBL_RE = re.compile(r"^(\w+)\[(.*)\]$")

class Parser:
    """Pratt parser over openpyxl tokens. Produces JSON-able trees.
    Cell references are stored relative to the owning cell unless anchored with $."""
    PREC = {'=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5}

    def __init__(self, text, sheet, row, col):
        self.toks = [t for t in Tokenizer(text if text.startswith('=') else '=' + text).items if t.type != 'WHITE-SPACE']
        self.i = 0; self.sheet, self.row, self.col = sheet, row, col

    def peek(self): return self.toks[self.i] if self.i < len(self.toks) else None
    def next(self): t = self.toks[self.i]; self.i += 1; return t

    def parse(self):
        e = self.expr(0)
        assert self.peek() is None, ('trailing', self.peek().value)
        return e

    def expr(self, minp):
        left = self.unary()
        while True:
            t = self.peek()
            if t is None: break
            if t.type == 'OPERATOR-POSTFIX':
                self.next(); left = ['p', left]; continue
            if t.type != 'OPERATOR-INFIX': break
            p = self.PREC[t.value]
            if p <= minp: break
            self.next()
            right = self.expr(p)
            left = ['b', t.value, left, right]
        return left

    def unary(self):
        t = self.peek()
        if t.type == 'OPERATOR-PREFIX':
            self.next(); x = self.unary()
            return x if t.value == '+' else ['u', x]
        return self.primary()

    def primary(self):
        t = self.next()
        if t.type == 'OPERAND':
            if t.subtype == 'NUMBER': return float(t.value) if re.search(r'[.eE]', t.value) else int(t.value)
            if t.subtype == 'TEXT': return ['s', t.value[1:-1].replace('""', '"')]
            if t.subtype == 'LOGICAL': return t.value.upper() == 'TRUE'
            if t.subtype == 'ERROR': return ['e', t.value]
            return self.ref(t.value)
        if t.type == 'FUNC' and t.subtype == 'OPEN':
            name = t.value[:-1].upper(); args = []
            if self.peek().type == 'FUNC' and self.peek().subtype == 'CLOSE':
                self.next(); return ['f', name]
            while True:
                nt = self.peek()
                if nt.type == 'SEP' or (nt.type == 'FUNC' and nt.subtype == 'CLOSE'): args.append(None)
                else: args.append(self.expr(0))
                nt = self.next()
                if nt.type == 'FUNC' and nt.subtype == 'CLOSE': break
                assert nt.type == 'SEP' and nt.value == ',', nt.value
            return ['f', name] + args
        if t.type == 'PAREN' and t.subtype == 'OPEN':
            e = self.expr(0); c = self.next(); assert c.type == 'PAREN'
            return e
        raise ValueError('unexpected token %s %r' % (t.type, t.value))

    def cellpart(self, dc, cl, dr, rw):
        c = column_index_from_string(cl.upper()) - 1; r = int(rw) - 1; fl = 0
        if dr: fl |= 1
        else: r -= self.row
        if dc: fl |= 2
        else: c -= self.col
        return r, c, fl

    def ref(self, v):
        m = REF_RE.match(v)
        if m:
            sn = m.group(1).replace("''", "'") if m.group(1) else m.group(2)
            sh = SIDX[sn] if sn else self.sheet
            r, c, fl = self.cellpart(m.group(3), m.group(4), m.group(5), m.group(6))
            if m.group(8) is None: return ['r', sh, r, c, fl]
            r2, c2, fl2 = self.cellpart(m.group(7), m.group(8), m.group(9), m.group(10))
            return ['a', sh, r, c, fl, r2, c2, fl2]
        m = TBL_RE.match(v)
        if m and m.group(1) in TABLES:
            t = TABLES[m.group(1)]; spec = m.group(2)
            parts = re.findall(r"\[([^\[\]]*)\]", spec) if spec.startswith('[') else [spec]
            flag = [p for p in parts if p.startswith('#')]
            names = [p for p in parts if not p.startswith('#')]
            assert len(names) == 1, v
            c = t['c1'] + t['cols'].index(names[0].replace("'", ''))
            if flag == ['#This Row']: return ['r', t['sheet'], 0, c, 2]
            if flag == ['#Headers']: return ['r', t['sheet'], t['hr'], c, 3]
            assert not flag, v
            return ['a', t['sheet'], t['r1'], c, 3, t['r2'], c, 3]
        assert re.match(r'^[A-Za-z_][\w.]*$', v), ('unknown operand', v)
        return ['n', v]

AST = []; AST_IDX = {}
def ast_id(text, sheet, row, col):
    tree = Parser(text, sheet, row, col).parse()
    key = json.dumps(tree, separators=(',', ':'))
    if key not in AST_IDX: AST_IDX[key] = len(AST); AST.append(tree)
    return AST_IDX[key]

# ---------------------------------------------------------------- colours
THEME = []
try:
    import xml.etree.ElementTree as ET
    ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
    root = ET.fromstring(wb.loaded_theme)
    cs = root.find('.//a:clrScheme', ns)
    order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']
    for nme in order:
        el = cs.find('a:' + nme, ns)[0]
        THEME.append(el.get('val') or el.get('lastClr'))
except Exception:
    THEME = ['FFFFFF', '000000', 'EEECE1', '1F497D', '4F81BD', 'C0504D', '9BBB59', '8064A2', '4BACC6', 'F79646', '0000FF', '800080']
from openpyxl.styles.colors import COLOR_INDEX

def color(c):
    if c is None: return None
    try:
        if c.type == 'rgb' and isinstance(c.rgb, str):
            v = c.rgb[-6:]
            return None if c.rgb == '00000000' else '#' + v
        if c.type == 'theme':
            h = THEME[c.theme]; t = c.tint or 0
            r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
            hh, l, s = colorsys.rgb_to_hls(r, g, b)
            l = l * (1 + t) if t < 0 else l * (1 - t) + t
            r, g, b = colorsys.hls_to_rgb(hh, l, s)
            return '#%02X%02X%02X' % (round(r * 255), round(g * 255), round(b * 255))
        if c.type == 'indexed' and c.indexed < 64: return '#' + COLOR_INDEX[c.indexed][-6:]
    except Exception: pass
    return None

STYLES = []; STYLE_IDX = {}; RAW_STYLE = {}
def style_of(c):
    raw = tuple(c._style) if c._style is not None else ()
    if raw in RAW_STYLE: return RAW_STYLE[raw]
    s = {}
    f = c.font
    if f.b: s['b'] = 1
    if f.i: s['i'] = 1
    if f.u: s['u'] = 1
    if f.sz and f.sz != 11: s['sz'] = f.sz
    fc = color(f.color)
    if fc and fc != '#000000': s['fc'] = fc
    if f.name and f.name not in ('Calibri',): s['fn'] = f.name
    if c.fill and c.fill.fill_type == 'solid':
        bg = color(c.fill.fgColor)
        if bg: s['bg'] = bg
    a = c.alignment
    if a.horizontal and a.horizontal != 'general': s['h'] = a.horizontal
    if a.vertical: s['v'] = a.vertical
    if a.wrap_text: s['w'] = 1
    if a.indent: s['in'] = int(a.indent)
    bd = c.border; bs = {}
    for k, side in (('t', bd.top), ('r', bd.right), ('b', bd.bottom), ('l', bd.left)):
        if side is not None and side.style: bs[k] = [side.style, color(side.color) or '#000000']
    if bs: s['bd'] = bs
    if c.number_format and c.number_format != 'General': s['nf'] = c.number_format
    if c.protection is not None and c.protection.locked is False: s['e'] = 1
    key = json.dumps(s, sort_keys=True)
    if key not in STYLE_IDX: STYLE_IDX[key] = len(STYLES); STYLES.append(s)
    RAW_STYLE[raw] = STYLE_IDX[key]
    return STYLE_IDX[key]

def dxf_style(d):
    s = {}
    if d is None: return s
    if d.fill is not None:
        bg = color(d.fill.bgColor) or color(d.fill.fgColor)
        if bg: s['bg'] = bg
    if d.font is not None:
        fc = color(d.font.color)
        if fc: s['fc'] = fc
        if d.font.b: s['b'] = 1
        if d.font.i: s['i'] = 1
    return s

def rngs(sqref):
    out = []
    for part in str(sqref).split():
        c1, r1, c2, r2 = range_boundaries(part)
        out.append([r1 - 1, c1 - 1, r2 - 1, c2 - 1])
    return out

def dedupe_rows(rows):
    sigs = []; idx = {}; order = []
    for row in rows:
        k = tuple(row)
        if k not in idx: idx[k] = len(sigs); sigs.append(row)
        order.append(idx[k])
    return order, sigs

# ---------------------------------------------------------------- sheets
VIEW_SHEETS = {'Start', 'Dashboard', 'Period Reports', 'Daily Fund Flow', 'Vertical P&L'}
VIEW_CELLS = {'Cash Flow': {'L2', 'M2', 'N2'}}
EXAMPLE = {}
model_sheets = []
for ws in wb:
    si = SIDX[ws.title]
    nrows, ncols = ws.max_row, ws.max_column
    srows, frows, consts, seed, links = [], [], [], [], []
    for r in range(1, nrows + 1):
        srow, frow = [], []
        for c in range(1, ncols + 1):
            cell = ws.cell(r, c)
            st = style_of(cell); srow.append(st)
            v = cell.value; fi = 0
            if hasattr(v, 'text'): v = v.text
            if isinstance(v, str) and v.startswith('=') and len(v) > 1:
                fi = ast_id(v, si, r - 1, c - 1) + 1
            elif v is not None:
                v = serial(v)
                (seed if STYLES[st].get('e') else consts).append([r - 1, c - 1, v])
            frow.append(fi)
            if cell.hyperlink is not None and cell.hyperlink.location:
                links.append([r - 1, c - 1, cell.hyperlink.location])
        srows.append(srow); frows.append(frow)
    # Unlocked cells on report tabs are selectors (year, period, vertical): kept per user, never saved.
    # Unlocked "Input" legend cells are labels, not data.
    view, lock = [], []
    report = ws.title in VIEW_SHEETS
    for (r0, c0, v0) in list(seed):
        coord = get_column_letter(c0 + 1) + str(r0 + 1)
        if isinstance(v0, str) and v0.strip() == 'Input': lock.append([r0, c0]); seed.remove([r0, c0, v0]); consts.append([r0, c0, v0])
    for r in range(1, nrows + 1):
        for c in range(1, ncols + 1):
            cell = ws.cell(r, c)
            if cell.protection is not None and cell.protection.locked is False and not frows[r - 1][c - 1]:
                coord = cell.coordinate
                if report or coord in VIEW_CELLS.get(ws.title, ()): view.append([r - 1, c - 1])
    vset = {(a, b) for a, b in view}
    defaults = [t for t in seed if (t[0], t[1]) in vset]
    data_seed = [t for t in seed if (t[0], t[1]) not in vset]
    EXAMPLE[ws.title] = data_seed
    seed = defaults
    so, ss = dedupe_rows(srows); fo, fs = dedupe_rows(frows)
    colw = []
    dims = {}
    for letter, d in ws.column_dimensions.items():
        lo = d.min or column_index_from_string(letter); hi = d.max or lo
        for k in range(lo, hi + 1): dims[k] = d
    defw = ws.sheet_format.defaultColWidth or 8.43
    for c in range(1, ncols + 1):
        d = dims.get(c)
        w = d.width if d is not None and d.width else defw
        colw.append(0 if d is not None and d.hidden else round(w * 7 + 5))
    defh = ws.sheet_format.defaultRowHeight or 15
    rowh = {}
    for r, d in ws.row_dimensions.items():
        if r > nrows: continue
        if d.hidden: rowh[r - 1] = 0
        elif d.height: rowh[r - 1] = round(d.height * 4 / 3)
    fr = [0, 0]
    if ws.freeze_panes:
        m = re.match(r'([A-Z]+)(\d+)', ws.freeze_panes)
        fr = [int(m.group(2)) - 1, column_index_from_string(m.group(1)) - 1]
    cfs = []
    for rng, rules in ws.conditional_formatting._cf_rules.items():
        rr = rngs(rng.sqref)
        for rule in rules:
            item = dict(rg=rr, t=rule.type, pr=rule.priority or 0, st=dxf_style(rule.dxf))
            if rule.operator: item['op'] = rule.operator
            if rule.stopIfTrue: item['stop'] = 1
            if rule.formula: item['f'] = [ast_id(f, si, rr[0][0], rr[0][1]) for f in rule.formula]
            if rule.dataBar is not None: item['bar'] = color(rule.dataBar.color) or '#638EC6'
            cfs.append(item)
    cfs.sort(key=lambda x: x['pr'])
    dvs = []
    for dv in ws.data_validations.dataValidation:
        if not dv.type: continue
        rr = rngs(dv.sqref)
        item = dict(rg=rr, t=dv.type)
        if dv.operator: item['op'] = dv.operator
        if dv.error: item['err'] = dv.error
        if dv.prompt: item['tip'] = dv.prompt
        if dv.allow_blank: item['blank'] = 1
        if dv.type == 'list' and dv.formula1.startswith('"'):
            item['list'] = [x.strip() for x in dv.formula1[1:-1].split(',')]
        else:
            if dv.formula1 is not None: item['f1'] = ast_id(dv.formula1, si, rr[0][0], rr[0][1])
            if dv.formula2 is not None: item['f2'] = ast_id(dv.formula2, si, rr[0][0], rr[0][1])
        dvs.append(item)
    charts = []
    for ch in ws._charts:
        a = ch.anchor
        def txt(t):
            try: return ''.join(r.t for p in t.tx.rich.p for r in (p.r or []))
            except Exception: return None
        c = dict(fr=[a._from.row, a._from.col], to=[a.to.row, a.to.col], title=txt(ch.title) if ch.title else None, parts=[])
        try: c['legend'] = ch.legend.position if ch.legend is not None else None
        except Exception: c['legend'] = None
        for sub in ch._charts:
            kind = type(sub).__name__.replace('Chart', '').lower()
            part = dict(k=kind, series=[])
            if kind == 'bar': part['dir'] = sub.barDir; part['grp'] = sub.grouping
            try: part['ax'] = sub.y_axis.axId
            except Exception: pass
            try: part['nf'] = sub.y_axis.number_format.formatCode
            except Exception: pass
            for s in sub.series:
                sd = {}
                if s.tx is not None:
                    if s.tx.strRef is not None: sd['nameRef'] = ast_id(s.tx.strRef.f, si, 0, 0)
                    elif s.tx.v is not None: sd['name'] = s.tx.v
                if s.val is not None and s.val.numRef is not None: sd['val'] = ast_id(s.val.numRef.f, si, 0, 0)
                if s.cat is not None:
                    ref = s.cat.numRef or s.cat.strRef
                    if ref is not None: sd['cat'] = ast_id(ref.f, si, 0, 0)
                gp = s.graphicalProperties
                try:
                    if gp is not None and gp.solidFill is not None and gp.solidFill.srgbClr is not None: sd['color'] = '#' + gp.solidFill.srgbClr.val
                    elif gp is not None and gp.line is not None and gp.line.solidFill is not None: sd['color'] = '#' + gp.line.solidFill.srgbClr.val
                except Exception: pass
                try:
                    pts = [(p.idx, '#' + p.spPr.solidFill.srgbClr.val) for p in (s.dPt or []) if p.spPr is not None and p.spPr.solidFill is not None]
                    if pts: sd['pts'] = pts
                except Exception: pass
                part['series'].append(sd)
            c['parts'].append(part)
        charts.append(c)
    merges = [[m.min_row - 1, m.min_col - 1, m.max_row - 1, m.max_col - 1] for m in ws.merged_cells.ranges]
    tab = ws.sheet_properties.tabColor
    model_sheets.append(dict(name=ws.title, hidden=ws.sheet_state != 'visible', tab=color(tab) if tab else None,
                             nrows=nrows, ncols=ncols, colw=colw, rowh=rowh, defh=round(defh * 4 / 3), freeze=fr,
                             so=so, ss=ss, fo=fo, fs=fs, consts=consts, seed=seed, merges=merges, cf=cfs, dv=dvs,
                             charts=charts, links=links, view=view, lock=lock,
                             grid=ws.sheet_view.showGridLines is not False, zoom=ws.sheet_view.zoomScale or 100))
    print('%-22s rows=%d cols=%d styleSigs=%d formulaSigs=%d consts=%d seed=%d' % (ws.title, nrows, ncols, len(ss), len(fs), len(consts), len(seed)))

names = {}
for n, d in wb.defined_names.items():
    try: names[n] = ast_id(d.attr_text, 0, 0, 0)
    except Exception as ex: print('skip name', n, ex)
tables = {k: dict(sheet=v['sheet'], c1=v['c1'], c2=v['c2'], hr=v['hr'], r1=v['r1'], r2=v['r2'], cols=v['cols']) for k, v in TABLES.items()}
model = dict(version=1, sheets=model_sheets, styles=STYLES, ast=AST, names=names, tables=tables)
with open(OUT + '/model.json', 'w') as fh: json.dump(model, fh, separators=(',', ':'), ensure_ascii=False)
print('styles', len(STYLES), 'formula trees', len(AST))

if EXP:
    with open(EXP + '/example-inputs.json', 'w') as fh: json.dump(EXAMPLE, fh, separators=(',', ':'), ensure_ascii=False)
    wv = openpyxl.load_workbook(SRC, data_only=True)
    exp = {}
    for ws in wv:
        wf = wb[ws.title]; d = {}
        for row in wf.iter_rows():
            for c in row:
                v = c.value
                if hasattr(v, 'text'): v = v.text
                if isinstance(v, str) and v.startswith('=') and len(v) > 1:
                    d[c.coordinate] = serial(ws[c.coordinate].value)
        exp[ws.title] = d
    with open(EXP + '/expected.json', 'w') as fh: json.dump(exp, fh, separators=(',', ':'), ensure_ascii=False)
