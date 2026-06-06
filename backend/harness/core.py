from __future__ import annotations

import inspect
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


Runner = Callable[["HarnessContext"], dict[str, Any] | Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class HarnessContext:
    live_ai: bool = False
    model: str | None = None
    max_tokens: int = 80
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class HarnessComponent:
    id: str
    label: str
    description: str
    runner: Runner
    tags: tuple[str, ...] = ()
    live_ai: bool = False


class HarnessRegistry:
    def __init__(self, components: list[HarnessComponent] | None = None) -> None:
        self._components: dict[str, HarnessComponent] = {}
        for component in components or []:
            self.register(component)

    def register(self, component: HarnessComponent) -> None:
        if component.id in self._components:
            raise ValueError(f"harness component already registered: {component.id}")
        self._components[component.id] = component

    def list(self) -> list[dict[str, Any]]:
        return [
            {
                "id": component.id,
                "label": component.label,
                "description": component.description,
                "tags": list(component.tags),
                "live_ai": component.live_ai,
            }
            for component in self._components.values()
        ]

    def get(self, component_id: str) -> HarnessComponent | None:
        return self._components.get(component_id)

    async def run_one(self, component_id: str, ctx: HarnessContext | None = None) -> dict[str, Any]:
        ctx = ctx or HarnessContext()
        component = self.get(component_id)
        if not component:
            return {
                "id": component_id,
                "ok": False,
                "status": "missing",
                "error": f"component '{component_id}' not registered",
            }

        if component.live_ai and not ctx.live_ai:
            return {
                "id": component.id,
                "label": component.label,
                "ok": True,
                "status": "skipped",
                "elapsed_ms": 0,
                "reason": "live_ai disabled",
            }

        started = time.perf_counter()
        try:
            value = component.runner(ctx)
            result = await value if inspect.isawaitable(value) else value
            elapsed = int((time.perf_counter() - started) * 1000)
            return {
                "id": component.id,
                "label": component.label,
                "ok": bool(result.get("ok", False)),
                "status": result.get("status") or ("passed" if result.get("ok") else "failed"),
                "elapsed_ms": elapsed,
                **result,
            }
        except Exception as exc:  # noqa: BLE001
            elapsed = int((time.perf_counter() - started) * 1000)
            return {
                "id": component.id,
                "label": component.label,
                "ok": False,
                "status": "exception",
                "elapsed_ms": elapsed,
                "error": str(exc),
            }

    async def run_many(
        self,
        component_ids: list[str] | None = None,
        ctx: HarnessContext | None = None,
    ) -> dict[str, Any]:
        ids = component_ids or list(self._components.keys())
        started = time.perf_counter()
        results = [await self.run_one(component_id, ctx) for component_id in ids]
        elapsed = int((time.perf_counter() - started) * 1000)
        failed = [item for item in results if not item.get("ok")]
        return {
            "ok": not failed,
            "elapsed_ms": elapsed,
            "count": len(results),
            "passed": sum(1 for item in results if item.get("ok")),
            "failed": len(failed),
            "results": results,
        }
