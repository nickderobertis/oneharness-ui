import type { ComponentProps, ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/components/utils";

type MessageProps = ComponentProps<"div"> & {
  from: "assistant" | "user";
};

export function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      className={cn(
        from === "user"
          ? "flex justify-end"
          : "grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3.5",
        className,
      )}
      data-message-author={from}
      {...props}
    />
  );
}

export function MessageContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-w-0", className)} {...props} />;
}

export function MessageAvatar({ children, src }: { children: ReactNode; src?: string }) {
  return (
    <Avatar aria-hidden="true" className="size-8 rounded-[9px]">
      {src ? <AvatarImage alt="" src={src} /> : null}
      <AvatarFallback className="bg-primary text-[9px] font-extrabold text-primary-foreground">
        {children}
      </AvatarFallback>
    </Avatar>
  );
}
