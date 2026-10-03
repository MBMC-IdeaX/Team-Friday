#!/usr/bin/env python3
"""
Generates docs/workflow.svg — the hackathon "Project Workflow" flowchart.

Why a script and not hand-written SVG: the arrow routing between swimlanes is
geometry, and geometry should be computed. Every box position and every arrow
endpoint below is derived, so moving a step cannot silently break an arrow.

Run:  python3 scripts/make-workflow.py
Then: rsvg-convert -w 2000 docs/workflow.svg -o docs/workflow.png
"""
import html

W, LANE_X = 1720, 196
# ponytail: derive the lane width so the four lanes always fit the canvas.
LANE_W = (W - LANE_X - 24) // 4
KIND = {
    "user":   ("#e0f2fe", "#0284c7", "#075985"),
    "app":    ("#ccfbf1", "#0d9488", "#115e59"),
    "server": ("#ede9fe", "#7c3aed", "#4c1d95"),
    "data":   ("#dcfce7", "#16a34a", "#14532d"),
    "ext":    ("#fef3c7", "#d97706", "#78350f"),
    "stop":   ("#fee2e2", "#dc2626", "#7f1d1d"),
}
LANES = [("USER", "#075985"), ("APP / DEVICE", "#115e59"),
         ("SERVER (Next.js API)", "#4c1d95"), ("DATA & EXTERNAL", "#14532d")]

# (id, lane, y, w, kind, lines, label)
NODES = [
    ("u1", 0, 140, 300, "user", ["Open HerGuardian"],
     "1 · Start: map coloured by Safety Score"),
    ("a1", 1, 140, 330, "app", ["GET /api/cells"],
     "2 · Load the risk grid (cached if offline)"),
    ("d1", 3, 140, 300, "data", ["Postgres safety_cells", "609 cells · factors only"],
     "3 · Score computed on read, never stored"),

    ("u2", 0, 252, 300, "user", ["Search a place", "or tap the map"],
     "4 · Set a destination"),
    ("e1", 3, 252, 300, "ext", ["Nominatim", "geocode · debounced"],
     "4b · Place name → lat/lng"),
    ("a2", 1, 252, 330, "app", ["GET /api/routes"],
     "5 · Score ~60 points per geometry"),
    ("e2", 3, 364, 300, "ext", ["OSRM alternatives", "shortest + others"],
     "6 · Candidate routes"),
    ("d2", 3, 476, 300, "data", ["Offer the SAFEST route", "beside the shortest"],
     "7 · Chosen on risk, not speed"),

    ("u3", 0, 588, 300, "stop", ["TAP SOS", "or say “help me”"],
     "8 · One tap. No confirm dialog"),
    ("a3", 1, 588, 330, "stop", ["1 · Generate uuid", "2 · Write IndexedDB"],
     "9 · LOCAL FIRST — fired means persisted"),
    ("s1", 2, 588, 300, "server", ["POST /api/sos"],
     "10 · Upsert the session"),
    ("d3", 3, 588, 300, "data", ["guardian_sessions", "+ push_subscription_sessions"],
     "11 · Session row created"),

    ("a4", 1, 700, 330, "app", ["tel: dial", "share / sms with coords"],
     "12 · OS-level — needs no network"),
    ("s2", 2, 700, 300, "server", ["alertGuardians()", "deliberately not awaited"],
     "13 · Fire-and-forget push"),
    ("e3", 3, 700, 300, "ext", ["VAPID → FCM / Mozilla /", "Apple push service"],
     "14 · Server → guardian, not victim → server"),
    ("d4", 3, 812, 300, "data", ["Guardian's phone alerts", "with the tab closed"],
     "15 · Reaches a guardian who has no signal"),

    ("a5", 1, 812, 330, "app", ["MediaRecorder", "10-second chunks"],
     "16 · Record audio as you speak"),
    ("a6", 1, 924, 330, "app", ["chunks → IndexedDB", "flush on reconnect"],
     "17 · Evidence is local-first too"),
    ("s3", 2, 924, 300, "server", ["POST /api/recording"],
     "18 · Upload each chunk"),
    ("d5", 3, 924, 300, "data", ["Private Storage", "recordings/ bucket"],
     "19 · media_paths appended"),

    ("a7", 1, 1036, 330, "app", ["watchPosition", "PATCH pin every 5s"],
     "20 · Live position"),
    ("s4", 2, 1036, 300, "server", ["PATCH /api/sos"],
     "21 · Latest pin persisted"),
    ("d6", 3, 1036, 300, "data", ["Realtime Broadcast", "topic sos:<uuid>"],
     "22 · Guardian's pin moves live"),

    ("u4", 0, 1148, 300, "stop", ["Tap SOS again", "or “I'm safe”"],
     "23 · Stand down"),
    ("s5", 2, 1148, 300, "stop", ["PATCH status=resolved", "reuses the live session"],
     "24 · Never blocked · never spams guardians"),

    ("u5", 0, 1260, 300, "user", ["Report an unsafe spot"],
     "25 · Anonymous, no login"),
    ("s6", 2, 1260, 300, "server", ["POST /api/report"],
     "26 · Bump the 3 nearest cells"),
    ("d7", 3, 1260, 300, "data", ["report_risk +0.15", "7-day decay on read"],
     "27 · Nearby scores change"),

    ("u6", 0, 1372, 300, "user", ["Authority opens", "/dashboard"],
     "28 · The same tables"),
    ("d8", 3, 1372, 300, "data", ["Hotspot heatmap · top 10", "12-week trend"],
     "29 · One pipeline, two audiences"),
]

H = 1568


def esc(s):
    return html.escape(s, quote=True)


def wrap(text, width):
    """Crude word wrap so long labels don't overflow their box."""
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 <= width:
            cur = (cur + " " + w).strip()
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def box(n):
    nid, lane, y, w, kind, lines, cap = n
    x = LANE_X + lane * LANE_W
    fill, stroke, ink = KIND[kind]
    body = []
    for i, ln in enumerate(lines):
        body.append(
            f'<text x="{x + w/2}" y="{y + 26 + i*18}" text-anchor="middle" '
            f'font-family="ui-sans-serif,system-ui,sans-serif" font-size="14" '
            f'font-weight="600" fill="{ink}">{esc(ln)}</text>')
    # caption under the box
    for i, ln in enumerate(wrap(cap, 46)[:2]):
        body.append(
            f'<text x="{x + w/2}" y="{y + 30 + len(lines)*18 + i*15 + 2}" '
            f'text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" '
            f'font-size="11.5" fill="#64748b">{esc(ln)}</text>')
    h = 26 + len(lines) * 18 + 14
    return (f'<g><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>{"".join(body)}</g>'
            f'<rect id="{nid}" x="{x}" y="{y}" width="{w}" height="{h}" fill="none"/>'
            f'<rect id="{nid}-c" x="{x}" y="{y}" width="{w}" height="{h}" fill="none"/>'
            f'<rect id="{nid}-b" x="{x}" y="{y + h}" width="{w}" height="1" fill="none"/>')


POS = {n[0]: n for n in NODES}


def centre_bottom(nid):
    n = POS[nid]
    x = LANE_X + n[1] * LANE_W
    w = n[3]
    lines = len(n[5])
    h = 26 + lines * 18 + 14
    return (x + w / 2, n[2] + h)


def centre_top(nid):
    n = POS[nid]
    x = LANE_X + n[1] * LANE_W
    return (x + n[3] / 2, n[2])


def centre_right(nid):
    n = POS[nid]
    x = LANE_X + n[1] * LANE_W
    lines = len(n[5])
    h = 26 + lines * 18 + 14
    return (x + n[3], n[2] + h / 2)


def centre_left(nid):
    n = POS[nid]
    x = LANE_X + n[1] * LANE_W
    lines = len(n[5])
    h = 26 + lines * 18 + 14
    return (x, n[2] + h / 2)


ARROWS = [
    ("u1", "a1", "bottom", "right"), ("a1", "d1", "right", "left"),
    ("u2", "e1", "bottom", "top"), ("u2", "a2", "bottom", "top"),
    ("e1", "a2", "top", "top"), ("a2", "e2", "right", "left"),
    ("e2", "d2", "bottom", "top"), ("d2", "u3", "left", "left"),
    ("u3", "a3", "right", "left"), ("a3", "s1", "right", "left"),
    ("s1", "d3", "right", "left"), ("s1", "s2", "bottom", "top"),
    ("s2", "e3", "right", "left"), ("e3", "d4", "bottom", "top"),
    ("a3", "a4", "bottom", "top"), ("a4", "a5", "bottom", "top"),
    ("a5", "a6", "bottom", "top"), ("a6", "s3", "right", "left"),
    ("s3", "d5", "right", "left"), ("a7", "s4", "right", "left"),
    ("s4", "d6", "right", "left"), ("a7", "u4", "left", "left"),
    ("u4", "s5", "right", "left"), ("u5", "s6", "right", "left"),
    ("s6", "d7", "right", "left"), ("u6", "d8", "right", "left"),
]

out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
       f'viewBox="0 0 {W} {H}" font-family="ui-sans-serif,system-ui,sans-serif">',
       '<rect width="100%" height="100%" fill="#ffffff"/>']

# lane bands
for i, (name, colour) in enumerate(LANES):
    x = LANE_X + i * LANE_W
    out.append(f'<rect x="{x}" y="104" width="{LANE_W-16}" height="{H-176}" '
               f'rx="14" fill="{KIND[["user","app","server","data"][i]][0]}" opacity="0.28"/>')
    out.append(f'<text x="{x+16}" y="92" font-size="13" font-weight="700" '
               f'fill="{colour}" letter-spacing="1.4">{esc(name.upper())}</text>')

out.append('<text x="40" y="52" font-size="27" font-weight="700" fill="#0f172a">'
           'HerGuardian — project workflow</text>')
out.append('<text x="40" y="76" font-size="13.5" fill="#64748b">'
           'User actions, device logic, server endpoints and data. Numbers are '
           'the reading order of the pitch.</text>')

# arrows first so boxes paint over the line ends
for src, dst, sa, da in ARROWS:
    p = {"bottom": centre_bottom, "top": centre_top,
         "right": centre_right, "left": centre_left}
    x1, y1 = p[sa](src)
    x2, y2 = p[da](dst)
    if sa == "bottom" and da == "top":
        out.append(f'<path d="M{x1} {y1} L{x1} {y2-14} L{x2} {y2-14} L{x2} {y2}" '
                   f'fill="none" stroke="#64748b" stroke-width="1.6"/>')
        out.append(f'<path d="M{x2-5} {y2-11} L{x2} {y2} L{x2+5} {y2-11}" fill="#64748b"/>')
    elif da == "left":
        mid = (x1 + x2) / 2
        out.append(f'<path d="M{x1} {y1} L{mid} {y1} L{mid} {y2} L{x2-8} {y2}" '
                   f'fill="none" stroke="#64748b" stroke-width="1.6"/>')
        out.append(f'<path d="M{x2-8} {y2-5} L{x2} {y2} L{x2-8} {y2+5}" fill="#64748b"/>')
    elif da == "right":
        mid = (x1 + x2) / 2
        out.append(f'<path d="M{x1} {y1} L{mid} {y1} L{mid} {y2} L{x2+8} {y2}" '
                   f'fill="none" stroke="#64748b" stroke-width="1.6"/>')
        out.append(f'<path d="M{x2+8} {y2-5} L{x2} {y2} L{x2+8} {y2+5}" fill="#64748b"/>')
    else:
        out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2-6}" '
                   f'stroke="#64748b" stroke-width="1.6"/>')
        out.append(f'<path d="M{x2-5} {y2-12} L{x2} {y2} L{x2+5} {y2-12}" fill="#64748b"/>')

for n in NODES:
    out.append(box(n))

# offline band
out.append('<rect x="210" y="1470" width="1414" height="60" rx="10" '
           'fill="#fff7ed" stroke="#f97316" stroke-width="1.4"/>')
out.append('<text x="232" y="1493" font-size="13" font-weight="700" fill="#9a3412">'
           'OFFLINE AT ANY STEP</text>')
out.append('<text x="232" y="1513" font-size="12.5" fill="#7c2d12">'
           'Every write goes to an IndexedDB outbox first and replays on reconnect. '
           'tel: / sms and the cached risk grid keep working with no signal.</text>')

out.append('</svg>')

open("docs/workflow.svg", "w").write("\n".join(out))
print(f"wrote docs/workflow.svg  ({W}x{H}, {len(NODES)} steps, {len(ARROWS)} arrows)")