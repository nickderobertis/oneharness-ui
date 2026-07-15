import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" {...props}>
      {children}
    </svg>
  );
}

export function ArrowIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="m5 12 14 0m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </Icon>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M19 8a7.5 7.5 0 1 0 .2 7.5M19 4v4h-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </Icon>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="m5 7 4 5-4 5m7 0h7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </Icon>
  );
}
