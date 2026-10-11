"use client";
import { usePathname } from "next/navigation";
import { Provider } from "./provider";
import { Shell } from "./shell";
export function AppFrame({ children }: { children: React.ReactNode }) {
  return usePathname() === "/login" ? (
    <>{children}</>
  ) : (
    <Provider>
      <Shell>{children}</Shell>
    </Provider>
  );
}
