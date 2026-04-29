"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const IDLE_LIMIT_MS = 30 * 60 * 1000;
const WARNING_MS = 5 * 60 * 1000;
const WARNING_START_MS = IDLE_LIMIT_MS - WARNING_MS;

function formatRemaining(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function InactivityGuard() {
  const pathname = usePathname();
  const router = useRouter();

  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);
  const warningTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const signingOutRef = React.useRef(false);

  const [warningOpen, setWarningOpen] = React.useState(false);
  const [remainingSeconds, setRemainingSeconds] = React.useState(WARNING_MS / 1000);

  const clearTimers = React.useCallback(() => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    warningTimerRef.current = null;
    logoutTimerRef.current = null;
    countdownRef.current = null;
  }, []);

  const performSignOut = React.useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    clearTimers();

    try {
      await supabase.auth.signOut();
      await fetch("/api/auth/signout", { method: "POST" });
    } catch {
      // ignore and continue redirecting to login
    } finally {
      setWarningOpen(false);
      router.replace(`/login?redirectTo=${encodeURIComponent(pathname || "/home")}`);
      router.refresh();
      signingOutRef.current = false;
    }
  }, [clearTimers, pathname, router, supabase]);

  const startCountdown = React.useCallback(() => {
    setRemainingSeconds(WARNING_MS / 1000);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
  }, []);

  const scheduleTimers = React.useCallback(() => {
    clearTimers();

    warningTimerRef.current = setTimeout(() => {
      setWarningOpen(true);
      startCountdown();
    }, WARNING_START_MS);

    logoutTimerRef.current = setTimeout(() => {
      void performSignOut();
    }, IDLE_LIMIT_MS);
  }, [clearTimers, performSignOut, startCountdown]);

  const resetIdleTimer = React.useCallback(() => {
    if (pathname === "/login" || signingOutRef.current || warningOpen) return;
    scheduleTimers();
  }, [pathname, scheduleTimers, warningOpen]);

  const continueSession = React.useCallback(() => {
    setWarningOpen(false);
    setRemainingSeconds(WARNING_MS / 1000);
    scheduleTimers();
  }, [scheduleTimers]);

  React.useEffect(() => {
    if (pathname === "/login") {
      clearTimers();
      setWarningOpen(false);
      return;
    }

    let active = true;
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!active || !session) return;
      scheduleTimers();
    };

    void init();

    const events: Array<keyof WindowEventMap> = [
      "mousedown",
      "mousemove",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];

    events.forEach((eventName) =>
      window.addEventListener(eventName, resetIdleTimer, { passive: true })
    );

    return () => {
      active = false;
      events.forEach((eventName) =>
        window.removeEventListener(eventName, resetIdleTimer)
      );
      clearTimers();
    };
  }, [clearTimers, pathname, resetIdleTimer, scheduleTimers, supabase]);

  if (pathname === "/login") return null;

  return (
    <Dialog open={warningOpen}>
      <DialogContent className="[&>button]:hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Session Timeout Warning</DialogTitle>
          <DialogDescription>
            There has been no activity for 25 minutes.
            You will be signed out automatically in {formatRemaining(remainingSeconds)}.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={() => void performSignOut()}>
            Sign out now
          </Button>
          <Button onClick={continueSession}>Continue session</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
