import * as React from "react";
export function ScrollArea({
  className = "",
  children,
}: React.PropsWithChildren<{ className?: string }>) {
  return <div className={`overflow-auto ${className}`}>{children}</div>;
}
