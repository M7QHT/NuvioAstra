"""Compares the original Nuvio and NextGen from the same sampler output.

Each app directory holds samples.csv / per-process.csv from bench/sample-run.ps1 (whole process
tree) and a phases file (phases.json from guided-original.ps1 or report.json from
`nuvio-desktop --bench-addon`). Every metric uses private bytes of the whole tree; working set is
reported separately and never mixed.

Usage: python -I analyze-compare.py <original_dir> <nextgen_dir> [out.md]
"""
import csv
import json
import statistics
import sys
from pathlib import Path


def num(value):
    return float(str(value).replace(",", "."))


def load(dir_path):
    d = Path(dir_path)
    phases_file = d / "phases.json" if (d / "phases.json").exists() else d / "report.json"
    meta = json.loads(phases_file.read_text(encoding="utf-8-sig"))
    rows = [
        {k: (int(v) if k in ("epoch_ms", "processes") else num(v)) for k, v in r.items()}
        for r in csv.DictReader(open(d / "samples.csv", encoding="utf-8-sig"))
    ]
    return meta, rows


def in_phase(rows, phase):
    return [r for r in rows if phase["startMs"] <= r["epoch_ms"] <= phase["endMs"]]


def summarize(meta, rows):
    phases = meta["phases"]
    out = {}
    def group(prefix):
        sel = [p for p in phases if p["name"].startswith(prefix)]
        per_cycle = [in_phase(rows, p) for p in sel]
        return [x for x in per_cycle if x]
    idle = group("idle")
    play = group("playback")
    after = group("after-close")
    def median_of(groups, key):
        vals = [statistics.median(r[key] for r in g) for g in groups]
        return vals
    out["idle_private"] = median_of(idle, "private_mb")
    out["idle_ws"] = median_of(idle, "working_set_mb")
    out["idle_cpu"] = [statistics.mean(r["cpu_pct_all_cores"] for r in g) for g in idle]
    out["play_private"] = median_of(play, "private_mb")
    out["play_ws"] = median_of(play, "working_set_mb")
    out["play_peak_private"] = [max(r["private_mb"] for r in g) for g in play]
    out["play_cpu"] = [statistics.mean(r["cpu_pct_all_cores"] for r in g) for g in play]
    out["play_gpu3d"] = [statistics.mean(r["gpu_3d_pct"] for r in g) for g in play]
    out["play_gpudec"] = [statistics.mean(r["gpu_decode_pct"] for r in g) for g in play]
    out["play_gpumem"] = median_of(play, "gpu_dedicated_mb")
    out["after_private"] = median_of(after, "private_mb")
    out["after_ws"] = median_of(after, "working_set_mb")
    out["samples"] = {"idle": [len(g) for g in idle], "play": [len(g) for g in play], "after": [len(g) for g in after]}
    out["ttff"] = [c.get("ttffMs") for c in meta.get("cycles", [])]
    out["dropped"] = [(c.get("droppedFrames"), c.get("decoderDroppedFrames")) for c in meta.get("cycles", []) if "droppedFrames" in c]
    out["whole_run_peak_private"] = max(r["private_mb"] for r in rows) if rows else None
    return out


def med(values):
    vals = [v for v in values if v is not None]
    return statistics.median(vals) if vals else None


def fmt(v, unit="", digits=0):
    if v is None:
        return "n/a"
    return f"{v:,.{digits}f}{unit}".replace(",", " ")


def diff(o, n, lower_is_better=True):
    if o is None or n is None or o == 0:
        return "n/a"
    pct = (n - o) / o * 100
    return f"{n - o:+.0f} ({pct:+.0f} %)"


def main():
    orig_meta, orig_rows = load(sys.argv[1])
    next_meta, next_rows = load(sys.argv[2])
    o, n = summarize(orig_meta, orig_rows), summarize(next_meta, next_rows)
    lines = [
        "| Métrica (árvore completa de processos) | Nuvio original | Nuvio NextGen | Diferença |",
        "|---|---|---|---|",
    ]
    def row(label, key, unit=" MB", digits=0, extra=None):
        ov, nv = med(o[key]), med(n[key])
        d = diff(ov, nv)
        if unit.strip() != "MB":
            d = f"{(nv - ov):+.{max(digits,1)}f}{unit}" if ov is not None and nv is not None else "n/a"
        lines.append(f"| {label} | {fmt(ov, unit, digits)} | {fmt(nv, unit, digits)} | {d} |")
    row("RAM em repouso (privada, mediana)", "idle_private")
    row("RAM durante reprodução (privada, mediana)", "play_private")
    row("Pico de RAM na reprodução (privada)", "play_peak_private")
    row("RAM após encerrar reprodução (privada, mediana)", "after_private")
    row("CPU em repouso (média, % de todos os núcleos)", "idle_cpu", " %", 2)
    row("CPU durante reprodução (média)", "play_cpu", " %", 2)
    row("GPU 3D durante reprodução (média)", "play_gpu3d", " %", 1)
    row("GPU Video Decode durante reprodução (média)", "play_gpudec", " %", 1)
    row("Memória dedicada de GPU na reprodução (mediana)", "play_gpumem", " MB", 0)
    ot, nt = med(o["ttff"]), med(n["ttff"])
    lines.append(f"| Tempo até o primeiro quadro (mediana) | {fmt(ot, ' ms')} (manual ±0,5 s) | {fmt(nt, ' ms')} (mpv) | {fmt(nt - ot if ot and nt else None, ' ms') if ot and nt else 'n/a'} |")
    lines.append("")
    lines.append("Working set (separado, não misturar com memória privada):")
    lines.append("")
    lines.append("| Working set | Nuvio original | Nuvio NextGen |")
    lines.append("|---|---|---|")
    for label, key in (("Repouso", "idle_ws"), ("Reprodução", "play_ws"), ("Após encerrar", "after_ws")):
        lines.append(f"| {label} | {fmt(med(o[key]), ' MB')} | {fmt(med(n[key]), ' MB')} |")
    lines.append("")
    lines.append("Por ciclo (privada, MB):")
    lines.append("")
    lines.append("| App | Repouso | Reprodução c1/c2/c3 | Após encerrar c1/c2/c3 | TTFF c1/c2/c3 (ms) |")
    lines.append("|---|---|---|---|---|")
    for name, s in (("Original", o), ("NextGen", n)):
        lines.append(
            f"| {name} | {' / '.join(fmt(v) for v in s['idle_private'])} | {' / '.join(fmt(v) for v in s['play_private'])} | "
            f"{' / '.join(fmt(v) for v in s['after_private'])} | {' / '.join(fmt(v) for v in s['ttff'])} |"
        )
    lines.append("")
    lines.append(f"Amostras por fase — original: {o['samples']}, NextGen: {n['samples']}.")
    if n["dropped"]:
        lines.append(f"Quadros perdidos NextGen (saída/decodificador) por ciclo: {n['dropped']}. Original: não exposto pelo player.")
    text = "\n".join(lines)
    print(text)
    if len(sys.argv) > 3:
        Path(sys.argv[3]).write_text(text + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
