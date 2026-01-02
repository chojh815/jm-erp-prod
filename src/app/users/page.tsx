"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import AppShell from "@/components/layout/AppShell";
import type { AppRole } from "@/config/menuConfig";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type RoleOption = "viewer" | "staff" | "manager" | "admin";
type DevRole = AppRole;

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: RoleOption;
  is_active: boolean;
  created_at: string | null;
};

export default function UsersPage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createSupabaseBrowserClient(), []);

  const [loading, setLoading] = React.useState(true);
  const [role, setRole] = React.useState<DevRole | null>(null);

  // 신규 유저 생성 폼
  const [newEmail, setNewEmail] = React.useState("");
  const [newName, setNewName] = React.useState("");
  const [newRole, setNewRole] = React.useState<RoleOption>("viewer");
  const [inviteMode, setInviteMode] = React.useState(true);
  const [tempPassword, setTempPassword] = React.useState("Temp1234!");

  // 유저 리스트
  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [listLoading, setListLoading] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [resettingId, setResettingId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  // ===== 유저 목록 로딩: /api/admin/users 응답 형식이 무엇이든 대응 =====
  async function loadUsers() {
    try {
      setListLoading(true);

      const res = await fetch("/api/admin/users");
      const data = await res.json();

      if (!res.ok) {
        console.error("Failed to load users:", data);
        alert(data.error || "Failed to load users.");
        return;
      }

      // 응답이 어떤 형태든 최대한 잡아낸다.
      let raw: any;

      if (Array.isArray(data)) {
        raw = data;
      } else if (Array.isArray((data as any).users)) {
        raw = (data as any).users;
      } else if (Array.isArray((data as any).data)) {
        raw = (data as any).data;
      } else if (Array.isArray((data as any).items)) {
        raw = (data as any).items;
      } else {
        console.warn("Unknown users payload shape:", data);
        raw = [];
      }

      const rows: UserRow[] = raw.map((u: any) => ({
        id: u.id,
        email: u.email,
        name: u.name ?? null,
        role: (u.role || "viewer") as RoleOption,
        is_active: u.is_active ?? true,
        created_at: u.created_at ?? null,
      }));

      setUsers(rows);
    } catch (err) {
      console.error("Error loading users:", err);
      alert("Error while loading users.");
    } finally {
      setListLoading(false);
    }
  }

  // ===== 세션 & 권한 체크 + 첫 로딩 =====
  React.useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login?redirectTo=/users");
        return;
      }

      const r =
        ((session.user.user_metadata as any)?.role as AppRole | undefined) ||
        "viewer";

      setRole(r as DevRole);
      setLoading(false);

      // admin / manager만 접근 허용 (필요하면 조정 가능)
      if (r !== "admin" && r !== "manager") {
        alert("You do not have permission to manage users.");
        router.replace("/");
        return;
      }

      await loadUsers();
    };

    init();
  }, [supabase, router]);

  const reloadUsers = async () => {
    await loadUsers();
  };

  // ===== 신규 유저 생성 =====
  const handleCreateUser = async () => {
    if (!newEmail.trim()) {
      alert("Email is required.");
      return;
    }
    if (!inviteMode && !tempPassword.trim()) {
      alert("Temporary password is required.");
      return;
    }

    try {
      setCreating(true);

      const body: any = {
        email: newEmail.trim(),
        name: newName.trim() || null,
        role: newRole,
        invite: inviteMode,
      };
      if (!inviteMode) {
        body.tempPassword = tempPassword.trim();
      }

      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("Create user error:", data);
        alert(data.error || "Failed to create user.");
        return;
      }

      alert("User created successfully.");
      setNewEmail("");
      setNewName("");
      setNewRole("viewer");
      await reloadUsers();
    } catch (err) {
      console.error("Create user request error:", err);
      alert("Network or server error while creating user.");
    } finally {
      setCreating(false);
    }
  };

  // ===== 리스트 로컬 상태 변경 =====
  const updateLocalUser = (
    id: string,
    field: keyof Omit<UserRow, "id" | "email" | "created_at">,
    value: any
  ) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === id
          ? {
              ...u,
              [field]: value,
            }
          : u
      )
    );
  };

  // ===== Save (이름 / 역할 / 활성화 상태 저장) =====
  const handleSaveRow = async (user: UserRow) => {
    try {
      setSavingId(user.id);
      const body = {
        id: user.id,
        name: user.name,
        role: user.role,
        is_active: user.is_active,
      };

      const res = await fetch("/api/admin/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("Update user error:", data);
        alert(data.error || "Failed to update user.");
        return;
      }

      alert("User updated.");
      await reloadUsers();
    } catch (err) {
      console.error("Update user request error:", err);
      alert("Network or server error while updating user.");
    } finally {
      setSavingId(null);
    }
  };

  // ===== 비밀번호 초기화 =====
  const handleResetPassword = async (user: UserRow) => {
    if (
      !window.confirm(
        `Reset password for ${user.email}? A reset link or temp password will be created.`
      )
    ) {
      return;
    }

    try {
      setResettingId(user.id);
      const res = await fetch("/api/admin/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("Reset password error:", data);
        alert(data.error || "Failed to reset password.");
        return;
      }

      alert(
        data.message ||
          "Password reset processed. Please check email or see temp password."
      );
    } catch (err) {
      console.error("Reset password request error:", err);
      alert("Network or server error while resetting password.");
    } finally {
      setResettingId(null);
    }
  };

  // ===== 유저 삭제 =====
  const handleDeleteUser = async (user: UserRow) => {
    if (
      !window.confirm(
        `Delete user ${user.email}? This action cannot be undone.`
      )
    ) {
      return;
    }

    try {
      setDeletingId(user.id);
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("Delete user error:", data);
        alert(data.error || "Failed to delete user.");
        return;
      }

      alert("User deleted.");
      await reloadUsers();
    } catch (err) {
      console.error("Delete user request error:", err);
      alert("Network or server error while deleting user.");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading || !role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="text-sm text-slate-500">Loading...</div>
      </div>
    );
  }

  return (
    <AppShell
      role={role}
      title="Users"
      description="Admin-managed ERP user accounts."
    >
      <div className="p-4 space-y-6">
        {/* 상단: 신규 유저 생성 */}
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">
              Users (Admin-managed)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[2fr,1.4fr,1fr] gap-4 items-end">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  placeholder="user@jm-i.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="Full name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select
                  value={newRole}
                  onValueChange={(v) => setNewRole(v as RoleOption)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">viewer</SelectItem>
                    <SelectItem value="staff">staff</SelectItem>
                    <SelectItem value="manager">manager</SelectItem>
                    <SelectItem value="admin">admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-[auto,1fr,auto] gap-4 items-center">
              <div className="flex items-center gap-2">
                <Switch
                  id="invite-mode"
                  checked={inviteMode}
                  onCheckedChange={(v) => setInviteMode(v)}
                />
                <Label htmlFor="invite-mode" className="text-xs">
                  Invite mode (email link)
                </Label>
              </div>
              {!inviteMode && (
                <div className="space-y-1">
                  <Label className="text-xs">Temporary password</Label>
                  <Input
                    className="h-8 text-xs"
                    value={tempPassword}
                    onChange={(e) => setTempPassword(e.target.value)}
                  />
                  <p className="text-[10px] text-slate-500">
                    이 비밀번호로 바로 로그인 가능하게 만들고, 나중에 사용자가
                    직접 변경하도록 할 수 있습니다.
                  </p>
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  type="button"
                  className="px-6 h-10 bg-black text-white hover:bg-slate-800"
                  onClick={handleCreateUser}
                  disabled={creating}
                >
                  {creating ? "Creating..." : "Create"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 하단: 유저 리스트 */}
        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold">User List</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {listLoading && (
              <p className="text-xs text-slate-500">Loading users...</p>
            )}
            <div className="space-y-3">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="flex flex-col md:flex-row md:items-center gap-2 border rounded-xl px-3 py-2 bg-slate-50"
                >
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-[2fr,1.4fr,1fr,auto] gap-2 items-center">
                    <div>
                      <Label className="text-[11px] text-slate-500">
                        Email
                      </Label>
                      <div className="text-xs md:text-sm truncate">
                        {u.email}
                      </div>
                    </div>

                    <div>
                      <Label className="text-[11px] text-slate-500">
                        Name
                      </Label>
                      <Input
                        className="h-8 text-xs"
                        value={u.name ?? ""}
                        onChange={(e) =>
                          updateLocalUser(u.id, "name", e.target.value)
                        }
                      />
                    </div>

                    <div>
                      <Label className="text-[11px] text-slate-500">
                        Role
                      </Label>
                      <Select
                        value={u.role}
                        onValueChange={(v) =>
                          updateLocalUser(u.id, "role", v as RoleOption)
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">viewer</SelectItem>
                          <SelectItem value="staff">staff</SelectItem>
                          <SelectItem value="manager">manager</SelectItem>
                          <SelectItem value="admin">admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        id={`active-${u.id}`}
                        checked={u.is_active}
                        onCheckedChange={(v) =>
                          updateLocalUser(u.id, "is_active", v)
                        }
                      />
                      <Label
                        htmlFor={`active-${u.id}`}
                        className="text-xs md:text-[11px]"
                      >
                        Active
                      </Label>
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 px-3 bg-black text-white hover:bg-slate-800 text-xs"
                      onClick={() => handleSaveRow(u)}
                      disabled={savingId === u.id}
                    >
                      {savingId === u.id ? "Saving..." : "Save"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={() => handleResetPassword(u)}
                      disabled={resettingId === u.id}
                    >
                      {resettingId === u.id ? "Resetting..." : "Reset PW"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="h-8 px-3 text-xs"
                      onClick={() => handleDeleteUser(u)}
                      disabled={deletingId === u.id}
                    >
                      {deletingId === u.id ? "Deleting..." : "Delete"}
                    </Button>
                  </div>

                  {u.created_at && (
                    <div className="text-[10px] text-slate-500 self-end md:self-center">
                      Created: {u.created_at.slice(0, 10)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
