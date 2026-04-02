import { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ActivityIndicator, View } from "react-native";
import LoginScreen from "./screens/LoginScreen";
import RegisterScreen from "./screens/RegisterScreen";
import DashboardScreen from "./screens/DashboardScreen";
import ChatsScreen from "./screens/ChatsScreen";
import SendNotificationsScreen from "./screens/SendNotificationsScreen";
import TeachersScreen from "./screens/TeachersScreen";
import SettingsScreen from "./screens/SettingsScreen";
import SubscriptionScreen from "./screens/SubscriptionScreen";
import LessonPacksScreen from "./screens/LessonPacksScreen";
import StudentsScreen from "./screens/StudentsScreen";
import StudentFormScreen from "./screens/StudentFormScreen";
import TestsScreen from "./screens/TestsScreen";
import TestFormScreen from "./screens/TestFormScreen";
import LessonsScreen from "./screens/LessonsScreen";
import LessonFormScreen from "./screens/LessonFormScreen";
import StudyGameScreen from "./screens/StudyGameScreen";
import { getStoredStudentSessionId } from "./lib/studentSession";
import { useAppTheme } from "./lib/theme";
import { supabase } from "./lib/supabase";

const Stack = createNativeStackNavigator();

export default function App() {
  const theme = useAppTheme();
  const [authBootstrapped, setAuthBootstrapped] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [studentSessionId, setStudentSessionId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    Promise.all([supabase.auth.getSession(), getStoredStudentSessionId()])
      .then(([{ data }, storedStudentSessionId]) => {
        if (!mounted) return;
        setHasSession(!!data.session);
        setStudentSessionId(storedStudentSessionId);
      })
      .finally(() => {
        if (!mounted) return;
        setAuthBootstrapped(true);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <StatusBar
          style={theme.isDark ? "light" : "dark"}
          hidden={false}
          translucent={false}
          backgroundColor={theme.colors.background}
        />
        {authBootstrapped ? (
          <NavigationContainer>
            <Stack.Navigator
              initialRouteName={hasSession ? "Dashboard" : studentSessionId ? "StudyGame" : "Login"}
              screenOptions={{
                headerShown: false,
              }}
            >
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="Register" component={RegisterScreen} />
              <Stack.Screen name="Dashboard" component={DashboardScreen} />
              <Stack.Screen name="Chats" component={ChatsScreen} />
              <Stack.Screen name="SendNotifications" component={SendNotificationsScreen} />
              <Stack.Screen name="Teachers" component={TeachersScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="Subscription" component={SubscriptionScreen} />
              <Stack.Screen name="LessonPacks" component={LessonPacksScreen} />
              <Stack.Screen name="Students" component={StudentsScreen} />
              <Stack.Screen name="StudentForm" component={StudentFormScreen} />
              <Stack.Screen name="Lessons" component={LessonsScreen} />
              <Stack.Screen name="LessonForm" component={LessonFormScreen} />
              <Stack.Screen name="Tests" component={TestsScreen} />
              <Stack.Screen name="TestForm" component={TestFormScreen} />
              <Stack.Screen name="StudyGame" component={StudyGameScreen} initialParams={{ sessionId: studentSessionId || "" }} />
            </Stack.Navigator>
          </NavigationContainer>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
          </View>
        )}
      </View>
    </SafeAreaProvider>
  );
}
