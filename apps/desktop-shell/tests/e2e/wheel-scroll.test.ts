import { describe, expect, test } from "bun:test";
import { type ScrollSnapshot, wheelUntilNextPage } from "./wheel-scroll.ts";

function snapshot(scrollTop: number, scrollHeight = 1_000, clientHeight = 500): ScrollSnapshot {
  return { clientHeight, scrollHeight, scrollTop };
}

describe("native wheel pagination", () => {
  test("retries an ignored wheel and waits for the accepted gesture's delayed page append", async () => {
    let current = snapshot(0);
    let wheelInputs = 0;
    let acceptedWheelPauses = 0;

    const result = await wheelUntilNextPage({
      maxWheelInputs: 4,
      pageAppendTimeout: 4,
      pageStart: current,
      pause: async () => {
        if (wheelInputs !== 2) return;
        acceptedWheelPauses += 1;
        if (acceptedWheelPauses === 2) current = snapshot(500, 1_500);
      },
      pollInterval: 1,
      progressTimeout: 2,
      readSnapshot: async () => current,
      wheel: async () => {
        wheelInputs += 1;
        if (wheelInputs === 2) current = snapshot(500);
      },
    });

    expect(result).toEqual({
      ignoredWheelInputs: 1,
      snapshot: snapshot(500, 1_500),
      wheelInputs: 2,
    });
  });

  test("accepts a page append during a wheel even when scroll anchoring preserves scrollTop", async () => {
    let current = snapshot(500);

    const result = await wheelUntilNextPage({
      maxWheelInputs: 2,
      pageAppendTimeout: 2,
      pageStart: current,
      pause: async () => {},
      pollInterval: 1,
      progressTimeout: 1,
      readSnapshot: async () => current,
      wheel: async () => {
        current = snapshot(500, 1_500);
      },
    });

    expect(result).toEqual({
      ignoredWheelInputs: 0,
      snapshot: snapshot(500, 1_500),
      wheelInputs: 1,
    });
  });

  test("bounds ignored wheels and reports the observed geometry", async () => {
    const unchanged = snapshot(125, 1_250, 500);
    let pauses = 0;
    let wheelInputs = 0;

    await expect(
      wheelUntilNextPage({
        maxWheelInputs: 3,
        pageAppendTimeout: 2,
        pageStart: unchanged,
        pause: async () => {
          pauses += 1;
        },
        pollInterval: 1,
        progressTimeout: 2,
        readSnapshot: async () => unchanged,
        wheel: async () => {
          wheelInputs += 1;
        },
      }),
    ).rejects.toThrow(
      "wheel input did not reach the page boundary after 3 attempts (3 ignored; page start: top=125, height=1250, client=500; last: top=125, height=1250, client=500)",
    );
    expect(wheelInputs).toBe(3);
    expect(pauses).toBe(6);
  });

  test("fails with geometry diagnostics when reaching the end does not append a page", async () => {
    let current = snapshot(499);
    let pauses = 0;

    await expect(
      wheelUntilNextPage({
        maxWheelInputs: 3,
        pageAppendTimeout: 2,
        pageStart: current,
        pause: async () => {
          pauses += 1;
        },
        pollInterval: 1,
        progressTimeout: 2,
        readSnapshot: async () => current,
        wheel: async () => {
          current = snapshot(500);
        },
      }),
    ).rejects.toThrow(
      "automatic pagination did not append a page after wheel scrolling to the end (1 attempt, 0 ignored; page start: top=499, height=1000, client=500; last: top=500, height=1000, client=500)",
    );
    expect(pauses).toBe(2);
  });
});
