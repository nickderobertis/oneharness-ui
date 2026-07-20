import Image from "next/image";

export function Brandmark() {
  return (
    <div aria-label="oneharness" className="flex items-center gap-2.5">
      <Image
        alt=""
        aria-hidden="true"
        className="h-8 w-auto shrink-0 dark:hidden"
        height="256"
        src="/brand/oneharness-mark-light.png"
        width="496"
      />
      <Image
        alt=""
        aria-hidden="true"
        className="hidden h-8 w-auto shrink-0 dark:block"
        height="256"
        src="/brand/oneharness-mark-dark.png"
        width="496"
      />
      <span className="text-[15px] font-semibold tracking-[-.025em] text-foreground">
        oneharness
      </span>
    </div>
  );
}
