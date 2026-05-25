import {
  BarChart3,
  BookOpenCheck,
  ClipboardList,
  FileText,
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
    { label: "My Drafts", to: "/admin/drafts", icon: FileText },
    { label: "Exams", to: "/admin/exams", icon: BookOpenCheck },
    { label: "Proctoring", to: "/admin/proctoring", icon: Radio },
    { label: "Reports", to: "/admin/reports", icon: BarChart3 },
    { label: "Settings", to: "/admin/settings", icon: Settings }
  ],
  teacher: [
    { label: "Dashboard", to: "/teacher", icon: Gauge },
    { label: "My Exams", to: "/teacher/exams", icon: BookOpenCheck },
    { label: "Question Bank", to: "/teacher/question-bank", icon: ClipboardList },
    { label: "My Drafts", to: "/teacher/drafts", icon: FileText },
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

export function normalizeReactHref(href, fallback = "/react/notifications") {
  if (!href) return fallback;
  const value = String(href);
  if (/^(https?:|mailto:|tel:|#)/.test(value)) return value;
  if (value.startsWith("/react/")) return value;
  if (value.startsWith("/static/") || value.startsWith("/api/")) return value;

  const mappings = [
    [/^\/admin\/users(?:\/.*)?$/, "/react/admin/users"],
    [/^\/admin\/groups(?:\/.*)?$/, "/react/admin/groups"],
    [/^\/admin\/exams(?:\/.*)?$/, "/react/admin/exams"],
    [/^\/admin\/proctoring(?:\/.*)?$/, "/react/admin/proctoring"],
    [/^\/admin\/(?:violations|audit-logs|analytics|suspicious-activity|reports)(?:\/.*)?$/, "/react/admin/reports"],
    [/^\/admin\/settings(?:\/.*)?$/, "/react/admin/settings"],
    [/^\/admin(?:\/)?$/, "/react/admin"],
    [/^\/teacher\/session\/(\d+)(?:\/.*)?$/, "/react/teacher/session/$1/review"],
    [/^\/teacher\/exam\/(\d+)\/(?:results|similarity)(?:\/.*)?$/, "/react/teacher/exam/$1/review"],
    [/^\/teacher\/exam\/(\d+)\/(?:import|question-bank\/import|enrollments)(?:\/.*)?$/, "/react/teacher/exam/$1/edit"],
    [/^\/teacher\/setup\/(\d+)(?:\/.*)?$/, "/react/teacher/exam/$1/edit"],
    [/^\/teacher\/setup(?:\/)?$/, "/react/teacher/exam/new"],
    [/^\/teacher\/question-bank(?:\/.*)?$/, "/react/teacher/question-bank"],
    [/^\/teacher\/proctoring(?:\/.*)?$/, "/react/teacher/proctoring"],
    [/^\/teacher\/reports(?:\/.*)?$/, "/react/teacher/reports"],
    [/^\/teacher(?:\/dashboard)?(?:\/)?$/, "/react/teacher"],
    [/^\/student\/exam\/([^/]+)(?:\/.*)?$/, "/react/exam/$1"],
    [/^\/student\/waiting\/([^/]+)(?:\/.*)?$/, "/react/student/waiting/$1"],
    [/^\/student\/precheck\/([^/]+)(?:\/.*)?$/, "/react/student/precheck/$1"],
    [/^\/student\/submitted\/([^/]+)(?:\/.*)?$/, "/react/student/submitted/$1"],
    [/^\/student\/join(?:\/.*)?$/, "/react/student/join"],
    [/^\/student\/results(?:\/.*)?$/, "/react/student/results"],
    [/^\/student(?:\/dashboard)?(?:\/)?$/, "/react/student"],
    [/^\/login(?:\/)?$/, "/react/login"],
    [/^\/admin\/login(?:\/)?$/, "/react/admin/login"],
    [/^\/admin\/setup(?:\/)?$/, "/react/admin/setup"],
    [/^\/student\/register(?:\/)?$/, "/react/register"]
  ];

  for (const [pattern, replacement] of mappings) {
    if (pattern.test(value)) return value.replace(pattern, replacement);
  }

  return fallback;
}
