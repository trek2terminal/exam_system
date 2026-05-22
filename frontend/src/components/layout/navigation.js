import {
  BarChart3,
  BookOpenCheck,
  ClipboardList,
  FileClock,
  Gauge,
  History,
  Radio,
  ScrollText,
  Settings,
  ShieldCheck,
  UserRoundCog,
  Users
} from "lucide-react";

export const rolePaths = {
  admin: "/admin",
  teacher: "/teacher",
  student: "/student"
};

export const roleNavigation = {
  admin: [
    { label: "Dashboard", to: "/admin", icon: Gauge },
    { label: "Users", to: "/admin/users", icon: Users },
    { label: "Groups", to: "/admin/groups", icon: UserRoundCog },
    { label: "Exams", to: "/admin/exams", icon: BookOpenCheck },
    { label: "Proctoring", to: "/admin/proctoring", icon: Radio },
    { label: "Reports", to: "/admin/reports", icon: BarChart3 },
    { label: "Settings", to: "/admin/settings", icon: Settings }
  ],
  teacher: [
    { label: "Dashboard", to: "/teacher", icon: Gauge },
    { label: "My Exams", to: "/teacher/exams", icon: BookOpenCheck },
    { label: "Question Bank", to: "/teacher/question-bank", icon: ClipboardList },
    { label: "Proctoring", to: "/teacher/proctoring", icon: Radio },
    { label: "Reports", to: "/teacher/reports", icon: BarChart3 }
  ],
  student: [
    { label: "Dashboard", to: "/student", icon: Gauge },
    { label: "My Exams", to: "/student/exams", icon: BookOpenCheck },
    { label: "Results", to: "/student/results", icon: ScrollText },
    { label: "Exam History", to: "/student/history", icon: History }
  ]
};

export const platformIcon = ShieldCheck;

export function roleLabel(role) {
  if (!role) return "Guest";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function userName(auth) {
  return auth?.student_name || auth?.teacher_name || auth?.admin_name || "Guest";
}

export function userSubtitle(auth) {
  if (auth?.role === "student") return auth.roll_no ? `Roll ${auth.roll_no}` : "Student";
  return roleLabel(auth?.role);
}

export function breadcrumbFor(pathname, role) {
  const navItems = roleNavigation[role] || [];
  const active = [...navItems]
    .sort((left, right) => right.to.length - left.to.length)
    .find(item => pathname === item.to || pathname.startsWith(`${item.to}/`));

  if (active) return ["Workspace", active.label];
  if (pathname.includes("/review")) return ["Teacher", "Review"];
  if (pathname.includes("/notifications")) return ["Workspace", "Notifications"];
  return ["Workspace", "Dashboard"];
}

export function logoutHref(role) {
  if (!role) return "/";
  return `/${role}/logout`;
}
