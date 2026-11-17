#!/usr/bin/env python3
"""
Convert paper/paper.md (the single source) to LaTeX. It handles only the Markdown the paper uses: headings, paragraphs,
bullet and numbered lists (nested by indentation), pipe tables, images, bold/italic/code, links and horizontal rules.
  python3 paper/build/md2tex.py paper/paper.md > paper/build/paper.tex      (paper/build/build.sh does it all)
"""
import re
import sys

src = open(sys.argv[1], encoding='utf8').read().split('\n')

SPECIAL = {'\\': r'\textbackslash{}', '&': r'\&', '%': r'\%', '$': r'\$', '#': r'\#', '_': r'\_', '{': r'\{', '}': r'\}',
           '~': r'\textasciitilde{}', '^': r'\textasciicircum{}'}
UNI = {'−': '$-$', '≤': '$\\le$', '≥': '$\\ge$', '×': '$\\times$', '→': '$\\rightarrow$', '←': '$\\leftarrow$', 'Δ': '$\\Delta$',
       '≈': '$\\approx$', '–': '--', '—': '---', '…': '\\ldots{}', '“': '``', '”': "''", '’': "'", '‘': '`', '·': '$\\cdot$', '±': '$\\pm$',
       '✓': '$\\checkmark$', ' ': ' '}


def esc(s):
    out = ''.join(SPECIAL.get(c, c) for c in s)
    for k, v in UNI.items():
        out = out.replace(k, v)
    return out


def inline(s):
    """Markdown inline -> LaTeX. Code spans first (verbatim-ish), then links, bold, italic."""
    parts = re.split(r'(`[^`]*`)', s)
    res = []
    for p in parts:
        if p.startswith('`') and p.endswith('`') and len(p) >= 2:
            res.append(r'\texttt{' + esc(p[1:-1]).replace('/', r'/\allowbreak{}') + '}')
            continue
        # links [text](url)
        tokens = []
        def link(m):
            tokens.append((m.group(1), m.group(2)))
            return f'\x00{len(tokens) - 1}\x00'
        p = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link, p)
        p = re.sub(r'(\d)\^(\d+)', lambda m: f'{m.group(1)}\x01{m.group(2)}\x02', p)
        p = re.sub(r'"([^"]+)"', lambda m: f'\x03{m.group(1)}\x04', p)
        p = esc(p)
        p = p.replace('\x01', '$^{').replace('\x02', '}$').replace('\x03', '``').replace('\x04', "''")
        p = re.sub(r'\*\*(.+?)\*\*', r'\\textbf{\1}', p)
        p = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'\\emph{\1}', p)
        def unlink(m):
            text, url = tokens[int(m.group(1))]
            t = inline(text)
            if url.startswith('http'):
                return r'\href{' + url.replace('%', r'\%').replace('#', r'\#') + '}{' + t + '}'
            return t  # repository-relative links: keep the text (the claim-to-source map names the files)
        p = re.sub(r'\x00(\d+)\x00', unlink, p)
        res.append(p)
    return ''.join(res)


out = []
i = 0
title_done = False
list_stack = []  # (indent, kind)


def close_lists(to_indent=-1):
    while list_stack and list_stack[-1][0] > to_indent:
        _, kind = list_stack.pop()
        out.append(r'\end{itemize}' if kind == 'ul' else r'\end{enumerate}')


def table(rows):
    cells = [[c.strip() for c in r.strip().strip('|').split('|')] for r in rows]
    head, align, body = cells[0], cells[1], cells[2:]
    n = len(head)
    spec = ''
    for a in align[:n]:
        spec += 'r' if a.endswith(':') and not a.startswith(':') else 'X'
    out.append(r'\begin{table}[H]\centering\footnotesize')
    out.append(r'\begin{tabularx}{\linewidth}{' + spec.replace('X', '>{\\raggedright\\arraybackslash}X') + '}')
    out.append(r'\toprule')
    out.append(' & '.join(r'\textbf{' + inline(h) + '}' for h in head) + r' \\')
    out.append(r'\midrule')
    for r in body:
        r = (r + [''] * n)[:n]
        out.append(' & '.join(inline(c) for c in r) + r' \\')
    out.append(r'\bottomrule')
    out.append(r'\end{tabularx}')
    out.append(r'\end{table}')


para = []


def flush_para():
    global para
    if para:
        out.append(inline(' '.join(para)))
        out.append('')
        para = []


while i < len(src):
    line = src[i]
    s = line.strip()
    if s.startswith('# ') and not title_done:
        out.append(r'\title{' + inline(s[2:]) + '}')
        title_done = True
        i += 1
        continue
    if not title_done or s.startswith('**Draft,') or s.startswith('*Author:'):
        if s.startswith('**Draft,') or s.startswith('*Author:'):
            i += 1
            while i < len(src) and src[i].strip() and not src[i].startswith('#'):
                i += 1
            continue
    if s == '---':
        flush_para(); close_lists(); i += 1; continue
    if s.startswith('|'):
        flush_para(); close_lists()
        rows = []
        while i < len(src) and src[i].strip().startswith('|'):
            rows.append(src[i]); i += 1
        table(rows)
        continue
    m = re.match(r'!\[([^\]]*)\]\(([^)]+)\)', s)
    if m:
        flush_para(); close_lists()
        img = m.group(2).replace('.svg', '.png')
        cap = ''
        if i + 2 < len(src) and src[i + 2].strip().startswith('*Figure'):
            cap = src[i + 2].strip().strip('*')
            i += 2
        out.append(r'\begin{figure}[H]\centering\includegraphics[width=\linewidth]{' + img + '}')
        if cap:
            out.append(r'\caption{' + inline(re.sub(r'^Figure \d+\.\s*', '', cap)) + '}')
        out.append(r'\end{figure}')
        i += 1
        continue
    h = re.match(r'(#{2,4}) (.*)', s)
    if h:
        flush_para(); close_lists()
        level, text = len(h.group(1)), h.group(2)
        text = re.sub(r'^\d+(\.\d+)*\.?\s+', '', text)
        if text.lower() == 'abstract':
            out.append(r'\begin{abstract}')
            i += 1
            body = []
            while i < len(src) and not src[i].startswith('#') and src[i].strip() != '---':
                body.append(src[i]); i += 1
            paras = '\n'.join(body).strip().split('\n\n')
            out.append('\n\n'.join(inline(' '.join(p.split())) for p in paras))
            out.append(r'\end{abstract}')
            continue
        cmd = {2: 'section', 3: 'subsection', 4: 'paragraph'}[level]
        star = '*' if text.lower() in ('references',) else ''
        out.append(f'\\{cmd}{star}{{{inline(text)}}}')
        i += 1
        continue
    lm = re.match(r'^(\s*)([-*]|\d+\.) (.*)', line)
    if lm:
        flush_para()
        ind, mark, text = len(lm.group(1)), lm.group(2), lm.group(3)
        kind = 'ol' if mark[0].isdigit() else 'ul'
        close_lists(ind)
        if not list_stack or list_stack[-1][0] < ind:
            list_stack.append((ind, kind))
            out.append(r'\begin{itemize}' if kind == 'ul' else r'\begin{enumerate}')
        # continuation lines
        j = i + 1
        while j < len(src) and src[j].strip() and not re.match(r'^\s*([-*]|\d+\.) ', src[j]) and src[j].startswith(' ' * (ind + 2)) and not src[j].strip().startswith('|'):
            text += ' ' + src[j].strip(); j += 1
        out.append(r'\item ' + inline(text))
        i = j
        continue
    if not s:
        flush_para()
        if list_stack and not (i + 1 < len(src) and re.match(r'^\s+\S', src[i + 1])):
            close_lists()
        i += 1
        continue
    if list_stack and line.startswith('  '):
        # paragraph inside a list item: close the deeper lists first
        close_lists(len(line) - len(line.lstrip()) - 1)
        block = [s]; i += 1
        while i < len(src) and src[i].startswith('  ') and src[i].strip() and not re.match(r'^\s*([-*]|\d+\.) ', src[i]) and not src[i].strip().startswith('|'):
            block.append(src[i].strip()); i += 1
        out.append('')
        out.append(inline(' '.join(block)))
        continue
    close_lists()
    para.append(s)
    i += 1

flush_para(); close_lists()
body = '\n'.join(out)
title = re.search(r'\\title\{.*?\}\n', body + '\n')
body = body.replace(title.group(0), '') if title else body

preamble = r'''\documentclass[10pt]{article}
\usepackage[a4paper,margin=2.2cm]{geometry}
\usepackage{fontspec}
\usepackage{booktabs,tabularx,graphicx,array,amssymb,float}
\usepackage[hidelinks]{hyperref}
\usepackage{enumitem}
\setlist{nosep,leftmargin=1.4em}
\setlength{\parskip}{0.4em}\setlength{\parindent}{0pt}
\renewcommand{\arraystretch}{1.15}
''' + (title.group(0) if title else '') + r'''\author{[Author to be added]}
\date{Draft, 18 November 2026}
\begin{document}
\maketitle
'''
print(preamble + body + '\n\\end{document}')
