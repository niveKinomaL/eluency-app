import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Modal,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { NavigationProp, RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppButton from "../components/AppButton";
import GlassCard from "../components/GlassCard";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";

type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Dashboard: { sessionId?: string; openDrawer?: boolean } | undefined;
  Chats: undefined;
  SendNotifications: undefined;
  Teachers: undefined;
  Settings: undefined;
  Subscription: undefined;
  LessonPacks: undefined;
  Lessons: undefined;
  Students: undefined;
  StudentForm: { studentId?: string } | undefined;
  Tests: undefined;
  TestForm: { testId?: string } | undefined;
  StudyGame: { sessionId: string };
};

type RecentLesson = {
  id: string;
  title: string;
  slug: string;
  status: string;
  created_at: string;
};

type RecentTest = {
  id: string;
  name: string;
  type: string;
  status: string;
  created_at: string;
};

type TeacherCapacityItem = {
  id: string;
  name: string;
  created_at: string;
  student_limit: number;
  studentCount: number;
  percentage: number; // 0..100
};

type StudentSessionResponse = {
  student: {
    id: string;
    name: string;
    code: string;
    assigned_lessons: string[];
    assigned_tests: string[];
  };
  teacher: { id: string; name: string; email: string | null } | null;
  expires_at: string;
  error?: string;
};

function formatDateTime(dateIso?: string | null) {
  if (!dateIso) return "";
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function pickProgressColor(theme: ReturnType<typeof useAppTheme>, percentage: number) {
  // Mimics the web logic: high load -> red; mid -> orange; low -> green.
  if (percentage >= 90) return theme.colors.danger;
  if (percentage >= 70) return theme.colors.primary;
  return theme.colors.success;
}

export default function DashboardScreen() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<RootStackParamList, "Dashboard">>();

  const sessionId = route.params?.sessionId;

  const apiBaseUrl =
    Constants.expoConfig?.extra?.apiBaseUrl?.toString() || "https://www.eluency.com";

  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [drawerVisible, setDrawerVisible] = useState(false);

  const drawerWidth = useMemo(() => Dimensions.get("window").width, []);
  const drawerAnim = useRef(new Animated.Value(-drawerWidth)).current;

  // Teacher mode
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPrincipal, setIsPrincipal] = useState(false);
  const [teacherName, setTeacherName] = useState("Teacher");
  const [lessonsCount, setLessonsCount] = useState(0);
  const [testsCount, setTestsCount] = useState(0);
  const [studentsCount, setStudentsCount] = useState(0);
  const [teachersCount, setTeachersCount] = useState(0);
  const [adminPlanCounts, setAdminPlanCounts] = useState({
    free: 0,
    tutor: 0,
    standard: 0,
    pro: 0,
    school: 0,
    internal: 0,
  });
  const [adminRevenueMonthly, setAdminRevenueMonthly] = useState(0);
  const [recentLessons, setRecentLessons] = useState<RecentLesson[]>([]);
  const [recentTests, setRecentTests] = useState<RecentTest[]>([]);
  const [teacherCapacity, setTeacherCapacity] = useState<TeacherCapacityItem[]>([]);

  // Student mode fallback (so the screen doesn't break)
  const [studentName, setStudentName] = useState<string>("");
  const [studentTeacherName, setStudentTeacherName] = useState<string>("");
  const [assignedLessonsIds, setAssignedLessonsIds] = useState<string[]>([]);
  const [assignedTestsIds, setAssignedTestsIds] = useState<string[]>([]);
  const [studentExpiresAt, setStudentExpiresAt] = useState<string>("");

  const isStudentMode = !!sessionId;
  const currentUserName = isStudentMode ? studentName || "Student" : teacherName || "Teacher";
  const currentUserInitial = currentUserName.trim().charAt(0).toUpperCase() || "U";

  const PLAN_PRICE_MONTHLY = useMemo(
    () => ({
      free: 0,
      tutor: 14.99,
      standard: 29.99,
      teacher: 29.99,
      pro: 49.99,
      school: 0,
      internal: 0,
    }),
    []
  );

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // Ignore sign-out errors (student mode doesn't use supabase auth)
    }
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  };

  const handleActionPress = (label: string) => {
    if (label === "/dashboard/chats") {
      navigation.navigate("Chats");
      return;
    }
    if (label === "/dashboard/notifications") {
      navigation.navigate("SendNotifications");
      return;
    }
    if (label === "/dashboard/teachers") {
      navigation.navigate("Teachers");
      return;
    }
    if (label === "/dashboard/settings") {
      navigation.navigate("Settings");
      return;
    }
    if (label === "/dashboard/settings/subscription") {
      navigation.navigate("Subscription");
      return;
    }
    if (label === "/dashboard/packs") {
      navigation.navigate("LessonPacks");
      return;
    }
    if (label === "/dashboard/lessons") {
      navigation.navigate("Lessons");
      return;
    }
    if (label === "/dashboard/students") {
      navigation.navigate("Students");
      return;
    }
    if (label === "/dashboard/tests") {
      navigation.navigate("Tests");
      return;
    }
    Alert.alert("Coming soon", `Mobile action not implemented yet: ${label}`);
  };

  const menuSections = useMemo(() => {
    const workspace = [
      { label: "Dashboard", href: "/dashboard", icon: "shield" as const },
      { label: "Lessons", href: "/dashboard/lessons", icon: "book" as const },
      { label: "Tests", href: "/dashboard/tests", icon: "clipboard" as const },
      { label: "Students", href: "/dashboard/students", icon: "school" as const },
      { label: "Lesson Packs", href: "/dashboard/packs", icon: "star" as const },
    ];

    const admin = isAdmin
      ? [
          { label: "Teachers", href: "/dashboard/teachers", icon: "people" as const },
          { label: "Send Notifications", href: "/dashboard/notifications", icon: "flame" as const },
          { label: "Chats", href: "/dashboard/chats", icon: "star" as const },
        ]
      : [];

    const account = [
      { label: "Settings", href: "/dashboard/settings", icon: "settings" as const },
      { label: "Subscription", href: "/dashboard/settings/subscription", icon: "wallet" as const },
    ];

    return [
      { title: "Workspace", items: workspace },
      ...(isAdmin ? [{ title: "Admin", items: admin }] : []),
      { title: "Account", items: account },
    ];
  }, [isAdmin]);

  useEffect(() => {
    let isMounted = true;

    async function loadStudentSession() {
      if (!sessionId) return;
      setFatalError(null);
      setLoading(true);

      try {
        const res = await fetch(`${apiBaseUrl}/api/students/session?session=${sessionId}`);
        let json: StudentSessionResponse | null = null;
        try {
          json = (await res.json()) as StudentSessionResponse;
        } catch {
          json = null;
        }

        if (!res.ok || !json || json.error) {
          throw new Error(json?.error || "Unable to load student session.");
        }

        if (!isMounted) return;
        setStudentName(json.student?.name ?? "Student");
        setStudentTeacherName(json.teacher?.name ?? "");
        setAssignedLessonsIds(json.student?.assigned_lessons ?? []);
        setAssignedTestsIds(json.student?.assigned_tests ?? []);
        setStudentExpiresAt(json.expires_at ?? "");
      } catch (err) {
        if (!isMounted) return;
        setFatalError(err instanceof Error ? err.message : "Unable to load dashboard.");
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    }

    async function loadTeacherDashboard() {
      setFatalError(null);
      setLoading(true);

      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) throw userError;
        if (!user) {
          if (!isMounted) return;
          navigation.reset({ index: 0, routes: [{ name: "Login" }] });
          return;
        }

        // Teacher identity (equivalent to web dashboard role/personalization)
        const { data: currentTeacher, error: teacherError } = await (supabase.from("teachers") as any)
          .select("id, user_id, name, role, active, plan, student_limit, created_at")
          .eq("user_id", user.id)
          .maybeSingle();

        if (teacherError && !currentTeacher) {
          throw new Error("Unable to load teacher profile.");
        }

        const role = (currentTeacher?.role ?? "teacher") as string;
        const admin = role === "admin";
        const principal = role === "principal";

        const tName =
          currentTeacher?.name ||
          (admin ? "Administrator" : principal ? "Principal" : "Teacher");

        if (!isMounted) return;
        setIsAdmin(admin);
        setIsPrincipal(principal);
        setTeacherName(tName);

        // Stats counts (equivalent query logic)
        const lessonQuery = (supabase.from("lessons") as any).select("*", {
          count: "exact",
          head: true,
        });
        const testQuery = (supabase.from("tests") as any).select("*", {
          count: "exact",
          head: true,
        });
        const studentQuery = (supabase.from("students") as any).select("*", {
          count: "exact",
          head: true,
        });
        const teachersQuery = (supabase.from("teachers") as any).select("*", {
          count: "exact",
          head: true,
        });

        if (!admin && !principal) {
          lessonQuery.eq("created_by", user.id);
          testQuery.eq("created_by", user.id);
          studentQuery.eq("teacher_id", user.id);
        }

        const [lessonsRes, testsRes, studentsRes, teachersRes] = await Promise.all([
          lessonQuery,
          testQuery,
          studentQuery,
          teachersQuery,
        ]);

        if (!isMounted) return;
        setLessonsCount(lessonsRes?.count ?? 0);
        setTestsCount(testsRes?.count ?? 0);
        setStudentsCount(studentsRes?.count ?? 0);
        setTeachersCount(teachersRes?.count ?? 0);

        // Admin KPIs: plan counts + monthly revenue
        if (admin) {
          const { data: plansRows } = await (supabase.from("teachers") as any).select("plan");
          const planRows = (plansRows ?? []) as { plan: string | null }[];

          const localPlanCounts = {
            free: 0,
            tutor: 0,
            standard: 0,
            pro: 0,
            school: 0,
            internal: 0,
          };

          for (const row of planRows) {
            const p = (row?.plan ?? "free").toLowerCase().trim();
            if (p === "standard" || p === "teacher") localPlanCounts.standard++;
            else if (p === "internal") localPlanCounts.internal++;
            else if (p in localPlanCounts) (localPlanCounts as any)[p]++;
            else localPlanCounts.free++;
          }

          const revenueMonthly =
            localPlanCounts.tutor * PLAN_PRICE_MONTHLY.tutor +
            localPlanCounts.standard * PLAN_PRICE_MONTHLY.standard +
            localPlanCounts.pro * PLAN_PRICE_MONTHLY.pro;

          setAdminPlanCounts(localPlanCounts);
          setAdminRevenueMonthly(revenueMonthly);
        }

        // Role-specific content
        if (admin || principal) {
          const { data: teachersRows } = await (supabase.from("teachers") as any)
            .select("user_id, name, student_limit, created_at")
            .eq("role", "teacher");

          const teacherRows = (teachersRows ?? []) as any[];

          const capacityItems: TeacherCapacityItem[] = await Promise.all(
            teacherRows.map(async (t) => {
              const teacherUserId = String(t.user_id);
              const { count } = await (supabase.from("students") as any)
                .select("*", { count: "exact", head: true })
                .eq("teacher_id", teacherUserId);

              const studentCount = count ?? 0;
              const limitNumber =
                typeof t.student_limit === "number"
                  ? t.student_limit
                  : t.student_limit
                    ? Number(t.student_limit)
                    : 10;

              const limit = Number.isFinite(limitNumber) && limitNumber > 0 ? limitNumber : 10;
              const percentage = Math.min((studentCount / limit) * 100, 100);

              return {
                id: teacherUserId,
                name: t.name ?? "Teacher",
                created_at: t.created_at ?? "",
                student_limit: limit,
                studentCount,
                percentage,
              };
            })
          );

          if (!isMounted) return;
          setTeacherCapacity(capacityItems);
          setRecentLessons([]);
          setRecentTests([]);
        } else {
          const [rawLessons, rawTests] = await Promise.all([
            (supabase.from("lessons") as any)
              .select("id, title, slug, status, created_at")
              .eq("created_by", user.id)
              .order("created_at", { ascending: false })
              .limit(5),
            (supabase.from("tests") as any)
              .select("id, name, type, status, created_at")
              .eq("created_by", user.id)
              .order("created_at", { ascending: false })
              .limit(5),
          ]);

          if (!isMounted) return;
          setRecentLessons((rawLessons?.data ?? []) as RecentLesson[]);
          setRecentTests((rawTests?.data ?? []) as RecentTest[]);
          setTeacherCapacity([]);
        }
      } catch (err) {
        if (!isMounted) return;
        setFatalError(err instanceof Error ? err.message : "Unable to load dashboard.");
      } finally {
        if (!isMounted) return;
        setLoading(false);
      }
    }

    if (isStudentMode) loadStudentSession();
    else loadTeacherDashboard();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBaseUrl, isStudentMode, navigation, sessionId, PLAN_PRICE_MONTHLY]);

  const animateDrawer = (toValue: number, onDone?: () => void) => {
    Animated.timing(drawerAnim, {
      toValue,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onDone?.();
    });
  };

  const openMenu = () => {
    // Render immediately, then animate in the effect.
    setDrawerVisible(true);
    drawerAnim.setValue(-drawerWidth);
    animateDrawer(0);
  };

  const closeMenu = () => {
    animateDrawer(-drawerWidth, () => setDrawerVisible(false));
  };

  useEffect(() => {
    if (route.params?.openDrawer !== true) return;
    const id = requestAnimationFrame(() => {
      openMenu();
      navigation.setParams({ openDrawer: false } as never);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to openDrawer flag
  }, [route.params?.openDrawer, navigation]);

  const welcomeSubtitle = useMemo(() => {
    if (isAdmin) {
      return "Overseeing the platform and teacher performance.";
    }
    if (isPrincipal) {
      return "Manage your school’s teachers, students, and assignments.";
    }
    return "Manage your students and their learning progress.";
  }, [isAdmin, isPrincipal]);

  const stats = useMemo(() => {
    const items: Array<{
      label: string;
      value: number;
      icon: keyof typeof ICONS;
      iconBg: string;
      iconColor: string;
      onPress: () => void;
    }> = [
      {
        label: "Total Lessons",
        value: lessonsCount,
        icon: "book",
        iconBg: theme.colors.primarySoft,
        iconColor: theme.colors.primary,
        onPress: () => handleActionPress("/dashboard/lessons"),
      },
      {
        label: "Total Tests",
        value: testsCount,
        icon: "clipboard",
        iconBg: theme.colors.primarySoft,
        iconColor: theme.colors.primary,
        onPress: () => handleActionPress("/dashboard/tests"),
      },
      {
        label: "Students",
        value: studentsCount,
        icon: "school",
        iconBg: theme.colors.successSoft,
        iconColor: theme.colors.success,
        onPress: () => handleActionPress("/dashboard/students"),
      },
    ];

    if (isAdmin || isPrincipal) {
      items.push({
        label: "Teachers",
        value: teachersCount,
        icon: "people",
        iconBg: theme.colors.surfaceAlt,
        iconColor: theme.colors.text,
        onPress: () => handleActionPress("/dashboard/teachers"),
      });
    }

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleActionPress, isAdmin, isPrincipal, lessonsCount, studentsCount, testsCount, teachersCount, theme]);

  const ICONS = useMemo(() => {
    // Keeps TS happy for icon names while reusing existing Ionicons.d.ts union.
    return {
      book: "book" as const,
      clipboard: "clipboard" as const,
      school: "school" as const,
      people: "people" as const,
      shield: "shield-checkmark" as const,
      wallet: "wallet" as const,
      flame: "flame" as const,
      star: "star" as const,
      settings: "settings" as const,
    };
  }, []);

  const renderStatusPill = (status: string) => {
    const published = status === "published";
    const backgroundColor = published ? theme.colors.successSoft : theme.colors.dangerSoft;
    const borderColor = published ? theme.colors.success : theme.colors.danger;
    const color = published ? theme.colors.success : theme.colors.danger;

    return (
      <View
        style={{
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 999,
          borderWidth: 1,
          borderColor,
          backgroundColor,
        }}
      >
        <Text style={{ color, fontWeight: "700", fontSize: 12, textTransform: "uppercase" }}>
          {status}
        </Text>
      </View>
    );
  };

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    []
  );
  const topBarHeight = Math.max(insets.top, 8) + 62;

  const SectionHeader = ({
    eyebrow,
    title,
    subtitle,
    actionLabel,
    onActionPress,
  }: {
    eyebrow: string;
    title: string;
    subtitle?: string;
    actionLabel?: string;
    onActionPress?: () => void;
  }) => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginBottom: 14,
      }}
    >
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={theme.typography.label}>{eyebrow}</Text>
        <Text style={[theme.typography.title, { marginTop: 6 }]}>{title}</Text>
        {subtitle ? (
          <Text style={[theme.typography.caption, { marginTop: 4, color: theme.colors.textMuted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actionLabel && onActionPress ? (
        <TouchableOpacity onPress={onActionPress} activeOpacity={0.8}>
          <Text style={[theme.typography.caption, { color: theme.colors.primary, fontWeight: "700" }]}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const HeroCard = ({
    eyebrow,
    title,
    subtitle,
    statA,
    statB,
    icon,
  }: {
    eyebrow: string;
    title: string;
    subtitle: string;
    statA: { label: string; value: string | number };
    statB: { label: string; value: string | number };
    icon: keyof typeof ICONS;
  }) => (
    <GlassCard style={{ marginBottom: 18, borderRadius: 12 }}>
      <View
        style={{
          borderRadius: 12,
          backgroundColor: theme.colors.primarySoft,
          padding: 20,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={[theme.typography.label, { color: theme.colors.primary }]}>{eyebrow}</Text>
            <Text
              style={[
                theme.typography.display,
                { marginTop: 10, fontSize: 30, lineHeight: 34 },
              ]}
            >
              {title}
            </Text>
            <Text style={[theme.typography.body, { marginTop: 10, color: theme.colors.textMuted }]}>
              {subtitle}
            </Text>
          </View>
          <View
            style={{
              height: 64,
              width: 64,
              borderRadius: 22,
              backgroundColor: theme.colors.background,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name={ICONS[icon]} size={26} color={theme.colors.primary} />
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
          {[statA, statB].map((item) => (
            <View
              key={item.label}
              style={{
                flex: 1,
                borderRadius: 12,
                backgroundColor: theme.colors.background,
                padding: 14,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={[theme.typography.label, { color: theme.colors.textSoft }]}>{item.label}</Text>
              <Text style={[theme.typography.title, { marginTop: 8, fontSize: 24, lineHeight: 28 }]}>
                {item.value}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </GlassCard>
  );

  const StatTile = ({
    label,
    value,
    icon,
    iconBg,
    iconColor,
    onPress,
  }: {
    label: string;
    value: number;
    icon: keyof typeof ICONS;
    iconBg: string;
    iconColor: string;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={{
        width: "100%",
        marginBottom: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceGlass,
        padding: 16,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={[theme.typography.label, { fontSize: 10, lineHeight: 14 }]}>{label}</Text>
          <Text style={[theme.typography.title, { marginTop: 8, fontSize: 22, lineHeight: 26 }]}>
            {value}
          </Text>
        </View>
        <View
          style={{
            height: 50,
            width: 50,
            borderRadius: 18,
            backgroundColor: iconBg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={ICONS[icon]} size={22} color={iconColor} />
        </View>
      </View>
    </TouchableOpacity>
  );

  const QuickActionPill = ({
    label,
    icon,
  }: {
    label: string;
    icon: keyof typeof ICONS;
  }) => (
    <TouchableOpacity
      onPress={() => handleActionPress(label)}
      activeOpacity={0.85}
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surfaceAlt,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        marginRight: 10,
        marginBottom: 10,
      }}
    >
      <Ionicons name={ICONS[icon]} size={16} color={theme.colors.primary} />
      <Text
        style={[
          theme.typography.caption,
          { marginLeft: 8, color: theme.colors.text, fontWeight: "700" },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  const CompactMetric = ({
    label,
    value,
    accent = theme.colors.primarySoft,
  }: {
    label: string;
    value: string | number;
    accent?: string;
  }) => (
    <View
      style={{
        width: "48.5%",
        marginBottom: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: accent,
        padding: 14,
      }}
    >
      <Text style={[theme.typography.label, { color: theme.colors.textSoft }]}>{label}</Text>
      <Text style={[theme.typography.title, { marginTop: 8, fontSize: 24, lineHeight: 28 }]}>{value}</Text>
    </View>
  );

  const RecentListCard = ({
    eyebrow,
    title,
    items,
    type,
  }: {
    eyebrow: string;
    title: string;
    items: Array<RecentLesson | RecentTest>;
    type: "lesson" | "test";
  }) => (
    <GlassCard style={{ marginBottom: 16, borderRadius: 12 }}>
      <SectionHeader
        eyebrow={eyebrow}
        title={title}
        actionLabel="View all"
        onActionPress={() => handleActionPress(`/dashboard/${type}s`)}
      />
      {items.length > 0 ? (
        (items as any[]).map((item, index) => {
          const itemTitle = type === "lesson" ? item.title : item.name;
          const subtitle = type === "test" ? item.type : formatDateTime(item.created_at);

          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => handleActionPress(`/dashboard/${type}s/${item.id}/edit`)}
              activeOpacity={0.85}
              style={{
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.colors.border,
                paddingTop: index === 0 ? 0 : 14,
                marginTop: index === 0 ? 0 : 14,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[theme.typography.bodyStrong, { color: theme.colors.text }]} numberOfLines={1}>
                  {itemTitle}
                </Text>
                <Text style={[theme.typography.caption, { marginTop: 4, color: theme.colors.textMuted }]}>
                  {subtitle}
                </Text>
              </View>
              {renderStatusPill(item.status)}
            </TouchableOpacity>
          );
        })
      ) : (
        <View
          style={{
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.colors.borderStrong,
            padding: 18,
            alignItems: "center",
          }}
        >
          <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>No records found</Text>
        </View>
      )}
    </GlassCard>
  );

  const AssignmentCard = ({
    eyebrow,
    title,
    items,
    emptyLabel,
  }: {
    eyebrow: string;
    title: string;
    items: string[];
    emptyLabel: string;
  }) => (
    <GlassCard style={{ marginBottom: 16, borderRadius: 12 }}>
      <SectionHeader eyebrow={eyebrow} title={title} subtitle={`${items.length} assigned`} />
      {items.length > 0 ? (
        items.map((id, index) => (
          <View
            key={id}
            style={{
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: theme.colors.border,
              paddingTop: index === 0 ? 0 : 14,
              marginTop: index === 0 ? 0 : 14,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <View
              style={{
                height: 34,
                width: 34,
                borderRadius: 12,
                backgroundColor: theme.colors.primarySoft,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 12,
              }}
            >
              <Ionicons name="checkmark" size={18} color={theme.colors.primary} />
            </View>
            <Text style={[theme.typography.bodyStrong, { flex: 1 }]}>{id}</Text>
          </View>
        ))
      ) : (
        <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>{emptyLabel}</Text>
      )}
    </GlassCard>
  );

  const teacherDashboard = (
    <>
      <GlassCard style={{ marginBottom: 18, borderRadius: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={theme.typography.label}>
              {isAdmin ? "Admin" : isPrincipal ? "Principal" : "Teacher"} dashboard
            </Text>
            <Text style={[theme.typography.title, { marginTop: 6, fontSize: 22, lineHeight: 28 }]}>
              {`Welcome back, ${teacherName}`}
            </Text>
            <Text style={[theme.typography.bodyStrong, { marginTop: 8 }]}>{welcomeSubtitle}</Text>
          </View>
          <View
            style={{
              height: 56,
              width: 56,
              borderRadius: 22,
              backgroundColor: theme.colors.primarySoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="shield-checkmark" size={26} color={theme.colors.primary} />
          </View>
        </View>
      </GlassCard>

      <GlassCard style={{ marginBottom: 16, borderRadius: 12 }}>
        <SectionHeader eyebrow="Overview" title="Your numbers" subtitle="A quick snapshot of your classroom activity." />
        <View style={{ marginTop: 8 }}>
          {stats.map((s) => (
            <StatTile
              key={s.label}
              label={s.label}
              value={s.value}
              icon={s.icon}
              iconBg={s.iconBg}
              iconColor={s.iconColor}
              onPress={s.onPress}
            />
          ))}
        </View>
      </GlassCard>

      <GlassCard style={{ marginBottom: 16, borderRadius: 12 }}>
        <SectionHeader
          eyebrow="Shortcuts"
          title="Quick actions"
          subtitle="Jump into the next thing you want to create."
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <QuickActionPill label="New Lesson" icon="book" />
          <QuickActionPill label="New Test" icon="clipboard" />
          <QuickActionPill label="Add Student" icon="school" />
          {isAdmin || isPrincipal ? <QuickActionPill label="Add Teacher" icon="people" /> : null}
          {isAdmin ? <QuickActionPill label="Add Principal" icon="shield" /> : null}
        </View>
      </GlassCard>

      {isAdmin ? (
      <GlassCard style={{ marginBottom: 16, borderRadius: 12 }}>
          <SectionHeader
            eyebrow="Platform"
            title="Key KPIs"
            subtitle="Plan distribution and recurring monthly revenue."
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
            <CompactMetric label="Free" value={adminPlanCounts.free} />
            <CompactMetric label="Tutor" value={adminPlanCounts.tutor} />
            <CompactMetric label="Teacher" value={adminPlanCounts.standard} />
            <CompactMetric label="Pro" value={adminPlanCounts.pro} />
            <CompactMetric label="School" value={adminPlanCounts.school} />
            <CompactMetric label="Internal" value={adminPlanCounts.internal} />
            <View
              style={{
                width: "100%",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.colors.success,
                backgroundColor: theme.colors.successSoft,
                padding: 16,
              }}
            >
              <Text style={[theme.typography.label, { color: theme.colors.success }]}>Revenue /mo</Text>
              <Text
                style={{
                  marginTop: 8,
                  fontWeight: "800",
                  fontSize: 24,
                  lineHeight: 28,
                  color: theme.colors.success,
                }}
              >
                {`$${adminRevenueMonthly.toFixed(2)}`}
              </Text>
            </View>
          </View>
        </GlassCard>
      ) : null}

      {isAdmin || isPrincipal ? (
        <GlassCard style={{ marginBottom: 16, borderRadius: 12 }}>
          <SectionHeader
            eyebrow="Teachers"
            title="Capacity and activity"
            subtitle="Track student load across your teaching team."
          />

          {teacherCapacity.length > 0 ? (
            teacherCapacity.map((t, index) => {
              const loadColor = pickProgressColor(theme, t.percentage);
              return (
                <View
                  key={t.id}
                  style={{
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: theme.colors.border,
                    paddingTop: index === 0 ? 0 : 16,
                    marginTop: index === 0 ? 0 : 16,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text style={[theme.typography.bodyStrong, { color: theme.colors.text }]} numberOfLines={1}>
                        {t.name}
                      </Text>
                      <Text style={[theme.typography.caption, { marginTop: 4, color: theme.colors.textMuted }]}>
                        Joined {formatDateTime(t.created_at)}
                      </Text>
                    </View>
                    <Text style={[theme.typography.caption, { color: loadColor, fontWeight: "700" }]}>
                      {`${t.studentCount} / ${t.student_limit}`}
                    </Text>
                  </View>

                  <View
                    style={{
                      height: 8,
                      borderRadius: 999,
                      backgroundColor: theme.colors.surfaceAlt,
                      overflow: "hidden",
                      marginTop: 12,
                    }}
                  >
                    <View
                      style={{
                        height: "100%",
                        width: `${t.percentage}%`,
                        backgroundColor: loadColor,
                      }}
                    />
                  </View>
                </View>
              );
            })
          ) : (
            <View
              style={{
                borderRadius: 12,
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: theme.colors.border,
                padding: 22,
                alignItems: "center",
              }}
            >
              <Text style={[theme.typography.caption, { color: theme.colors.textMuted }]}>No teachers found</Text>
            </View>
          )}
        </GlassCard>
      ) : (
        <>
          <RecentListCard eyebrow="Activity" title="Recent lessons" items={recentLessons as any} type="lesson" />
          <RecentListCard eyebrow="Activity" title="Recent tests" items={recentTests as any} type="test" />
        </>
      )}
    </>
  );

  const studentDashboard = (
    <>
      <GlassCard style={{ marginBottom: 18, borderRadius: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={theme.typography.label}>Student dashboard</Text>
            <Text style={[theme.typography.title, { marginTop: 6, fontSize: 22, lineHeight: 28 }]}>
              {`Hello, ${studentName}`}
            </Text>
            <Text style={[theme.typography.bodyStrong, { marginTop: 8 }]}>
              {studentTeacherName ? `Teacher: ${studentTeacherName}` : "Welcome to Eluency"}
            </Text>
          </View>
          <View
            style={{
              height: 56,
              width: 56,
              borderRadius: 22,
              backgroundColor: theme.colors.violetSoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="school" size={26} color={theme.colors.primary} />
          </View>
        </View>
      </GlassCard>

      {studentExpiresAt ? (
        <GlassCard style={{ marginBottom: 16, borderRadius: 12 }}>
          <Text style={theme.typography.label}>Session</Text>
          <Text style={[theme.typography.caption, { marginTop: 8, color: theme.colors.textMuted }]}>
            {`Active until ${formatDateTime(studentExpiresAt)}`}
          </Text>
        </GlassCard>
      ) : null}

      <AssignmentCard
        eyebrow="Lessons"
        title="Assigned lessons"
        items={assignedLessonsIds}
        emptyLabel="No lessons assigned."
      />
      <AssignmentCard
        eyebrow="Tests"
        title="Assigned tests"
        items={assignedTestsIds}
        emptyLabel="No tests assigned."
      />

      {sessionId ? (
        <View style={{ marginBottom: 16 }}>
          <AppButton
            label="Start Study Game"
            onPress={() => navigation.navigate("StudyGame", { sessionId })}
            icon={<Ionicons name="game-controller-outline" size={18} color={theme.colors.primaryText} />}
          />
        </View>
      ) : null}

      <AppButton
        label="Back to Login"
        variant="secondary"
        onPress={handleSignOut}
        icon={<Ionicons name="log-out-outline" size={18} color={theme.colors.text} />}
      />
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          position: "absolute",
          top: 30,
          right: -60,
          height: 220,
          width: 220,
          borderRadius: 999,
          backgroundColor: theme.colors.primarySoft,
        }}
        pointerEvents="none"
      />
      <View
        style={{
          position: "absolute",
          bottom: 80,
          left: -80,
          height: 180,
          width: 180,
          borderRadius: 999,
          backgroundColor: theme.colors.violetSoft,
        }}
        pointerEvents="none"
      />

      <Modal transparent visible={drawerVisible} animationType="none" onRequestClose={closeMenu}>
        <View style={{ flex: 1 }}>
          <TouchableOpacity
          activeOpacity={1}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: "rgba(0,0,0,0.35)",
            }}
          onPress={closeMenu}
          />

          <Animated.View
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              width: drawerWidth,
              transform: [{ translateX: drawerAnim }],
              backgroundColor: theme.colors.background,
              zIndex: 2,
            }}
          >
            <View
              style={{
                position: "absolute",
                top: 30,
                right: -60,
                height: 220,
                width: 220,
                borderRadius: 999,
                backgroundColor: theme.colors.primarySoft,
              }}
              pointerEvents="none"
            />
            <View
              style={{
                position: "absolute",
                bottom: 100,
                left: -90,
                height: 200,
                width: 200,
                borderRadius: 999,
                backgroundColor: theme.colors.violetSoft,
              }}
              pointerEvents="none"
            />

            <ScrollView
              contentContainerStyle={{
                paddingTop: insets.top + 20,
                paddingHorizontal: 20,
                paddingBottom: 28,
              }}
              showsVerticalScrollIndicator={false}
            >
              <GlassCard style={{ marginBottom: 18, borderRadius: 12, position: "relative" }} padding={18}>
                <TouchableOpacity
                  onPress={closeMenu}
                  activeOpacity={0.8}
                  style={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    height: 36,
                    width: 36,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surfaceGlass,
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 2,
                  }}
                >
                  <Ionicons name="chevron-back" size={18} color={theme.colors.textMuted} />
                </TouchableOpacity>
                <Text style={[theme.typography.label, { color: theme.colors.primary }]}>
                  {isStudentMode ? "Student Access" : isAdmin ? "Admin Access" : isPrincipal ? "Principal Access" : "Teacher Access"}
                </Text>
                <Text style={[theme.typography.title, { marginTop: 8, fontSize: 22, lineHeight: 28 }]}>
                  {isStudentMode ? studentName || "Student" : teacherName}
                </Text>
                <Text style={[theme.typography.caption, { marginTop: 6, color: theme.colors.textMuted }]}>
                  {isStudentMode
                    ? studentTeacherName
                      ? `Connected to ${studentTeacherName}`
                      : "Welcome to your learning space"
                    : todayLabel}
                </Text>

                <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                  <View
                    style={{
                      flex: 1,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surfaceAlt,
                      padding: 12,
                    }}
                  >
                    <Text style={theme.typography.label}>{isStudentMode ? "Lessons" : "Classes"}</Text>
                    <Text style={[theme.typography.title, { marginTop: 6, fontSize: 22, lineHeight: 26 }]}>
                      {isStudentMode ? assignedLessonsIds.length : lessonsCount}
                    </Text>
                  </View>
                  <View
                    style={{
                      flex: 1,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surfaceAlt,
                      padding: 12,
                    }}
                  >
                    <Text style={theme.typography.label}>{isStudentMode ? "Tests" : "Students"}</Text>
                    <Text style={[theme.typography.title, { marginTop: 6, fontSize: 22, lineHeight: 26 }]}>
                      {isStudentMode ? assignedTestsIds.length : studentsCount}
                    </Text>
                  </View>
                </View>
              </GlassCard>

              {menuSections.map((section) => (
                <GlassCard key={section.title} style={{ marginBottom: 16, borderRadius: 12 }} padding={14}>
                  <Text style={[theme.typography.label, { marginBottom: 10 }]}>{section.title}</Text>
                  {section.items.map((item, index) => (
                    <TouchableOpacity
                      key={item.href}
                      activeOpacity={0.85}
                      onPress={() => {
                    closeMenu();
                        handleActionPress(item.href);
                      }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        backgroundColor: item.href === "/dashboard" ? theme.colors.primarySoft : theme.colors.surfaceAlt,
                        marginBottom: index === section.items.length - 1 ? 0 : 10,
                        borderWidth: 1,
                        borderColor: item.href === "/dashboard" ? theme.colors.primary : theme.colors.border,
                      }}
                    >
                      <View
                        style={{
                          height: 40,
                          width: 40,
                          borderRadius: 16,
                          backgroundColor: item.href === "/dashboard" ? theme.colors.background : theme.colors.primarySoft,
                          alignItems: "center",
                          justifyContent: "center",
                          marginRight: 12,
                        }}
                      >
                        <Ionicons
                          name={ICONS[item.icon]}
                          size={18}
                          color={item.href === "/dashboard" ? theme.colors.primary : theme.colors.primary}
                        />
                      </View>
                      <Text style={[theme.typography.bodyStrong, { flex: 1 }]}>{item.label}</Text>
                      <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                </GlassCard>
              ))}

              <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
                <View style={{ flex: 1 }}>
                  <AppButton
                    label="Sign Out"
                    variant="secondary"
                    onPress={() => {
                      closeMenu();
                      handleSignOut();
                    }}
                    icon={<Ionicons name="log-out-outline" size={18} color={theme.colors.text} />}
                  />
                </View>
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          backgroundColor: theme.isDark ? theme.colors.background : "#FFFFFF",
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          paddingHorizontal: 20,
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
        pointerEvents="box-none"
      >
        <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
          <TouchableOpacity
            onPress={openMenu}
          activeOpacity={0.8}
          style={{
            height: 44,
            width: 44,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surfaceGlass,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="menu" size={20} color={theme.colors.textMuted} />
        </TouchableOpacity>

        <View style={{ flex: 1, paddingHorizontal: 12 }}>
          <Text style={theme.typography.label}>{isStudentMode ? "Student Dashboard" : "Dashboard"}</Text>
          <Text style={[theme.typography.title, { marginTop: 4, fontSize: 18, lineHeight: 22 }]}>Eluency</Text>
        </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => Alert.alert("Profile", "Coming soon")}
          style={{
            height: 40,
            width: 40,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surfaceGlass,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={[theme.typography.bodyStrong, { fontWeight: "800", color: theme.colors.text }]}>
            {currentUserInitial}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: topBarHeight + 12,
          paddingBottom: 34,
        }}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <GlassCard>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
              <Text style={[theme.typography.body, { marginLeft: 12 }]}>Loading dashboard...</Text>
            </View>
          </GlassCard>
        ) : fatalError ? (
          <GlassCard>
            <Text style={theme.typography.title}>Error loading dashboard</Text>
            <Text style={[theme.typography.body, { marginTop: 10 }]}>{fatalError}</Text>
            <View style={{ marginTop: 16 }}>
              <AppButton
                label="Back to Login"
                variant="secondary"
                onPress={handleSignOut}
                icon={<Ionicons name="arrow-back-outline" size={18} color={theme.colors.text} />}
              />
            </View>
          </GlassCard>
        ) : isStudentMode ? (
          studentDashboard
        ) : (
          teacherDashboard
        )}
      </ScrollView>
    </View>
  );
}

