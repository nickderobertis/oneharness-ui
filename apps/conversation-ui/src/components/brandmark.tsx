export function Brandmark() {
  return (
    <div aria-label="oneharness" className="flex items-center gap-2.5">
      <svg
        aria-hidden="true"
        className="h-8 w-8 shrink-0"
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path className="fill-spectrum-red" d="M2 6.5 17.5 13v2L2 10.5z" />
        <path className="fill-spectrum-orange" d="M2 10.5 17.5 15v2L2 14.5z" />
        <path className="fill-spectrum-yellow" d="M2 14.5 17.5 17v2L2 18.5z" />
        <path className="fill-spectrum-green" d="M2 18.5 17.5 19v2L2 22.5z" />
        <path className="fill-spectrum-blue" d="M2 22.5 17.5 21v2L2 26.5z" />
        <path className="fill-spectrum-indigo" d="M2 26.5 17.5 23v2L5 29z" />
        <path className="fill-spectrum-violet" d="m8 29 9.5-4v2z" />
        <path className="fill-brand" d="M17 9.5 23 6h5v22h-7V13l-4 2.2z" />
      </svg>
      <span className="text-[15px] font-semibold tracking-[-.025em] text-foreground">
        oneharness
      </span>
    </div>
  );
}
