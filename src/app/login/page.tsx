"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

/**
 * Login Page
 * - Email + password
 * - After login → default /home (or redirectTo if present)
 */
export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();

  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // 공통 리다이렉트 로직
  const redirectAfterLogin = React.useCallback(() => {
    const redirectTo = params.get("redirectTo");

    if (redirectTo) {
      // 특정 페이지에서 로그인으로 튕겨온 경우에는 원래 페이지로 되돌려 보냄
      router.replace(redirectTo);
      return;
    }

    // 기본 파킹 위치 = /home
    router.replace("/home");
  }, [router, params]);

  // 이미 로그인 되어 있으면 바로 /home 으로 보냄
  React.useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        redirectAfterLogin();
      }
    };

    checkSession();
  }, [supabase, redirectAfterLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        if (
          error.message.toLowerCase().includes("email not confirmed") ||
          error.message.toLowerCase().includes("confirm your email")
        ) {
          setErrorMsg(
            "Email is not confirmed. Please check with the admin or your inbox."
          );
        } else {
          setErrorMsg(error.message || "Login failed.");
        }
        return;
      }

      if (!data.session) {
        setErrorMsg("No active session. Please try again.");
        return;
      }

      redirectAfterLogin();
    } catch (err) {
      console.error(err);
      setErrorMsg("Unknown error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-4xl bg-white shadow-xl rounded-2xl overflow-hidden flex flex-col md:flex-row">
        {/* Left: logo & slogan */}
        <div className="md:w-1/2 bg-slate-900 text-white flex flex-col items-center justify-center p-10">
          <div className="mb-6">
            <Image
              src="/images/jm_logo.png" // 또는 /images/jm_logo.png
              alt="JM International"
              width={180}
              height={180}
              priority
            />
          </div>
          <div className="text-center space-y-2">
            <p className="text-xl font-semibold tracking-wide">
              JM International ERP
            </p>
            <p className="text-sm text-slate-300 italic">
              Excellence in Every Detail
            </p>
          </div>
        </div>

        {/* Right: login form */}
        <div className="md:w-1/2 p-8 md:p-10 flex items-center justify-center">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-md space-y-6"
            autoComplete="off"
          >
            <div>
              <h1 className="text-2xl font-semibold mb-1">Sign in</h1>
              <p className="text-sm text-slate-500">
                Enter your email and password to access the ERP.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email (ID)</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="off"
              />
            </div>

            {errorMsg && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                {errorMsg}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>

            <p className="text-xs text-slate-400">
              ERP accounts are created by the admin.  
              If you cannot sign in, please contact the administrator.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
