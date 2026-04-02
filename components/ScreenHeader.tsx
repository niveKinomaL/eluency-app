import { ReactNode } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useAppTheme } from "../lib/theme";

type Props = {
  title: string;
  eyebrow?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightElement?: ReactNode;
};

export default function ScreenHeader({
  title,
  eyebrow,
  showBack = true,
  onBack,
  rightElement,
}: Props) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  return (
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
        paddingHorizontal: 16,
        paddingTop: Math.max(insets.top, 8),
        paddingBottom: 10,
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      {showBack ? (
        <TouchableOpacity
          onPress={handleBack}
          activeOpacity={0.85}
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
          <Ionicons name="chevron-back" size={20} color={theme.colors.textMuted} />
        </TouchableOpacity>
      ) : (
        <View style={{ width: 44 }} />
      )}

      <View style={{ flex: 1, paddingHorizontal: 10 }}>
        {eyebrow ? (
          <Text style={theme.typography.label}>{eyebrow}</Text>
        ) : null}
        <Text
          style={[
            theme.typography.title,
            { marginTop: eyebrow ? 2 : 0, fontSize: 18, lineHeight: 22 },
          ]}
        >
          {title}
        </Text>
      </View>

      {rightElement ? rightElement : <View style={{ width: 44 }} />}
    </View>
  );
}

/** Returns the height the header occupies so content can be offset correctly.
 *  Usage:  paddingTop: useScreenHeaderHeight()  */
export function useScreenHeaderHeight() {
  const insets = useSafeAreaInsets();
  return Math.max(insets.top, 8) + 62;
}
