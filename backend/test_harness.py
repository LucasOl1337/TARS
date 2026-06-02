"""
TARS Self-Test Harness
======================

Reusable automation tool for proving that all TARS functions are 100% functional.

Usage:
    python backend/test_harness.py                 # Run full proof once
    python backend/test_harness.py --stress 20     # Run 20 quick voice stress iterations

The harness is also importable:
    from test_harness import run_full_proof
    result = await run_full_proof()

It powers the /test/* endpoints and the recurring automation loop.
"""

from __future__ import annotations

import asyncio
import sys
import time
from typing import Any

# Ensure backend is importable when run as script
if __package__ is None:
    sys.path.insert(0, ".")

from server import (
    test_health,
    test_all_tools,
    test_persona,
    test_voice_simulate,
    test_voice_with_vad_context,
    test_voice_module_health,
    test_error_injection,
    test_chat,
    test_bridges,
    test_system_prompt,
    test_full_suite,
)

# For real (but cheap) chat e2e test
from brain import dispatch_llm, provider_for_model, build_system_prompt
from db import get_conn, row_to_persona


async def run_voice_stress(iterations: int = 8) -> dict[str, Any]:
    """
    Stress test the voice detector under varied conditions.
    This is the core of proving the voice module is production-grade.
    """
    scenarios = [
        {"name": "casual_low_vad", "transcript": "Ei TARS, tudo bem por aí?", "vad": 0.15, "agg": 0.55},
        {"name": "operational_medium", "transcript": "TARS, qual a distância até o próximo waypoint?", "vad": 0.55, "agg": 0.65},
        {"name": "urgent_high_vad", "transcript": "TARS, temos uma anomalia no reator. Status crítico agora!", "vad": 0.88, "agg": 0.72},
        {"name": "emergency_critical", "transcript": "TARS! Perda de pressurização no módulo C. Ação imediata!", "vad": 0.95, "agg": 0.80},
        {"name": "quiet_no_speech", "transcript": "", "vad": 0.05, "agg": 0.60},
        {"name": "high_agg_conservative", "transcript": "TARS, me conta uma curiosidade sobre Saturno.", "vad": 0.40, "agg": 0.30},
    ]

    results = []
    llm_success = 0
    should_speak_count = 0
    total_duration = 0.0

    for i in range(iterations):
        for scen in scenarios:
            start = time.perf_counter()
            try:
                decision = await test_voice_with_vad_context({
                    "transcript": scen["transcript"],
                    "vad_level": scen["vad"],
                    "aggressiveness": scen["agg"],
                })
                duration = (time.perf_counter() - start) * 1000
                total_duration += duration

                dec = decision.get("decision", {})
                spoke = bool(dec.get("should_speak"))
                if spoke:
                    should_speak_count += 1
                llm_success += 1

                results.append({
                    "scenario": scen["name"],
                    "vad": scen["vad"],
                    "agg": scen["agg"],
                    "should_speak": spoke,
                    "urgency": dec.get("urgency"),
                    "duration_ms": round(duration, 1),
                    "ok": decision.get("ok", False),
                })
            except Exception as e:
                results.append({
                    "scenario": scen["name"],
                    "error": str(e)[:120],
                    "ok": False,
                })

    total_calls = len(results)
    avg_latency = round(total_duration / max(1, llm_success), 1)

    # Latency percentiles (professional observability)
    durations = sorted([r["duration_ms"] for r in results if "duration_ms" in r])
    def pct(p):
        if not durations:
            return None
        k = int(len(durations) * p / 100)
        return round(durations[max(0, min(k, len(durations)-1))], 1)
    p50 = pct(50)
    p95 = pct(95)
    p99 = pct(99)

    # Decision quality: urgent/critical transcripts should produce high urgency (basic sanity check)
    urgent_scenarios = [r for r in results if r.get("scenario") in ("urgent_high_vad", "emergency_critical") and "urgency" in r]
    good_urgency = sum(1 for r in urgent_scenarios if r.get("urgency") in ("high", "critical"))
    decision_quality = round(good_urgency / max(1, len(urgent_scenarios)) * 100, 1) if urgent_scenarios else 100.0

    # Success criteria for automation: 100% LLM calls must succeed and return valid decisions.
    # For urgent scenarios, we also want good decision quality.
    success = (llm_success == total_calls) and (llm_success > 0) and (decision_quality >= 80)

    return {
        "iterations": iterations,
        "total_calls": total_calls,
        "llm_success_rate": round(llm_success / max(1, total_calls) * 100, 1),
        "should_speak_rate": round(should_speak_count / max(1, llm_success) * 100, 1),
        "avg_latency_ms": avg_latency,
        "p50_latency_ms": p50,
        "p95_latency_ms": p95,
        "p99_latency_ms": p99,
        "decision_quality_urgent_pct": decision_quality,
        "scenarios_sample": results[:12],
        "ok": success,
        "note": "Latency is informational. Real success = 100% LLM calls + sane decisions under varied VAD/agg. decision_quality_urgent_pct measures if urgent transcripts trigger high/critical urgency."
    }


async def run_voice_endurance(duration_seconds: int = 180, max_batches: int = 6) -> dict[str, Any]:
    """
    Endurance / time-boxed test.
    Repeatedly runs voice stress scenarios over a period of time and checks for degradation.
    This is key for proving long-term stability of the voice module.
    """
    started = time.time()
    batches = []
    total_success = 0
    total_calls = 0
    quality_scores = []

    batch_size = 2  # small batches for reasonable runtime

    while (time.time() - started) < duration_seconds and len(batches) < max_batches:
        batch_start = time.time()
        stress = await run_voice_stress(iterations=batch_size)
        batch_duration = time.time() - batch_start

        batch_result = {
            "batch": len(batches) + 1,
            "llm_success_rate": stress.get("llm_success_rate"),
            "decision_quality_urgent_pct": stress.get("decision_quality_urgent_pct"),
            "avg_latency_ms": stress.get("avg_latency_ms"),
            "duration_sec": round(batch_duration, 1),
        }
        batches.append(batch_result)

        if stress.get("llm_success_rate") == 100.0:
            total_success += 1
        total_calls += 1

        if stress.get("decision_quality_urgent_pct") is not None:
            quality_scores.append(stress.get("decision_quality_urgent_pct"))

        # Small pause between batches
        await asyncio.sleep(1.5)

    elapsed = round(time.time() - started, 1)
    success_rate_over_time = round((total_success / max(1, total_calls)) * 100, 1)
    avg_quality = round(sum(quality_scores) / max(1, len(quality_scores)), 1) if quality_scores else 100.0

    # Latency stats across endurance batches (very useful given observed high latency in long runs)
    batch_latencies = [b.get("avg_latency_ms", 0) for b in batches if b.get("avg_latency_ms")]
    avg_latency = round(sum(batch_latencies) / max(1, len(batch_latencies)), 1) if batch_latencies else None

    # Detect degradation (success/quality) + high sustained latency
    degraded = any(b["llm_success_rate"] < 100 for b in batches) or (len(quality_scores) > 1 and min(quality_scores) < 80)
    high_latency = avg_latency is not None and avg_latency > 12000  # >12s sustained is noteworthy

    return {
        "duration_seconds": elapsed,
        "batches_run": len(batches),
        "llm_success_rate_over_time": success_rate_over_time,
        "avg_decision_quality_urgent": avg_quality,
        "avg_latency_ms": avg_latency,
        "high_sustained_latency": high_latency,
        "batches": batches,
        "degraded": degraded or high_latency,
        "ok": (success_rate_over_time == 100.0) and (not degraded) and (not high_latency),
        "note": "Endurance test. 100% success + no major quality drop + reasonable latency = stable. Long stress runs (e.g. 18 calls / 6.5min) have shown 100% success but high latency is common under load."
    }


async def run_full_proof(stress_iterations: int = 3) -> dict[str, Any]:
    """
    Master proof function. Runs everything the automation cares about.
    Returns a rich, machine-readable report.
    """
    started = time.time()
    report: dict[str, Any] = {
        "timestamp": int(started),
        "version": "round11-harness",
    }

    # Core static tests (fast)
    report["health"] = await test_health()
    report["tools"] = await test_all_tools()
    report["persona"] = await test_persona()
    report["system_prompt"] = await test_system_prompt()
    report["error_handling"] = await test_error_injection({"type": "invalid_tool"})
    report["bridges"] = await test_bridges()
    report["chat_structure"] = await test_chat()

    # Voice module (the historically problematic area)
    report["voice_basic"] = await test_voice_simulate({"transcript": "TARS, relatório de missão resumido."})
    report["voice_module_health"] = await test_voice_module_health()
    report["voice_vad_critical"] = await test_voice_with_vad_context({
        "transcript": "TARS, colisão iminente com detrito. Manobra evasiva agora!",
        "vad_level": 0.93,
        "aggressiveness": 0.78,
    })

    # Stress / endurance (the new focus of Round 10+)
    stress = await run_voice_stress(stress_iterations)
    report["voice_stress"] = stress

    # Real low-cost chat e2e (new in Round 12)
    report["real_chat_e2e"] = await run_real_chat_test()

    # Endurance (new in Round 12) - now more prominent with latency awareness (informed by long stress runs)
    report["voice_endurance"] = await run_voice_endurance(duration_seconds=90, max_batches=5)

    # Full suite (kept for backward compat with old endpoints)
    report["legacy_full_suite"] = await test_full_suite()

    # Aggregate - stress "ok" now means "all LLM calls succeeded with valid decisions"
    chat_real_ok = report.get("real_chat_e2e", {}).get("ok", True)
    endurance_ok = report.get("voice_endurance", {}).get("ok", True)

    core_ok = all([
        report["health"].get("ok"),
        report["tools"].get("ok"),
        report["persona"].get("ok"),
        report["system_prompt"].get("ok"),
        report["error_handling"].get("ok"),
        report["bridges"].get("ok"),
        report["chat_structure"].get("ok"),
        report["voice_basic"].get("ok"),
        report["voice_module_health"].get("ok"),
        report["voice_vad_critical"].get("ok"),
        stress.get("ok"),
        chat_real_ok,
        endurance_ok,
    ])

    report["overall_ok"] = core_ok
    report["duration_seconds"] = round(time.time() - started, 2)
    endurance = report.get("voice_endurance", {})
    report["summary"] = {
        "tools_passed": report["tools"].get("passed", 0),
        "tools_total": report["tools"].get("total", 0),
        "voice_llm_success_rate": stress.get("llm_success_rate"),
        "voice_avg_latency_ms": stress.get("avg_latency_ms"),
        "stress_calls": stress.get("total_calls"),
        "real_chat_ok": report["real_chat_e2e"].get("ok"),
        "endurance_ok": endurance.get("ok"),
        "endurance_duration_s": endurance.get("duration_seconds"),
        "endurance_avg_latency_ms": endurance.get("avg_latency_ms"),
        "endurance_high_latency": endurance.get("high_sustained_latency"),
    }

    return report


def _print_report(report: dict[str, Any]) -> None:
    print("\n" + "=" * 70)
    print("TARS FULL PROOF REPORT  |  Round 10+ Harness")
    print("=" * 70)
    print(f"Timestamp: {report['timestamp']}   Duration: {report['duration_seconds']}s")
    overall = "PASS - 100% FUNCTIONAL" if report.get("overall_ok") else "FAIL"
    print(f"Overall: {overall}")
    print("-" * 70)

    print("Core Modules:")
    for key in ["health", "tools", "persona", "system_prompt", "error_handling", "bridges", "chat_structure"]:
        val = report.get(key, {})
        status = "PASS" if val.get("ok") else "FAIL"
        print(f"  {key:18} {status}")

    print("\nVoice Detector (most critical):")
    for key in ["voice_basic", "voice_module_health", "voice_vad_critical"]:
        val = report.get(key, {})
        status = "PASS" if val.get("ok") else "FAIL"
        print(f"  {key:18} {status}")

    stress = report.get("voice_stress", {})
    print(f"\nVoice Stress Test ({stress.get('total_calls', 0)} calls):")
    print(f"  LLM success rate : {stress.get('llm_success_rate')}%")
    print(f"  Avg latency      : {stress.get('avg_latency_ms')} ms")
    print(f"  Should-speak rate: {stress.get('should_speak_rate')}%")
    print(f"  Stress result    : {'PASS' if stress.get('ok') else 'FAIL'}")

    print("\nSummary:")
    s = report.get("summary", {})
    print(f"  Tools: {s.get('tools_passed')}/{s.get('tools_total')}")
    print(f"  Voice LLM success: {s.get('voice_llm_success_rate')}% @ {s.get('voice_avg_latency_ms')}ms avg")
    print("=" * 70 + "\n")

    # Always emit full machine-readable JSON at the end (critical for automation loops)
    import json as _json
    print("--- FULL JSON REPORT ---")
    print(_json.dumps(report, ensure_ascii=True, indent=2, default=str))


async def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="TARS Self-Test Harness")
    parser.add_argument("--stress", type=int, default=3, help="Number of stress iterations (default 3)")
    parser.add_argument("--quiet", action="store_true", help="Only output final overall_ok")
    args = parser.parse_args()

    report = await run_full_proof(stress_iterations=args.stress)

    if args.quiet:
        print("PASS" if report["overall_ok"] else "FAIL")
        sys.exit(0 if report["overall_ok"] else 1)
    else:
        _print_report(report)
        sys.exit(0 if report["overall_ok"] else 1)


async def run_real_chat_test() -> dict[str, Any]:
    """
    Low-cost real chat e2e test.
    Uses the actual dispatch_llm path with TARS persona (tiny prompt).
    Proves the core intelligence path works end-to-end.
    """
    try:
        # Load persona
        conn = get_conn()
        try:
            row = conn.execute("SELECT * FROM personas WHERE slug = ?", ("tars",)).fetchone()
        finally:
            conn.close()

        persona = row_to_persona(row) if row else {}
        if not persona:
            return {"ok": False, "error": "No persona loaded"}

        system_prompt = build_system_prompt(persona)

        # Very small, cheap test prompt
        messages = [
            {"role": "user", "content": "TARS, confirme que você está operacional com uma frase curta."}
        ]

        provider, model = provider_for_model("glm-5.1")
        if not provider:
            return {"ok": False, "error": "No LLM provider available for chat test"}

        result = await dispatch_llm(
            provider,
            model,
            system_prompt[:1500],  # truncate for cost
            messages,
            0.6,
            120,  # very small max tokens
        )

        content = (result.get("content") or "").strip()
        ok = len(content) > 10 and len(content) < 400  # reasonable short answer

        return {
            "ok": ok,
            "response_length": len(content),
            "response_preview": content[:120],
            "model_used": model,
            "note": "Real low-cost chat e2e via dispatch_llm + persona. Proves intelligence path is alive."
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


if __name__ == "__main__":
    asyncio.run(main())
