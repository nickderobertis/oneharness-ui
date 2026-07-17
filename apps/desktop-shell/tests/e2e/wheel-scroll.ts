export type ScrollSnapshot = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

type WheelUntilNextPageOptions = {
  maxWheelInputs: number;
  pageAppendTimeout: number;
  pageStart: ScrollSnapshot;
  pause: (milliseconds: number) => Promise<void>;
  pollInterval: number;
  progressTimeout: number;
  readSnapshot: () => Promise<ScrollSnapshot>;
  wheel: () => Promise<void>;
};

type WheelPageResult = {
  ignoredWheelInputs: number;
  snapshot: ScrollSnapshot;
  wheelInputs: number;
};

const scrollEndTolerance = 1;

function describes(snapshot: ScrollSnapshot): string {
  return `top=${snapshot.scrollTop}, height=${snapshot.scrollHeight}, client=${snapshot.clientHeight}`;
}

function isAtScrollEnd(snapshot: ScrollSnapshot): boolean {
  return snapshot.scrollTop >= snapshot.scrollHeight - snapshot.clientHeight - scrollEndTolerance;
}

async function observeUntil(
  readSnapshot: () => Promise<ScrollSnapshot>,
  pause: (milliseconds: number) => Promise<void>,
  pollInterval: number,
  timeout: number,
  matches: (snapshot: ScrollSnapshot) => boolean,
): Promise<{ matched: boolean; snapshot: ScrollSnapshot }> {
  let elapsed = 0;
  let current = await readSnapshot();
  while (!matches(current) && elapsed < timeout) {
    const delay = Math.min(pollInterval, timeout - elapsed);
    await pause(delay);
    elapsed += delay;
    current = await readSnapshot();
  }
  return { matched: matches(current), snapshot: current };
}

export async function wheelUntilNextPage({
  maxWheelInputs,
  pageAppendTimeout,
  pageStart,
  pause,
  pollInterval,
  progressTimeout,
  readSnapshot,
  wheel,
}: WheelUntilNextPageOptions): Promise<WheelPageResult> {
  let ignoredWheelInputs = 0;
  let last = pageStart;

  for (let wheelInputs = 1; wheelInputs <= maxWheelInputs; wheelInputs += 1) {
    const before = await readSnapshot();
    await wheel();
    const progress = await observeUntil(
      readSnapshot,
      pause,
      pollInterval,
      progressTimeout,
      (current) =>
        current.scrollHeight > pageStart.scrollHeight || current.scrollTop > before.scrollTop,
    );
    last = progress.snapshot;
    if (!progress.matched) {
      ignoredWheelInputs += 1;
      continue;
    }

    if (last.scrollHeight > pageStart.scrollHeight) {
      return { ignoredWheelInputs, snapshot: last, wheelInputs };
    }
    if (!isAtScrollEnd(last)) continue;

    const append = await observeUntil(
      readSnapshot,
      pause,
      pollInterval,
      pageAppendTimeout,
      (current) => current.scrollHeight > pageStart.scrollHeight,
    );
    if (append.matched) {
      return { ignoredWheelInputs, snapshot: append.snapshot, wheelInputs };
    }
    throw new Error(
      `automatic pagination did not append a page after wheel scrolling to the end (${wheelInputs} ${wheelInputs === 1 ? "attempt" : "attempts"}, ${ignoredWheelInputs} ignored; page start: ${describes(pageStart)}; last: ${describes(append.snapshot)})`,
    );
  }

  throw new Error(
    `wheel input did not reach the page boundary after ${maxWheelInputs} attempts (${ignoredWheelInputs} ignored; page start: ${describes(pageStart)}; last: ${describes(last)})`,
  );
}
